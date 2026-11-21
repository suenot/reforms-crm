import { randomBytes } from "node:crypto";
import { MessengersError } from "./errors";
import { qrRows } from "./qr";
import { WaAuthFiles } from "./whatsapp-auth";
import { WA_CODES, type WaMe, type WaSocket, type WaSocketFactory } from "./whatsapp-socket";

/**
 * Linking WhatsApp as a device (P71 M5, decision 0036 point 4): the owner presses Connect, the server opens a socket over an empty
 * in-memory auth store, Baileys shows a QR code (a new one about every 20 s), the owner scans it with his phone (WhatsApp ▸ Linked
 * devices ▸ Link a device). When the phone has scanned, Baileys reports the new login (`paired`), answers WhatsApp's pair-success
 * with the device's signature (`pair-device-sign`), then WhatsApp closes the socket with 515 (restart required). Only on that 515
 * is the store written to the account's folder (0700, files 0600) by the caller's `store`, and the supervisor connects the account
 * from its files over the same creds. Nothing of the pairing is written before the scan; the QR code is never logged or written.
 *
 * The socket is never closed on `paired` (P71 M5 fix, 2026-11-20): Baileys emits `paired` before it sends the signature, inside the
 * same handler, so a close there cut the reply off; WhatsApp accepted the half-registered device for a few minutes, then logged
 * it out (401). The pairing socket lives until WhatsApp itself closes it.
 */

export type PairingStep =
  | { step: "waiting" }
  | { step: "qr"; size: number; rows: string[] }
  | { step: "done"; account: string; name: string }
  | { step: "failed"; reason: string };

export interface PairingDeps {
  socketFor: WaSocketFactory;
  /** Writes the store to the account's folder and connects the account (the caller is the supervisor). */
  store: (me: WaMe, auth: WaAuthFiles) => Promise<void>;
  now?: () => number;
  ttlMs?: number;
}

/** A pairing lives 3 minutes: WhatsApp stops refreshing the code after about five codes anyway. */
export const PAIRING_TTL_MS = 3 * 60_000;

/** The QR code as rows of `1` (dark) and `0`, for the admin to draw: no image library there, no QR string in a reply. */
export { qrRows } from "./qr";

interface Flow {
  sock: WaSocket;
  auth: WaAuthFiles;
  state: PairingStep;
  until: number;
  /** Set on `paired`: the account the 515 that follows stores. */
  me: WaMe | null;
}

const FAILED: Record<number, string> = {
  [WA_CODES.timedOut]: "The QR code expired before it was scanned: press Connect again.",
  [WA_CODES.loggedOut]: "WhatsApp refused to link this device: press Connect again.",
  [WA_CODES.forbidden]: "WhatsApp refused this number (banned or restricted).",
  [WA_CODES.connectionReplaced]: "Another device took over the link: press Connect again.",
};

export function createWaPairing(deps: PairingDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? PAIRING_TTL_MS;
  const flows = new Map<string, Flow>();

  const drop = async (id: string) => {
    const f = flows.get(id);
    flows.delete(id);
    await f?.sock.close().catch(() => undefined);
  };
  const sweep = async () => {
    for (const [id, f] of flows) if (f.until <= now()) await drop(id);
  };

  return {
    /** P126 S1: every open flow's step (and QR), so a live watch bumps `connections` when the pairing moves; the admin reads `state(flow)` again. */
    signature(): string {
      return [...flows].map(([id, f]) => `${id}:${JSON.stringify(f.state)}`).join("|");
    },
    /** Starts the one pairing (a new Connect cancels an older one): the socket opens and the first QR code follows. */
    async start(): Promise<{ flow: string }> {
      await sweep();
      for (const id of [...flows.keys()]) await drop(id);
      const auth = new WaAuthFiles(null);
      const sock = deps.socketFor(auth);
      const id = randomBytes(18).toString("base64url");
      const f: Flow = { sock, auth, state: { step: "waiting" }, until: now() + ttl, me: null };
      flows.set(id, f);
      sock.listen({
        connection(u) {
          if (f.state.step === "done" || f.state.step === "failed") return;
          if (u.state === "qr") {
            f.state = { step: "qr", ...qrRows(u.qr) };
          } else if (u.state === "paired") {
            // Nothing is closed here: Baileys still has to send the device's signature after this event (see the top).
            if (f.me) return;
            f.me = u.me;
            f.state = { step: "waiting" };
          } else if (u.state === "close" && u.code === WA_CODES.restartRequired && f.me) {
            // WhatsApp's restart after the scan: the signature went out, the creds are final. Store them and connect the account.
            const me = f.me;
            f.state = { step: "waiting" };
            // The flow lives on until the supervisor has connected; the TTL does not cut a save in progress.
            f.until = Number.POSITIVE_INFINITY;
            void (async () => {
              try {
                await f.sock.close().catch(() => undefined);
                await deps.store(me, f.auth);
                f.state = { step: "done", account: me.account, name: me.name };
              } catch (e) {
                f.state = { step: "failed", reason: e instanceof Error ? `The link was made but could not be saved: ${e.message}` : "The link could not be saved." };
              } finally {
                f.until = now() + ttl;
              }
            })();
          } else if (u.state === "close" && u.code !== WA_CODES.restartRequired) {
            f.state = { step: "failed", reason: FAILED[u.code ?? 0] ?? `WhatsApp closed the connection${u.code ? ` (code ${u.code})` : ""}: press Connect again.` };
            void f.sock.close().catch(() => undefined);
          }
        },
        messages: () => undefined,
        chats: () => undefined,
      });
      return { flow: id };
    },

    /** Where the pairing stands. A finished or failed flow is dropped once read. */
    async state(id: string): Promise<PairingStep> {
      await sweep();
      const f = flows.get(id);
      if (!f) throw new MessengersError("bad_login", "This connect has expired or was never started: press Connect again.");
      if (f.state.step === "done" || f.state.step === "failed") flows.delete(id);
      return f.state;
    },

    cancel: drop,
    async closeAll() {
      for (const id of [...flows.keys()]) await drop(id);
    },
    size: () => flows.size,
  };
}
export type WaPairing = ReturnType<typeof createWaPairing>;
