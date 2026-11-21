import { randomBytes } from "node:crypto";
import { MessengersError } from "./errors";
import { qrRows } from "./qr";
import { toUserAdapterError, type MtMe } from "./telegram-user";

/**
 * The login of a Telegram user account (decision 0036 point 4): `api_id` and `api_hash` from my.telegram.org, then either
 * a phone and the code Telegram sends or a short-lived QR code, then the 2FA password when the account has one. Each step is one server
 * call. The values live only in this process's memory for the flow (10 minutes at most) and are never written, logged or returned;
 * what is persisted, by the caller's `store`, is the final session alone. The agent never types a code or a password.
 */

/** The part of an unauthorised mtcute client the login uses (`telegram-user-api.ts` maps mtcute onto it; tests pass a fake). */
export interface MtLoginClient {
  /** Asks Telegram to send the code. */
  sendCode(phone: string): Promise<{ phoneCodeHash: string }>;
  /** Throws an RpcError-shaped `SESSION_PASSWORD_NEEDED` when the account has a 2FA password. */
  signIn(o: { phone: string; phoneCodeHash: string; code: string }): Promise<MtMe>;
  /** mtcute rotates the URL; the URL is converted to modules inside this process. */
  signInQr(o: { onUrlUpdated: (url: string, expires: Date) => void; abortSignal: AbortSignal }): Promise<MtMe>;
  checkPassword(password: string): Promise<MtMe>;
  exportSession(): Promise<string>;
  close(): Promise<void>;
}

export interface LoginCredentials {
  apiId: number;
  apiHash: string;
}

export type LoginStep =
  | { step: "code"; flow: string }
  | { step: "qr"; flow: string; qr: string[] | null; expiresAt: string | null }
  | { step: "password"; flow: string }
  | { step: "done"; account: string; name: string };

export interface LoginDeps {
  clientFor: (c: LoginCredentials) => MtLoginClient;
  /** Persists the final session (the caller writes the file at mode 0600 and starts the connection). */
  store: (account: string, s: LoginCredentials & { session: string }) => Promise<void>;
  now?: () => number;
  ttlMs?: number;
}

interface Flow {
  creds: LoginCredentials;
  phone: string | null;
  phoneCodeHash: string | null;
  client: MtLoginClient;
  step: "code" | "qr" | "password" | "saving" | "persisting" | "done" | "failed";
  qr: string[] | null;
  expiresAt: string | null;
  result: Extract<LoginStep, { step: "done" }> | null;
  failure: MessengersError | null;
  persistence?: Promise<void>;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout>;
  until: number;
  /** What the owner typed, so an error text is scrubbed of it before it leaves this module. */
  typed: string[];
}

/** A flow lives 10 minutes: Telegram's code expires about then too. */
export const LOGIN_TTL_MS = 10 * 60_000;
const MAX_FLOWS = 4;

/** Telegram's refusals during a login, as the sentence the admin shows. Never the value that was typed. */
const SAY: Record<string, string> = {
  API_ID_INVALID: "Telegram does not know this api_id and api_hash: copy both again from my.telegram.org.",
  API_ID_PUBLISHED_FLOOD: "This api_id was published and is blocked: create your own app on my.telegram.org.",
  PHONE_NUMBER_INVALID: "Telegram does not know this phone number: type it in international format, with + and the country code.",
  PHONE_NUMBER_BANNED: "Telegram has banned this phone number.",
  PHONE_CODE_INVALID: "The code is wrong: type the code Telegram sent again.",
  PHONE_CODE_EMPTY: "Type the code Telegram sent.",
  PHONE_CODE_EXPIRED: "The code has expired: start again to get a new one.",
  PASSWORD_HASH_INVALID: "The password is wrong: type your Telegram two-step verification password again.",
  PHONE_NUMBER_UNOCCUPIED: "No Telegram account uses this phone number: sign up in the Telegram app first.",
};

const scrub = (text: string, typed: readonly string[]) => typed.filter((t) => t.length >= 3).reduce((s, t) => s.split(t).join("***"), text);

/** A login refusal (`bad_login`) with a sentence for the owner, scrubbed of everything he typed. */
function refusal(err: unknown, typed: readonly string[]): MessengersError {
  const text = typeof err === "object" && err !== null ? Reflect.get(err, "text") : undefined;
  if (typeof text === "string" && SAY[text]) return new MessengersError("bad_login", SAY[text]);
  const a = toUserAdapterError(err);
  if (a.code === "flood_wait" || a.code === "rate_limited") return new MessengersError("bad_login", `Telegram asks to wait ${Math.ceil((a.retryAfterMs ?? 60_000) / 60_000)} min before the next try.`);
  if (a.code === "banned") return new MessengersError("bad_login", "Telegram has banned this account.");
  if (a.code === "network") return new MessengersError("bad_login", "Telegram could not be reached: check the network and start again.");
  return new MessengersError("bad_login", scrub(`Telegram refused the login (${a.message}).`, typed));
}

const needsPassword = (err: unknown) => typeof err === "object" && err !== null && Reflect.get(err, "text") === "SESSION_PASSWORD_NEEDED";

/** A QR login failure for the owner. The fallback error of an adapter may contain the live login URL, so only known codes leave this process. */
function qrFailure(err: unknown, typed: readonly string[]): MessengersError {
  const code = typeof err === "object" && err !== null ? Reflect.get(err, "text") : undefined;
  if (typeof code === "string" && SAY[code]) return new MessengersError("bad_login", SAY[code]);
  const mapped = toUserAdapterError(err);
  if (mapped.code === "flood_wait" || mapped.code === "rate_limited" || mapped.code === "banned" || mapped.code === "network") return refusal(err, typed);
  return new MessengersError("bad_login", "Telegram could not complete the QR login: start again.");
}

/** Runs Telegram's QR sign-in for one flow: keeps the latest code rows on the flow, then hands the account to `finish`, or leaves the flow waiting for the password or failed. */
function runQr(f: Flow, typed: readonly string[], live: () => boolean, finish: (me: MtMe) => Promise<LoginStep>): void {
  void f.client
    .signInQr({
      abortSignal: f.abort.signal,
      onUrlUpdated(url, expires) {
        if (!live() || f.step !== "qr") return;
        f.qr = qrRows(url).rows;
        f.expiresAt = expires.toISOString();
      },
    })
    .then(finish)
    .catch((err: unknown) => {
      if (!live() || f.abort.signal.aborted) return;
      f.qr = null;
      f.expiresAt = null;
      if (needsPassword(err)) {
        f.step = "password";
        return;
      }
      f.failure = qrFailure(err, typed);
      f.step = "failed";
      void f.client.close().catch(() => undefined);
    });
}

export function createLoginFlows(deps: LoginDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? LOGIN_TTL_MS;
  const flows = new Map<string, Flow>();

  const drop = async (id: string) => {
    const f = flows.get(id);
    flows.delete(id);
    if (f) {
      clearTimeout(f.timer);
      f.abort.abort();
    }
    if (f?.step !== "done") await f?.client.close().catch(() => undefined);
  };
  const expire = (id: string, delay: number): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => {
      const f = flows.get(id);
      if (f?.step === "persisting") f.timer = expire(id, 1000);
      else void drop(id);
    }, Math.max(1, delay));
    timer.unref?.();
    return timer;
  };
  const sweep = async () => {
    for (const [id, f] of flows) if (f.until <= now() && f.step !== "persisting") await drop(id);
  };
  const take = async (id: string, step: Flow["step"]): Promise<Flow> => {
    await sweep();
    const f = flows.get(id);
    if (!f) throw new MessengersError("bad_login", "This login has expired or was never started: start again.");
    if (f.step !== step) throw new MessengersError("bad_login", step === "code" ? "This login does not wait for a code." : "This login does not wait for a password.");
    return f;
  };
  const finish = async (id: string, f: Flow, me: MtMe): Promise<LoginStep> => {
    const requireActive = () => {
      if (flows.get(id) !== f || f.abort.signal.aborted) throw new MessengersError("bad_login", "This login has expired or was cancelled: start again.");
    };
    requireActive();
    f.step = "saving";
    f.qr = null;
    f.expiresAt = null;
    const session = await f.client.exportSession();
    requireActive();
    if (f.phone === null) f.step = "persisting";
    const persistence = deps.store(String(me.id), { ...f.creds, session });
    if (f.phone === null) f.persistence = persistence;
    try {
      await persistence;
    } finally {
      delete f.persistence;
    }
    const result = { step: "done" as const, account: String(me.id), name: me.displayName };
    if (f.phone === null && flows.get(id) === f) {
      f.result = result;
      f.step = "done";
      f.until = now() + Math.min(ttl, 60_000);
      clearTimeout(f.timer);
      f.timer = expire(id, f.until - now());
      await f.client.close().catch(() => undefined);
    } else await drop(id);
    return result;
  };

  const add = (id: string, f: Omit<Flow, "timer">): Flow => {
    const entry = { ...f, timer: expire(id, f.until - now()) };
    flows.set(id, entry);
    return entry;
  };

  return {
    async start(input: { apiId: number; apiHash: string; phone: string } | { apiId: number; apiHash: string; method: "qr" }): Promise<LoginStep> {
      await sweep();
      while (flows.size >= MAX_FLOWS) {
        const oldest = [...flows].find(([, f]) => f.step !== "persisting");
        if (!oldest) throw new MessengersError("bad_login", "Telegram logins are being saved: wait before starting another.");
        await drop(oldest[0]);
      }
      const creds = { apiId: input.apiId, apiHash: input.apiHash.trim() };
      const phone = "phone" in input ? input.phone.replace(/[\s\-().]/g, "") : null;
      const typed = [creds.apiHash, ...(phone ? [phone] : []), String(creds.apiId)];
      const client = deps.clientFor(creds);
      if (phone === null) {
        const flow = randomBytes(18).toString("base64url");
        const abort = new AbortController();
        const f = add(flow, { creds, phone: null, phoneCodeHash: null, client, step: "qr", qr: null, expiresAt: null, result: null, failure: null, abort, until: now() + ttl, typed });
        runQr(f, typed, () => flows.get(flow) === f, (me) => finish(flow, f, me));
        return { step: "qr", flow, qr: null, expiresAt: null };
      }
      try {
        const { phoneCodeHash } = await client.sendCode(phone);
        const flow = randomBytes(18).toString("base64url");
        add(flow, { creds, phone, phoneCodeHash, client, step: "code", qr: null, expiresAt: null, result: null, failure: null, abort: new AbortController(), until: now() + ttl, typed });
        return { step: "code", flow };
      } catch (err) {
        await client.close().catch(() => undefined);
        throw refusal(err, typed);
      }
    },

    async code(flow: string, code: string): Promise<LoginStep> {
      const f = await take(flow, "code");
      const c = code.replace(/\s/g, "");
      try {
        return await finish(flow, f, await f.client.signIn({ phone: f.phone!, phoneCodeHash: f.phoneCodeHash!, code: c }));
      } catch (err) {
        if (needsPassword(err)) {
          f.step = "password";
          return { step: "password", flow };
        }
        throw refusal(err, [...f.typed, c]);
      }
    },

    async password(flow: string, password: string): Promise<LoginStep> {
      const pending = flows.get(flow);
      if (pending?.phone === null && pending.result) return pending.result;
      const f = await take(flow, "password");
      f.step = "saving";
      try {
        return await finish(flow, f, await f.client.checkPassword(password));
      } catch (err) {
        if (flows.get(flow) === f) f.step = "password";
        throw refusal(err, [...f.typed, password]);
      }
    },

    async status(flow: string): Promise<LoginStep> {
      await sweep();
      const f = flows.get(flow);
      if (!f || f.phone !== null) throw new MessengersError("bad_login", "This QR login has expired or was never started: start again.");
      if (f.step === "failed") {
        const error = f.failure ?? new MessengersError("bad_login", "Telegram could not complete the QR login: start again.");
        await drop(flow);
        throw error;
      }
      if (f.step === "done") return f.result!;
      if (f.step === "password") return { step: "password", flow };
      return { step: "qr", flow, qr: f.step === "qr" && f.expiresAt !== null && Date.parse(f.expiresAt) > now() ? f.qr : null, expiresAt: f.step === "qr" && f.expiresAt !== null && Date.parse(f.expiresAt) > now() ? f.expiresAt : null };
    },

    async cancel(flow: string) {
      const f = flows.get(flow);
      if (f?.phone === null && (f.step === "persisting" || f.step === "done")) {
        throw new MessengersError("bad_login", "This QR login was confirmed in Telegram and is being connected.");
      }
      await drop(flow);
    },
    /** Tests and shutdown. */
    async closeAll() {
      for (const [id, f] of [...flows]) {
        await f.persistence?.catch(() => undefined);
        await drop(id);
      }
    },
    size: () => flows.size,
  };
}
export type LoginFlows = ReturnType<typeof createLoginFlows>;
