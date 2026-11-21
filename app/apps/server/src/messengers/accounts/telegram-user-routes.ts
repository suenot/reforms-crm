import { Hono, type Context } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import {
  userDisconnectedDto,
  userLoginCancelBody,
  userLoginCodeBody,
  userLoginPasswordBody,
  userLoginStartBody,
  userLoginStatusBody,
  userLoginStepDto,
} from "@hub/contract/messengers";
import { AdapterError } from "@hub/messengers";
import { z, type ZodType } from "zod";
import { gateRefusal } from "../../http/admin-gate";
import type { TelegramUserHandle } from "./telegram-user";
import type { MessengersContext } from "../context";

/**
 * The Telegram user account's doors (P71 M1, decision 0036 points 3, 4 and 7). Every route is a POST behind the admin gate (the
 * exact admin Origin, a loopback Host, `Sec-Fetch-Site: same-origin`, as the send ticket and the local Open): the login steps
 * carry the owner's api_hash, phone, code and password. Linking a chat is the autolink's (`messengers/autolink/routes.ts`, P102). No body or reply is logged; a reply never holds a session, a code or a password (the schemas have no field).
 * The link mints a `HumanActor` here, behind the gate (0036 point 7). Nothing here sends a message: M1 receives only.
 */
export function telegramUserRoutes({ tg, adminPort }: MessengersContext) {
  const gate = (c: Context) =>
    gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });

  /** The gate, the service, then the strict body: one refusal shape for each. */
  async function guarded<T>(c: Context, schema: ZodType<T>, then: (body: T, tg: TelegramUserHandle) => Promise<Response>): Promise<Response> {
    const why = gate(c);
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    if (!tg) return c.json({ error: "Telegram user accounts are not set up on this server.", code: "not_found" as const }, 404);
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    // Every other refusal is the server's onError's (P126 E1); only the account's failure is named here.
    try {
      return await then(parsed.data, tg);
    } catch (e) {
      if (e instanceof AdapterError) return c.json({ error: `Telegram: ${e.message}`, code: "server" as const }, 502);
      throw e;
    }
  }
  const noProject = (c: Context, tg: TelegramUserHandle) => {
    const p = tg.project();
    return p.project !== null ? null : c.json({ error: `Not connected: ${p.reason}.`, code: "wrong_state" as const }, 409);
  };
  return new Hono()
    .get("/api/messengers/telegram-user", (c) => c.json(tg ? tg.status() : { state: "off", reason: "not set up", accounts: [] }))
    .post("/api/messengers/telegram-user/login/start", (c) => {
      c.header("Cache-Control", "no-store");
      return guarded(c, userLoginStartBody, async (b, tg) => noProject(c, tg) ?? c.json(userLoginStepDto.parse(await tg.login.start(b))));
    })
    .post("/api/messengers/telegram-user/login/status", (c) => {
      c.header("Cache-Control", "no-store");
      return guarded(c, userLoginStatusBody, async (b, tg) => c.json(userLoginStepDto.parse(await tg.login.status(b.flow))));
    })
    .post("/api/messengers/telegram-user/login/code", (c) => guarded(c, userLoginCodeBody, async (b, tg) => c.json(userLoginStepDto.parse(await tg.login.code(b.flow, b.code)))))
    .post("/api/messengers/telegram-user/login/password", (c) =>
      guarded(c, userLoginPasswordBody, async (b, tg) => c.json(userLoginStepDto.parse(await tg.login.password(b.flow, b.password)))),
    )
    .post("/api/messengers/telegram-user/login/cancel", (c) =>
      guarded(c, userLoginCancelBody, async (b, tg) => {
        await tg.login.cancel(b.flow);
        return c.json({ ok: true as const });
      }),
    )
    .post("/api/messengers/telegram-user/:account/disconnect", (c) =>
      guarded(c, emptyBody, async (_b, tg) => {
        const account = c.req.param("account");
        if (!/^\d{1,20}$/.test(account)) return c.json({ error: "Not an account id.", code: "invalid" as const }, 400);
        return c.json(userDisconnectedDto.parse({ ok: true, account, removed: await tg.disconnect(account) }));
      }),
    );
}

/** Disconnect takes no fields: an empty object or no body at all. */
const emptyBody = z.strictObject({}).optional();
