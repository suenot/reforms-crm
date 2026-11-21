# Access: which credential goes to what

The single owner page for access. Every other page links here instead of repeating it. A check for each row is a `hub doctor` step; the full ordered list of steps is the generated [`checklist.md`](checklist.md).

No secret is ever stored in git, a log or a page. Secrets live only in the git-ignored `state/secrets/` of the instance (folder mode 700, files mode 600). `HUB_CONFIG_DIR` overrides the folder.

## At a glance

| Access | Goes to | Stored in | Needed for | Verified by |
|---|---|---|---|---|
| Notion connector (OAuth) | The Notion workspace the agent reads and writes in a session | The CLI's own store: Claude Code after `/mcp`; Codex per project home after `codex mcp login notion`; no file of the hub | Every agent session | `notion.connector` (hint only), Agent tools `notion.signin` (P82: what the CLI knows, never a call of the hub's own: Claude Code from this project's session log, a Notion tool answered or a sign-in request; Codex from `codex mcp list --json` `auth_status`, a warning only when Codex is the default CLI or tried Notion) |
| Notion hub integration (read, plus the send stamp) | Every database of each project, whole teamspace | `state/secrets/notion-token` | `notion-dump`, backups, the project doctor's database check, and the server's autolink directory (P84: the project's `clients` data source read into memory at start and every 6 h, never stored; `apps/server/src/clients/directory.ts`), and `hub mcp`'s new-thread check (P87: one filtered query of the project's `clients` data source by the address a new thread goes to, only when the project has no record of it; nothing stored; `packages/notion/src/client-lookup.ts`), and the send stamp (P89: `Last sent at` / `Last sent by` on the client's page after a confirmed send; needs Update content), and the leads (P97: the server's Leads reader lists the project's `leads` data source at start, every 15 min and after a lead notice, keeping decision 0013's minimum in `lead_rows`; at the first confirmed send to a lead it sets the lead's Status and Client and, for a person with no card, creates one Clients page; Spam on the owner's click; needs Update content and Insert content; `apps/server/src/clients/leads-reader.ts`, `packages/notion/src/lead-convert.ts`), and the Chats link box (P100: one live filtered query of the `clients` data source per search, nothing stored; on the owner's click one new Clients page from a chat, and after his Link the page's empty Telegram or WhatsApp; needs Insert content and Update content; `packages/notion/src/chat-client.ts`, `apps/server/src/messengers/autolink/routes.ts`) | `notion.token`, `notion.access` |
| Notion backend integration (django_notion) | Leads and Clients (write) | The backend's environment; never in the hub | A site's form handler writing leads | Owner only (see below) |
| Mail account | Mail.app, through `mail-mcp` on `localhost:8787` (the agent, read) and `osascript` (the hub: drafts by `hub mcp` `draft_write`, the send, Sent detection) | Mail.app; the name in `config/config.json`; no file in the hub | Reading mail, creating unsent drafts, the confirmed send, Sent detection | `mail.daemon`, `mail.account` |
| Telegram bot token (optional) | A bot made with @BotFather | `state/secrets/telegram-bot-token` | The receive-only poller | `messengers.token`, `telegram.getme`, `messengers.poller` |
| Telegram user account (optional, P71) | The owner's own Telegram account over MTProto (mtcute): `api_id` and `api_hash` from my.telegram.org, then a phone and code or a QR scan on Messengers ▸ Settings, with a two-step verification password when required | `state/secrets/sessions/telegram_user-<id>/session` (mode 600: the session string with the `api_id` and `api_hash` it needs; never the phone, code or password); not in `app.db`, not in a backup: recovery is a new login | Receiving his linked chats and sending a draft on his Send through the send door (decision 0036, P71 M4); reading the public groups a project's `watch.md` lists while its `on` is `yes`, and joining one only on his Join (P144: resolve, history, join; never a post, reaction or read mark; `apps/server/src/watch/reader.ts`) | `telegramUser` in `/api/health`; a parked account on Overview |
| WhatsApp linked device (optional, P71 M5) | The owner's own WhatsApp number, linked like WhatsApp Web (Baileys): he presses Connect on Messengers ▸ Settings and scans the QR code with his phone; no password or code is typed | `state/secrets/sessions/whatsapp-<number>/` (folder 700, files 600: Baileys' creds and Signal keys; nothing before the scan); not in `app.db`, not in a backup: recovery is a new scan. Disconnect logs the device out on WhatsApp's side and deletes the folder | Receiving his linked chats and sending a draft on his Send through the send door | `whatsapp` in `/api/health`; a parked number on Overview |
| Autolink key (P84) | Nothing external: the HMAC key that hashes the chats the owner refused ("not a client") | `state/secrets/autolink-key` (mode 600, written by the server on first use); not backed up: a new key forgets the refusals | `messenger_link_refusals`, so a refused chat is never linked by itself again | `backup.secrets` (names and modes only) |
| Backup snapshot (`hub backup`) | Nothing external: a folder (default `<instance>/backups/`, git-ignored) | `backups/` or `backup_dir` in `config/config.json` | A copy of the database, the Notion dump and the config that git does not hold | `backup.snapshot` |
| Lead-form canary secret (optional) | One site's form handler: an HMAC key it shares with the hub, one per handler | `state/secrets/<secretRef>` (named in `config/lead-forms.json`); the same value in the site's environment | `hub doctor --only Leads --canary` ([`../core/22-lead-forms.md`](../core/22-lead-forms.md)) | the `leads.<form>` rows (WARN "canary not run" when missing) |
| Claude Code sign-in | The `claude` CLI on this machine | Claude's own store | `hub agent` (the default CLI) | `tools.claude`, Agent tools |
| OpenRouter key (optional, P78) | The Hub's own OpenRouter key, with its own monthly limit set at OpenRouter (not the MLS key) | `OPENROUTER_API_KEY`, else `state/secrets/openrouter-key` (the key alone, mode 600; never logged, never backed up) | `@hub/llm`: cheap structured calls inside work already started ([`../core/27-llm.md`](../core/27-llm.md)); without it every caller says "not analysed" | the Overview's LLM part, once a caller was refused |
| Codex sign-in (optional) | The `codex` CLI on this machine | Codex's `auth.json`; each project's Codex home (`state/codex/<slug>/`) links to it, never a copy | `hub agent --cli codex` | Agent tools `cli.signed-in` |

The hub holds one API key, OpenRouter's, for `@hub/llm` (decision 0039 point 2; until P78 it held none), and no other: none for Claude or Codex (each CLI signs in itself), no Cloudflare credential and no mail login. Through that key the Hub sends client text it already stores to a third party, with `data_collection: "deny"` on every request ([`../core/27-llm.md`](../core/27-llm.md)). The send policy (`state/projects/<slug>/send-policy.json`) and the admin's send ticket are permissions, not credentials: [`../core/24-terminal.md`](../core/24-terminal.md). Mail routing at Cloudflare and any DNS are outside this code; they are not checked here.

## Notion

Two different integrations may exist. They are separate Notion integrations with separate tokens and must not be mixed up.

### The hub integration (read)

An internal integration the owner creates once, in the workspace that holds the CRM teamspaces (notion.so/profile/integrations; creating one needs a workspace owner or admin).

- Capabilities: **Read content**, **Update content** and **Insert content**. The Hub's writes are exactly these, and nothing else is updated, moved or deleted:
  - P89 (decision 0043), Update content: after a confirmed send, `Last sent at` and `Last sent by` on the client's Clients page (`app/packages/notion/src/stamp.ts`; project setting `notion.stamp_sends`, on by default).
  - P97 (decision 0044), Update content: a lead's `Status` (In progress at the first confirmed send to the lead, Spam on the owner's click, New on its Undo) and its `Client` relation (`app/packages/notion/src/lead-convert.ts`; project setting `notion.convert_leads`, on by default).
  - P97, **Insert content**: one new Clients page (Name, Email, Phone, Relationship Lead, Brand) for a lead who has no card, at the first reply sent to them. Without Insert content the Hub only links existing cards; the lead card then says that a new card needs it, or "заведи клиента" in the dock.
  - P100, **Insert content** and **Update content**: on the owner's Create in Messengers ▸ Chats, one Clients page (Name, Email, Relationship Lead, the chat's Telegram username or WhatsApp number); after his Link of a chat, the page's `Telegram` or `WhatsApp` when it is empty (never a filled one). A refusal is said on the screen with this fix.
  - A refused write (403) is one ops-log line (`hub logs --source notion`) and, for a lead, a note on its card and the doctor's `notion lead writes` row; it never touches the send. Notion's API does not report an integration's capabilities, so a missing Insert content shows only at the first card the Hub tries to create. Each teammate who should stamp needs the token on their Mac (`./run.sh token notion`).
- Where to tick the capabilities: app.notion.com → Developer tools → Developer connections → the connection "Hub: <Instance>" → Configuration → Capabilities → Content capabilities: tick Read content, Update content, Insert content (never a delete); the teamspace grant is the Content access tab of the same page.
- Share it with **the whole teamspace** of each project (open the teamspace, `... > Connections`, add the integration). It must reach:
  - every database listed under `## Notion databases` in `projects/<slug>/project.md`: `clients`, `leads`, `tasks`, `documents` (the core databases; conversation reports are Documents of Type Report) and, where the project has them, `bug-reports` (P145), `deals`, `organizations` and `open-loops` (the optional legacy module, never written by the Hub), `expenses`, `payments`, `business-contacts`, `knowledge`;
  - every database those point to through a relation, for example Leads and People (Clients), even when it is not listed.
- The rule of Notion: sharing is per page, database or teamspace. A page shared with an integration shares its children, not its siblings, and a relation target must be shared on its own. A database that is moved to another place, or re-created, **loses its grant**: share the whole teamspace again and read one row to confirm.
- A database that has been archived or merged away still answers 200. The doctor reads the `archived` and `in_trash` flags and fails on it: remove the stale line from `project.md`.
- Store it with `./run.sh token notion` (hidden prompt or standard input), or in Settings ▸ Connections of the admin. A wrong or missing token fails `notion.token`; a database it cannot see fails `notion.access` and names the database.

### The Notion connector (session)

The Notion connector is what an agent session writes CRM pages with. It needs no token and sees what its user sees. Sign in once with `/mcp` in Claude Code; for Codex once per project home (`CODEX_HOME=state/codex/<slug> codex mcp login notion`, the fix line the Agent tools row prints). `notion.connector` only checks that `.mcp.json` lists the server; Agent tools (`hub doctor --only Agent`, or Connections) shows per CLI whether it answers.

### The backend integration (django_notion)

The owner's own backend writes leads (and clients) into the CRM from a site's form. This is a second integration, with its own token held in the backend's environment. The hub does not read it and the doctor cannot check it.

- Capabilities: Read content, Insert content and Update content.
- Share it with Leads and Clients, which means the whole teamspace (Leads is a top-level database, so sharing a page is not enough).
- It must follow the writer contract in [`../core/21-leads.md`](../core/21-leads.md): `Hub run id` as the idempotency key, only existing select options, no change to Status after create.
- To verify: submit one test lead through the site and look for the row in Leads.

## Mail

- **Mail.app** holds the account (System Settings > Internet Accounts). Keep Mail.app running. The account's exact name goes into `config/config.json` (`account`), with the allowed sender addresses in `allow_list`.
- **mail-mcp** (`brew install dastrobu/tap/mail-mcp`, `brew services start mail-mcp`) reads Mail.app for the agent; its draft tools are denied (they need Mail in front). Drafts are written by `hub mcp` through `osascript`, with the Automation permission the hub's send already needs. macOS must allow mail-mcp under Privacy & Security: Automation.
- **The hub** talks to Mail.app through `osascript` for the confirmed send and for Sent detection (it reads the project's `mail.sent_mailbox` while drafts wait and never launches Mail). macOS asks once to allow the hub to control Mail (Automation); a server started at login by the instance's LaunchAgent (P67) is a different responsible process from Terminal, so macOS may ask once more for it. The LaunchAgent itself needs no key: macOS lists it under System Settings > General > Login Items > Allow in the Background, and that toggle is the owner's (`autostart.agent` warns when the agent did not run after the last boot). There is no mail login and no mail key in `state/secrets/` (decision 0026).
- A project names its accounts in `project.md` (`mail.accounts`). `hub doctor <project>` fails when an account is not in Mail.

## Telegram (optional)

Create a bot with @BotFather and store the token in `state/secrets/telegram-bot-token` (one `<digits>:<secret>` line) with `./run.sh token telegram`. The server then polls and stores messages; it never sends. A new token applies on the next server start. `telegram.getme` makes one read-only call to confirm Telegram accepts it.

## Telegram user account (optional)

The owner's own account, connected as a real client (decision 0036; the risk of a ban is his, taken knowingly, and he chose his main number). He creates an app on my.telegram.org for its `api_id` and `api_hash` and enters them on Messengers ▸ Settings. He can enter his phone number and the code, or choose QR sign-in and scan the code from Telegram ▸ Settings ▸ Devices ▸ Link Desktop Device. Either method asks for his two-step verification password when required. The QR code refreshes while the attempt is open. The server hands each value to mtcute and writes only the final session to `state/secrets/sessions/telegram_user-<id>/session`. A revoked session, a ban or a flood wait over an hour parks the account: nothing reconnects it until he logs in again. Disconnect deletes the folder. Only chats linked to a client are stored (his Link, or the autolink on an exact match, P84). The session sends only a draft he confirmed through the send door (P71 M4). P144: the same session reads the public groups a watch list names (off until `on: yes`), at most one call every 3 s, waiting while his own calls run; a `FLOOD_WAIT` on a watcher call parks the watcher, not the account ([../core/31-watch.md](../core/31-watch.md)).

## WhatsApp linked device (optional)

The owner's own number (decision 0036 point 2; not the WhatsApp Business API, and the risk of a ban is his). On Messengers ▸ Settings ▸ WhatsApp he presses Connect and scans the QR code with his phone (WhatsApp ▸ Settings ▸ Linked devices ▸ Link a device); a code lives about 20 s and a pairing 3 minutes. Nothing is written before the scan; then the server stores Baileys' creds and keys under `state/secrets/sessions/whatsapp-<number>/` and connects the number. A logged-out device (401) or a ban (403) parks the number: nothing reconnects it until he scans again. A copy of the folder on another Mac is a second device on the same keys, so it is never synced or backed up (decision 0043 point 3). Disconnect logs the device out on WhatsApp's side and deletes the folder. Only linked chats are stored, and a draft is sent only on his Send through the send door.

## Backups need access too

`backup.git` needs a remote on which the instance, the core and any path in `backup_repos` (`config/config.json`) are pushed; `backup.notion` needs the hub integration above; `backup.secrets` checks only the names and modes of the files in `state/secrets/`. An off-machine copy of that folder is the owner's job and no step can see it.

### Snapshots (`hub backup`)

`hub backup` is run by the owner (nothing schedules it; decision 0023). It needs no credential of its own and never reads or copies a secret: with `--notion-dump` the dump is a child process that loads the hub integration token itself, and the manifest lists only the NAMES of the secret files.

- **Where:** `<instance>/backups/<YYYYMMDD-HHMMSS>/`, git-ignored (`backups/` is in the instance `.gitignore` and in the template `hub new-instance` uses). `backup_dir` in `config/config.json` moves it (a path relative to the instance folder, such as `../shared-backups`, or an absolute path, for example a Google Drive for desktop folder; no `~`); a folder inside `state/` or the core is refused. The command refuses to run, and `backup.snapshot` fails, when a folder inside the instance is tracked by git or not ignored.
- **One folder, one path:** there is a single backup folder. To survive a dead disk, point `backup_dir` at a folder outside this computer's disk, for example a Google Drive for desktop folder (an absolute path). `backup.snapshot` warns while the folder is inside the instance (next to the data it protects) and passes when it points outside. The newest 14 snapshots are kept in that one folder.
- **What a snapshot holds:** `data/app.db` (`VACUUM INTO` copy, `integrity_check` passed), `config/config.json`, `projects/<slug>/dumps/<date>/` (a COPY of each project's newest existing Notion dump, its age reported, WARN over 7 days with the fix line; `--notion-dump` runs a live dump first, which needs the token and takes minutes to hours), and `manifest.json` (time, core version, instance, sha256 and size of every file, and the table and row counts of the copied database).
- **Use:** `hub backup` (dry run), `hub backup --apply`, `hub backup --apply --notion-dump`, `hub backup --verify [snapshot]`. The newest 14 are kept; `--apply` deletes older ones, only folders with a valid manifest. `--verify` and `backup.snapshot` also RESTORE the snapshot's database: the file is copied into a temporary folder, opened with the current migrations, integrity-checked and its table and row counts compared with the manifest (a snapshot made before v0.6.13 recorded no counts and is only opened and checked); the folder is removed, and a snapshot that cannot restore fails the doctor. Putting a snapshot back into a live instance is never run by the tool: copy files back by hand.
- **A stale Google Drive mount:** after a restart Drive for desktop can also show an old mount named `GoogleDrive-<account> (dd.mm.yyyy hh:mm)` beside the live `GoogleDrive-<account>`. A snapshot made under the dated one is not in your Drive, so `hub backup` and `backup.snapshot` refuse such a `backup_dir` and say which folder to use instead.

## Nothing in the user's home

No credential and no skill is written to the user's home; the one exception (the optional `hub` shortcut) and the old `~/.claude/skills` links (`skills.legacy`) are in [`../core/08-local-app-stack.md`](../core/08-local-app-stack.md), "Where files live".

## Verify

- `hub doctor` runs every step; `hub doctor <project>` adds the project table (accounts, databases, knowledge).
- The ordered, generated list of every step and what it proves: [`checklist.md`](checklist.md).
- Notion in detail (the databases, every field, setup): [`../notion/README.md`](../notion/README.md).

Update this page when the architecture changes.
