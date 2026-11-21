import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { at, confirmReview, reviewDialog } from "./support";

// P71 M3: the Messengers section. The panel reads the seeded linked chats of lisbon-realty (Rita, who wrote last, with the
// agent's draft; Sofia, answered); Edit and Skip write the real row. The Telegram account routes are stubbed with
// `page.route`: the e2e instance has two projects, so its server keeps Telegram accounts off, and a real login is never made
// (the server side of the login runs on fakes in `apps/server/test/messengers/accounts/telegram-user.test.ts`; WhatsApp's in `whatsapp.test.ts`).

const P = "lisbon-realty";
const RITA = "Rita Falsa";
const chats = (page: Page) => page.getByRole("list", { name: "Chats" });
const rita = (page: Page) => chats(page).getByRole("listitem", { name: RITA });
const conversation = (page: Page) => page.getByTestId("messenger-conversation");

test("messengers: the panel lists the waiting chat with the agent's draft, a refused Send says why in words, and Drafts lists mail only", async ({ page }) => {
  await page.goto(at(P, "/messengers"));
  await expect(rita(page).getByText(/Draft ready/)).toBeVisible();
  await expect(rita(page).getByText(/notary on the 28th/)).toBeVisible();
  await expect(conversation(page)).toContainText("Hi! Is the notary on the 28th still on?");
  await expect(conversation(page)).toContainText("Telegram");
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("the 28th stands");
  // P71 M4: the e2e server connects no Telegram account, so the real dry run refuses, in words, and nothing is sent. P105 S3: Send
  // opens the review dialog; its Send runs the dry run, and the refusal is a blocker there, the Send off.
  await conversation(page).getByRole("button", { name: `Send the reply to ${RITA}` }).click();
  await confirmReview(page);
  const dialog = reviewDialog(page);
  await expect(dialog.getByText("Must be fixed: the Telegram account 100200300 is not connected (Settings ▸ Messengers)")).toBeVisible();
  await expect(dialog.getByTestId("review-confirm")).toHaveAttribute("aria-disabled", "true");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rita(page)).toHaveAttribute("data-agent-ref", /^chat:\d+$/);
  await expect(page.getByRole("button", { name: /^View:/ })).toHaveText(/Needs you\s*1/);
  await expect(chats(page).getByRole("listitem")).toHaveCount(1);
  // Waiting (P123 U3b, Mail's word): Sofia's chat, where we replied last, says whose turn it is.
  await page.getByRole("button", { name: /^View:/ }).click();
  await page.getByRole("menuitemradio", { name: /Waiting/ }).click();
  await expect.poll(() => new URL(page.url()).search).toBe("?filter=waiting");
  await expect(chats(page).getByRole("listitem", { name: "Sofia Teste" }).getByText("Waiting for them")).toBeVisible();
  // P71 M-P: the seeded verdicts of Sofia's chat, counted by reason under its Pre-analysis switch (P115: the compact row shows
  // identity and state only).
  await page.goto(at(P, "/settings/messengers"));
  const sofia = page.getByRole("listitem", { name: "Rules for Sofia Teste" });
  await sofia.getByRole("button", { name: "Edit the rules for Sofia Teste" }).click();
  await expect(sofia.getByText("Pre-analysis: hid 1 of 2 (1 closing).")).toBeVisible();
  // Mail drafts stay in Drafts, and messenger drafts never go there.
  await page.goto(at(P, "/mail?filter=all"));
  await page.locator('ul[aria-label="People"] > li').first().waitFor();
  await expect(page.getByText(/the 28th stands/)).toHaveCount(0);
});

test("messengers: Send reads the dry run, confirms in place with the exact text, and applies it with a messenger ticket", async ({ page }) => {
  // The server side runs on a fake Telegram client in `apps/server/test/messenger-send.test.ts`; here the door's replies are stubbed.
  // P105 S3: the dialog shows the draft as the panel has it, and its Send applies only when the dry run reads that same text.
  const TEXT = "Hi Rita, yes, the 28th stands. 10:00 at the notary on Rua Augusta works for us. I will send the address the day before.";
  let serverText = "Hi Rita, the 28th stands (changed in the meantime).";
  const sends: unknown[] = [];
  const tickets: unknown[] = [];
  await page.route(/\/api\/projects\/[^/]+\/messengers\/drafts\/\d+\/send$/, async (r) => {
    const body = r.request().postDataJSON() as { apply: boolean };
    sends.push(body);
    await r.fulfill({ json: body.apply ? { ok: true, sendId: 77 } : { ok: true, dryRun: true, channel: "telegram_user", chatId: "700100", account: "100200300", to: RITA, text: serverText } });
  });
  await page.route(/\/api\/sends\/tickets$/, async (r) => {
    tickets.push(r.request().postDataJSON());
    await r.fulfill({ json: { ticket: "t".repeat(43), expiresAt: "2099-01-01T00:00:00.000Z" } });
  });
  await page.goto(at(P, "/messengers"));
  const send = conversation(page).getByRole("button", { name: `Send the reply to ${RITA}` });
  const draft = conversation(page).getByTestId("messenger-draft");
  await expect(draft).toBeVisible();
  // P105: Send opens the review dialog with the exact text; Esc closes it and nothing was called.
  await send.click();
  const dialog = page.getByTestId("review-dialog");
  await expect(dialog.getByRole("heading", { name: `Send to ${RITA}?` })).toBeVisible();
  await expect(dialog).toContainText(TEXT);
  await expect(dialog.getByTestId("review-confirm")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(send).toBeVisible();
  expect(sends).toEqual([]);
  // A dry run that reads another text than the dialog showed applies nothing: it says so, as a blocker.
  await send.click();
  await confirmReview(page);
  await expect(dialog.getByText(/The draft changed while you read/)).toBeVisible();
  expect(sends).toEqual([{ apply: false }]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // Its Send runs the dry run and the apply of the text it showed, in one press.
  serverText = TEXT;
  await send.click();
  await confirmReview(page);
  await expect(page.getByText(`Sent to ${RITA} on Telegram`)).toBeVisible();
  expect(tickets).toEqual([{ project: P, draftId: expect.any(Number), kind: "messenger" }]);
  expect(sends.at(-1)).toEqual({ apply: true, confirm: { chatId: "700100", text: TEXT }, ticket: "t".repeat(43) });
});

test("messengers: Edit changes the draft's text, Skip sets it aside with Undo", async ({ page }) => {
  await page.goto(at(P, "/messengers"));
  await conversation(page).getByRole("button", { name: `Edit the draft for ${RITA}` }).click();
  // P123 U0: a plain-text composer, named by its aria-label: no formatting buttons until P93's RTF path lands.
  const box = page.getByLabel("Edit the messenger draft", { exact: true });
  await expect(box).toBeFocused();
  await expect(box).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(conversation(page).getByRole("toolbar")).toHaveCount(0);
  for (const name of ["Bold", "Italic", "Link", "Quote", "Bulleted list"]) await expect(conversation(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  await box.fill("Hi Rita, yes: the 28th at 10:00 stands.");
  await box.press("ControlOrMeta+Enter");
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("the 28th at 10:00 stands");
  await page.reload();
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("the 28th at 10:00 stands");

  await conversation(page).getByRole("button", { name: `Skip the draft for ${RITA}` }).click();
  await expect(page.getByText(`Skipped the draft for ${RITA}`)).toBeVisible();
  await expect(conversation(page).getByTestId("messenger-draft")).toHaveCount(0);
  // P115: with no draft the pane is the reply composer, and its header says a reply is owed.
  await expect(conversation(page).getByText(/Wrote you/)).toBeVisible();
  await expect(conversation(page).getByRole("button", { name: "Prepare reply" })).toBeVisible();
  await conversation(page).getByRole("button", { name: "Prepare reply" }).click();
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("fake");
});

// P127 C2 question 1: the open draft takes Mail's S, E and U: S skips it (toast with Undo), U puts it back, E opens its editor.
test("Messengers: S skips the open draft, U puts it back, E opens its editor, and none of them sends", async ({ page }) => {
  await page.goto(at(P, "/messengers"));
  const draft = conversation(page).getByTestId("messenger-draft");
  await expect(draft).toContainText("fake");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("s");
  await expect(page.getByText(`Skipped the draft for ${RITA}`)).toBeVisible();
  await expect(draft).toHaveCount(0);
  await page.keyboard.press("u");
  await expect(draft).toContainText("fake");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("e");
  await expect(page.getByLabel("Edit the messenger draft", { exact: true })).toBeFocused();
  // A key typed into the editor is text, not a Skip.
  await page.keyboard.press("s");
  await expect(draft).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(draft).toContainText("fake");
});

test("P128 X0 (F30): Activity's row of a messenger draft opens its chat, never Mail's Not found", async ({ page }) => {
  // The Prepare reply above recorded a messenger draft's event (skill messenger-reply); its client cell is the row's link.
  await page.goto(at(P, "/log"));
  const row = page.getByRole("row").filter({ hasText: "messenger-reply" }).filter({ hasText: RITA }).first();
  const link = row.getByRole("link", { name: new RegExp(RITA) });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/messengers\/c\/\d+/);
  await expect(conversation(page)).toContainText("Is the notary on the 28th still on?");
  await expect(page.getByText(/Not found/)).toHaveCount(0);
});

test("messengers settings: a chat's reply mode and instruction are saved and read back", async ({ page }) => {
  await page.goto(at(P, "/settings/messengers"));
  const rules = page.getByRole("listitem", { name: `Rules for ${RITA}` });
  // P128 X5: one line per chat with its values; Edit opens the rules in place.
  await expect(rules.getByTestId("chat-rules-line")).toContainText(/Telegram · Draft replies · no instruction/);
  // The toggle says what it does: "Edit the rules for…" closed, "Done the rules for…" open.
  const edit = rules.getByRole("button", { name: new RegExp(`^(Edit|Done) the rules for ${RITA}$`) });
  await edit.click();
  await expect(edit).toHaveAttribute("aria-expanded", "true");
  await rules.getByRole("button", { name: "Only when I ask" }).click();
  await expect(rules.getByRole("button", { name: "Only when I ask" })).toHaveAttribute("aria-pressed", "true");
  await rules.getByLabel("Your instruction for this chat").fill("Short and formal.");
  await rules.getByRole("button", { name: "Save instruction" }).click();
  await expect(rules.getByRole("button", { name: "Save instruction" })).toBeDisabled();
  await page.reload();
  await expect(rules.getByTestId("chat-rules-line")).toContainText("Only when I ask · own instruction");
  await rules.getByRole("button", { name: `Edit the rules for ${RITA}` }).click();
  await expect(rules.getByRole("button", { name: "Only when I ask" })).toHaveAttribute("aria-pressed", "true");
  // P93: the instruction is a Markdown editor, so its text is read, not a value.
  await expect(rules.getByLabel("Your instruction for this chat")).toHaveText("Short and formal.");
  // P71 M-P: the switch's note says what it does (the e2e server runs HUB_LLM=fake: nothing leaves it).
  await expect(rules.getByText(/A cheap model reads each new message and the two before it/)).toBeVisible();
  await expect(rules.getByText(/local test model; no request leaves this computer/)).toBeVisible();
  await expect(page.getByText(/nothing reads this switch/)).toHaveCount(0);
  await page.goto(at(P, "/messengers?filter=all&link=linked"));
  await expect(rita(page)).toContainText(/Only when I ask|Client wrote|Draft ready/);
  // Back to the default, so the specs after this one see the seed's rules.
  await page.goto(at(P, "/settings/messengers"));
  await rules.getByRole("button", { name: `Edit the rules for ${RITA}` }).click();
  await rules.getByRole("button", { name: "Draft replies" }).click();
  await expect(rules.getByRole("button", { name: "Draft replies" })).toHaveAttribute("aria-pressed", "true");
});

// P128 X5: the Reply policy block went (project.md says it; a chat's own rules are on its line), and so did the
// "since the server started" count.
test("messengers settings: no Reply policy block and no since-start count", async ({ page }) => {
  await page.goto(at(P, "/settings/messengers"));
  await expect(page.getByRole("listitem", { name: `Rules for ${RITA}` })).toBeVisible();
  await expect(page.getByRole("region", { name: "Reply policy" })).toHaveCount(0);
  await expect(page.getByText(/since the server started/)).toHaveCount(0);
});

/** Stubs M1's account routes: none connected, then one after the login's last step. Records each POST's path and body. */
async function stubTelegram(page: Page, opts: { connected: boolean }) {
  const posts: { path: string; body: unknown }[] = [];
  let connected = opts.connected;
  const account = { account: "42", state: "running", parked: null, fix: null, failures: 0, stored: 0 };
  await page.route(/\/api\/messengers\/telegram-user$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: connected ? [account] : [] } }));
  const reply = (json: unknown) => async (r: Route) => {
    posts.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    await r.fulfill({ json });
  };
  const FLOW = "flow-0123456789abcdef";
  await page.route(/\/login\/start$/, reply({ step: "code", flow: FLOW }));
  await page.route(/\/login\/code$/, reply({ step: "password", flow: FLOW }));
  await page.route(/\/login\/password$/, async (r) => {
    connected = true;
    await reply({ step: "done", account: "42", name: "Mark Owner" })(r);
  });
  return { posts, flow: FLOW };
}

test("messengers settings: the connect form drives M1's routes step by step, with the risk sentence", async ({ page }) => {
  const t = await stubTelegram(page, { connected: false });
  await page.goto(at(P, "/settings/messengers"));
  const form = page.getByTestId("telegram-connect");
  await expect(form.getByText(/your own, personal Telegram account/)).toBeVisible();
  await form.getByLabel("api_id").fill("12345");
  await form.getByLabel("api_hash").fill("0123456789abcdef0123456789abcdef");
  await form.getByLabel("Phone").fill("+351 900 000 000");
  await form.getByRole("button", { name: "Send me the code" }).click();
  await form.getByLabel("Code").fill("12345");
  await form.getByRole("button", { name: "Continue" }).click();
  await form.getByLabel("Password").fill("secret");
  await form.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("list", { name: "Telegram accounts" }).getByText("Telegram account 42")).toBeVisible();
  expect(t.posts).toEqual([
    { path: "/api/messengers/telegram-user/login/start", body: { apiId: 12345, apiHash: "0123456789abcdef0123456789abcdef", phone: "+351 900 000 000" } },
    { path: "/api/messengers/telegram-user/login/code", body: { flow: t.flow, code: "12345" } },
    { path: "/api/messengers/telegram-user/login/password", body: { flow: t.flow, password: "secret" } },
  ]);
  // Nothing of the login reached the address.
  expect(page.url()).not.toMatch(/12345|secret|0123456789abcdef/);
});

test("messengers settings: Telegram QR login rotates and accepts a two-step password", async ({ page }) => {
  const posts: { path: string; body: unknown }[] = [];
  const flow = "flow-qr-0123456789abcdef";
  const rows = (dark: string) => Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x === y ? dark : "0")).join(""));
  const expiresAt = "2099-01-01T00:00:00.000Z";
  let connected = false;
  let polls = 0;
  const record = (r: Route) => posts.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
  await page.route(/\/api\/messengers\/telegram-user$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: connected ? [{ account: "42", state: "running", parked: null, fix: null, failures: 0, stored: 0 }] : [] } }));
  await page.route(/\/login\/start$/, (r) => {
    record(r);
    return r.fulfill({ json: { step: "qr", flow, qr: rows("1"), expiresAt } });
  });
  await page.route(/\/login\/status$/, (r) => {
    record(r);
    polls++;
    return r.fulfill({ json: polls === 1 ? { step: "qr", flow, qr: rows("0"), expiresAt } : { step: "password", flow } });
  });
  await page.route(/\/login\/password$/, (r) => {
    record(r);
    connected = true;
    return r.fulfill({ json: { step: "done", account: "42", name: "Mark Owner" } });
  });

  await page.goto(at(P, "/messengers/settings"));
  const form = page.getByTestId("telegram-connect");
  await form.getByLabel("api_id").fill("12345");
  await form.getByLabel("api_hash").fill("0123456789abcdef0123456789abcdef");
  await expect(form.getByLabel("Phone")).toHaveValue("");
  await form.getByRole("button", { name: "Sign in with QR code" }).click();
  const qr = form.getByRole("img", { name: "QR code to scan with Telegram on your phone" });
  await expect(qr).toBeVisible();
  await expect(form.getByText(/Devices ▸ Link Desktop Device/)).toBeVisible();
  const firstPath = await qr.locator("path").getAttribute("d");
  await expect.poll(() => qr.locator("path").getAttribute("d")).not.toBe(firstPath);
  await expect(form.getByLabel("Password")).toBeVisible();
  await expect(qr).toHaveCount(0);
  await form.getByLabel("Password").fill("secret");
  await form.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("list", { name: "Telegram accounts" }).getByText("Telegram account 42")).toBeVisible();
  expect(posts).toEqual([
    { path: "/api/messengers/telegram-user/login/start", body: { apiId: 12345, apiHash: "0123456789abcdef0123456789abcdef", method: "qr" } },
    { path: "/api/messengers/telegram-user/login/status", body: { flow } },
    { path: "/api/messengers/telegram-user/login/status", body: { flow } },
    { path: "/api/messengers/telegram-user/login/password", body: { flow, password: "secret" } },
  ]);
  expect(page.url()).not.toMatch(/flow-qr|12345|secret|0123456789abcdef/);
});

test("messengers settings: an expired Telegram QR login can restart and leaving two-step login cancels its flow", async ({ page }) => {
  const flows = ["flow-qr-expired-0123456789", "flow-qr-restarted-0123456789"];
  const cancelled: unknown[] = [];
  let starts = 0;
  await page.route(/\/api\/messengers\/telegram-user$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: [] } }));
  await page.route(/\/login\/start$/, (r) => r.fulfill({ json: { step: "qr", flow: flows[starts++], qr: null, expiresAt: null } }));
  await page.route(/\/login\/status$/, (r) => {
    const body: unknown = r.request().postDataJSON();
    if (JSON.stringify(body) === JSON.stringify({ flow: flows[0] })) return r.fulfill({ status: 409, json: { code: "wrong_state", error: "The QR login expired." } });
    return r.fulfill({ json: { step: "password", flow: flows[1] } });
  });
  await page.route(/\/login\/cancel$/, (r) => {
    cancelled.push(r.request().postDataJSON());
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto(at(P, "/messengers/settings"));
  const form = page.getByTestId("telegram-connect");
  await form.getByLabel("api_id").fill("12345");
  await form.getByLabel("api_hash").fill("0123456789abcdef0123456789abcdef");
  await form.getByRole("button", { name: "Sign in with QR code" }).click();
  await expect(form.getByRole("alert")).toContainText("The QR login expired. Start a new login.");
  await form.getByRole("button", { name: "Sign in with QR code" }).click();
  await expect(form.getByLabel("Password")).toBeVisible();
  await page.getByRole("navigation", { name: "Sections" }).first().getByRole("link", { name: "Messengers" }).click();
  await expect.poll(() => cancelled).toContainEqual({ flow: flows[1] });
});

test("messengers settings: WhatsApp shows the QR code only after Connect, then the linked number", async ({ page }) => {
  // P71 M5: the routes are stubbed; the server side of the pairing runs on a fake Baileys socket in
  // `apps/server/test/messengers/accounts/whatsapp.test.ts`. Nothing here reaches WhatsApp and no code is scanned.
  const posts: string[] = [];
  let linked = false;
  let reads = 0;
  const FLOW = "flow-wa-0123456789abcdef";
  const account = { account: "351900000001", state: "running", parked: null, fix: null, failures: 0, stored: 0 };
  const rows = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => ((x * y + x) % 3 === 0 ? "1" : "0")).join(""));
  await page.route(/\/api\/messengers\/whatsapp$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: linked ? [account] : [] } }));
  await page.route(/\/api\/messengers\/whatsapp\/connect$/, async (r) => {
    posts.push(new URL(r.request().url()).pathname);
    await r.fulfill({ json: { flow: FLOW } });
  });
  await page.route(/\/api\/messengers\/whatsapp\/connect\/state$/, async (r) => {
    posts.push(new URL(r.request().url()).pathname);
    expect(r.request().postDataJSON()).toEqual({ flow: FLOW });
    reads++;
    if (reads < 2) return r.fulfill({ json: { step: "qr", size: 21, rows } });
    linked = true;
    return r.fulfill({ json: { step: "done", account: account.account, name: "Mark Owner" } });
  });
  await page.goto(at(P, "/settings/messengers"));
  const box = page.getByTestId("whatsapp-connect");
  await expect(box.getByText(/your own, personal WhatsApp number/)).toBeVisible();
  await expect(box.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  expect(posts).toEqual([]);
  await box.getByRole("button", { name: "Connect" }).click();
  await expect(box.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(box.getByText(/Linked devices ▸ Link a device/)).toBeVisible();
  // P126 S1: the admin reads the pairing again on the server's `connections` bump, not on a timer. The stubbed pairing moves
  // nothing on the server, so the spec makes the bump the way the server does: a change in the stack's own secrets folder.
  const bump = join(process.env.HUB_E2E_HOME ?? "", "secrets", "e2e-live-bump");
  mkdirSync(dirname(bump), { recursive: true });
  writeFileSync(bump, String(Date.now()));
  await expect(page.getByRole("list", { name: "WhatsApp numbers" }).getByText("WhatsApp +351900000001")).toBeVisible();
  rmSync(bump, { force: true });
  expect(posts.slice(0, 2)).toEqual(["/api/messengers/whatsapp/connect", "/api/messengers/whatsapp/connect/state"]);
  expect(page.url()).not.toMatch(/flow-wa/);
});
