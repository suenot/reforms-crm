import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeLoginClient, FakeMtClient, FakeRpcError, fakePerson } from "@hub/messengers";
import { humanActor, linkUserChat } from "@hub/messengers/human";
import { testApp } from "../../support/runtime";
import { startTelegramUser, type TelegramUserHandle } from "../../../src/messengers/accounts/telegram-user";
import { composeScheme } from "../../../src/overview/scheme";

const ADMIN = 5173;
const HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const BASE = "http://127.0.0.1:4317";
const HASH = "0123456789abcdef0123456789abcdef";

let handle: DbHandle;
let repos: Repos;
let dir: string;
let clientId: number;
let fake: FakeMtClient;
let made: number;
let login: FakeLoginClient;
let tg: TelegramUserHandle | null;
/** P71 M-P: the projects a poll stored messages in (the pre-analysis hook). */
let stored: string[] = [];
const anna = fakePerson(1001, "Anna", { phone: "79990001122" });
const stranger = fakePerson(2002, "Stranger");

const start = () =>
  startTelegramUser({
    repos,
    env: {},
    dir,
    clients: { session: () => (made++, fake), login: () => login },
    onStored: (project) => stored.push(project),
  });
const post = (app: ReturnType<typeof testApp>, path: string, body: unknown, headers: Record<string, string> = HEADERS) =>
  app.request(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

beforeEach(async () => {
  stored = [];
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  clientId = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna" });
  dir = mkdtempSync(join(tmpdir(), "hub-tg-user-"));
  fake = new FakeMtClient();
  made = 0;
  login = new FakeLoginClient({ twoFactor: true });
  tg = null;
});
afterEach(async () => {
  await tg?.stop();
  handle.close();
});

async function connect(): Promise<ReturnType<typeof testApp>> {
  tg = await start();
  const app = testApp(repos, { telegramUser: tg, adminPort: ADMIN });
  const s1 = (await (await post(app, "/api/messengers/telegram-user/login/start", { apiId: 12345, apiHash: HASH, phone: "+7 999 000-11-22" })).json()) as { step: string; flow: string };
  expect(s1.step).toBe("code");
  const s2 = (await (await post(app, "/api/messengers/telegram-user/login/code", { flow: s1.flow, code: "12345" })).json()) as { step: string };
  expect(s2).toEqual({ step: "password", flow: s1.flow });
  const s3 = await (await post(app, "/api/messengers/telegram-user/login/password", { flow: s1.flow, password: "pw" })).json();
  expect(s3).toEqual({ step: "done", account: "42", name: "Owner" });
  await vi.waitFor(() => expect(fake.listening).toBe(true));
  return app;
}

describe("Telegram user account in the server", () => {
  it("connects through the gated steps, keeps only the session file at 0600, and reports running", async () => {
    const app = await connect();
    const file = join(dir, "telegram_user-42", "session");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const health = (await (await app.request(`${BASE}/api/health`)).json()) as { telegramUser: { state: string; accounts: { account: string; state: string }[] } };
    expect(health.telegramUser.state).toBe("on");
    expect(health.telegramUser.accounts.map((a) => a.account)).toEqual(["42"]);
    expect(JSON.stringify(health)).not.toMatch(/SESSION-STRING|0123456789abcdef|12345"|"pw"/);
  });

  it("refuses every door without the admin's exact origin", async () => {
    tg = await start();
    const app = testApp(repos, { telegramUser: tg, adminPort: ADMIN });
    for (const headers of [{ "content-type": "application/json" }, { ...HEADERS, origin: "http://127.0.0.1:9999" }, { ...HEADERS, "sec-fetch-site": "same-site" }]) {
      const r = await post(app, "/api/messengers/telegram-user/login/start", { apiId: 1, apiHash: HASH, phone: "+10000000000" }, headers);
      expect(r.status).toBe(403);
    }
    expect(login.sentTo).toEqual([]);
  });

  it("gates QR status, returns only QR modules, and clears cancellation", async () => {
    tg = await start();
    const app = testApp(repos, { telegramUser: tg, adminPort: ADMIN });
    const bad = await post(app, "/api/messengers/telegram-user/login/start", { apiId: 1, apiHash: HASH, method: "qr", phone: "+10000000000" });
    expect(bad.status).toBe(400);
    const started = await post(app, "/api/messengers/telegram-user/login/start", { apiId: 1, apiHash: HASH, method: "qr" });
    expect(started.status).toBe(200);
    expect(started.headers.get("cache-control")).toBe("no-store");
    const { flow } = await started.json() as { flow: string };
    login.qrUrl?.("tg://login?token=server-secret", new Date(Date.now() + 30_000));
    const refused = await post(app, "/api/messengers/telegram-user/login/status", { flow }, { "content-type": "application/json" });
    expect(refused.status).toBe(403);
    const status = await post(app, "/api/messengers/telegram-user/login/status", { flow });
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    const body = await status.text();
    expect(body).toContain('"step":"qr"');
    expect(body).not.toMatch(/server-secret|tg:\/\/login|0123456789abcdef/);
    expect((await post(app, "/api/messengers/telegram-user/login/cancel", { flow })).status).toBe(200);
    expect((await post(app, "/api/messengers/telegram-user/login/status", { flow })).status).toBe(409);
  });

  it("stores a linked chat's message, and an unlinked one's only as the 30-day cache of a known, unlinked chat (decision 0049)", async () => {
    await connect();
    const adapter = tg?.adapter("42");
    if (!adapter) throw new Error("the account is not running");
    expect(await linkUserChat({ repos, adapter }, humanActor("test"), { project: "p", clientId, chatId: "1001", title: "Anna" })).toMatchObject({ imported: 0, importError: null });
    fake.emit(anna, "hello");
    fake.emit(stranger, "not for the hub");
    await vi.waitFor(async () => expect((await repos.messengers.messagesOf("p", [{ channel: "telegram_user", chatId: "1001" }], { limit: 5 })).map((m) => m.text)).toEqual(["hello"]));
    await vi.waitFor(async () => expect((await repos.messengers.messagesOf("p", [{ channel: "telegram_user", chatId: "2002" }], { limit: 5 })).map((m) => m.text)).toEqual(["not for the hub"]));
    expect((await repos.messengers.knownChats("p")).map((c) => [c.chatId, c.linked])).toEqual([["1001", true], ["2002", false]]);
    expect(JSON.stringify(tg?.status())).not.toMatch(/2002|Stranger/);
    // P71 M-P: the poll that stored the message told the pre-analysis hook (and only for this project).
    await vi.waitFor(() => expect(stored).toContain("p"));
    expect(new Set(stored)).toEqual(new Set(["p"]));
  });

  it("logged_out parks the account, health shows the fix, the scheme makes it a Needs you item, and a restart does not reconnect", async () => {
    await connect();
    fake.fail(new FakeRpcError(401, "AUTH_KEY_UNREGISTERED"));
    await vi.waitFor(() => expect(tg?.status().accounts[0]).toMatchObject({ state: "parked", parked: "logged_out" }));
    expect(tg?.status().accounts[0]?.fix).toMatch(/connect it again/);
    const app = testApp(repos, { telegramUser: tg ?? undefined, adminPort: ADMIN });
    const health = (await (await app.request(`${BASE}/api/health`)).json()) as never;
    const scheme = await composeScheme({ projects: async () => [], doctor: async () => ({}) as never, files: async () => ({}) as never, agentTools: () => null, connections: async () => ({ instance: "i", connections: [], mail: [], mailRead: { state: "answered", fix: null } }), health: () => health, stopped: async () => false, clis: () => null, core: () => null });
    expect(scheme.nodes.find((n) => n.id === "telegram:user:42")).toMatchObject({ state: "fail", fix: expect.stringMatching(/connect it again/), place: "messengers" });
    await tg?.stop();
    const before = made;
    tg = await start();
    expect(tg.status().accounts[0]).toMatchObject({ account: "42", state: "parked", parked: "logged_out" });
    expect(made).toBe(before);
  });

  it("a new login clears a park; Disconnect removes the session folder", async () => {
    await connect();
    fake.fail(new FakeRpcError(401, "SESSION_REVOKED"));
    await vi.waitFor(() => expect(tg?.status().accounts[0]?.state).toBe("parked"));
    fake = new FakeMtClient();
    const app = testApp(repos, { telegramUser: tg ?? undefined, adminPort: ADMIN });
    const s1 = (await (await post(app, "/api/messengers/telegram-user/login/start", { apiId: 12345, apiHash: HASH, phone: "+79990001122" })).json()) as { flow: string };
    await post(app, "/api/messengers/telegram-user/login/code", { flow: s1.flow, code: "12345" });
    await post(app, "/api/messengers/telegram-user/login/password", { flow: s1.flow, password: "pw" });
    await vi.waitFor(() => expect(fake.listening).toBe(true));
    expect(tg?.status().accounts[0]?.parked).toBeNull();
    const r = await (await post(app, "/api/messengers/telegram-user/42/disconnect", {})).json();
    expect(r).toEqual({ ok: true, account: "42", removed: true });
    expect(existsSync(join(dir, "telegram_user-42"))).toBe(false);
    expect(tg?.status().accounts).toEqual([]);
  });

  it("is off with several projects and refuses a login then", async () => {
    await repos.projects.replaceRegistry({ projects: ["a", "b"].map((slug) => ({ slug, name: slug, status: "active", settingsJson: "{}", hash: slug })), addresses: [] });
    tg = await start();
    expect(tg.status()).toMatchObject({ state: "off", reason: expect.stringMatching(/HUB_MESSENGERS_PROJECT/) });
    const app = testApp(repos, { telegramUser: tg, adminPort: ADMIN });
    expect((await post(app, "/api/messengers/telegram-user/login/start", { apiId: 1, apiHash: HASH, phone: "+10000000000" })).status).toBe(409);
  });
});
