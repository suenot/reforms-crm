/**
 * The endpoint ledger of the browser JSON boundary (P114, P120 W2; in the core since P119 so that no core test reads the plan
 * repo). Every `operationId` of the emitted `openapi.json` is listed under its domain, exported by the public `@hub/api` barrel
 * and called by one admin facade in `lib/api/*`; no admin module writes an `/api/` path. Two kinds are named on purpose:
 *
 * - `URL_HELPERS`: operations the admin reaches only through their generated URL (`get<Operation>Url`), because the call is not
 *   an ordinary JSON fetch: a stream, a file, a multipart form, a keepalive beacon at page close.
 * - `DOORS`: the owner-confirmed sends and their tickets, credential writes, owner-gated identity writes and the autopilot's switches (P139). Each is imported
 *   only by the facade named beside it, which keeps the door's semantics (generated-api-clients.md rules 5 and 12).
 *
 * Adding an endpoint: declare it in `apps/server/src/<domain>/openapi.ts`, generate, export it from `src/index.ts`, call it from
 * a facade, and list it here. `apps/admin/test/rules.test.ts` fails when the spec, the barrel and this ledger disagree.
 */
export const GENERATED_OPERATIONS = {
  instance: ["getInstance", "getInstanceLogo", "getCoreUpdate", "checkCoreUpdate", "getAutostart", "setAutostart", "listConnections", "testConnection", "setConnectionSecret", "removeConnectionSecret", "getOpsErrors", "getOpsLines", "checkApps", "openLocal", "streamLive"],
  overview: ["getHealth", "getPulse", "getOverview", "getScheme"],
  projects: ["listProjects", "getProjectOverview", "getProjectDoctor", "getActivity", "getProjectLinks", "listKnowledge", "getKnowledgeText", "listSequences", "listEnrollments", "stopEnrollment", "listFollowUps", "runFollowUps", "setFollowUp", "getLeadPass", "runLeadPass", "redoLead"],
  mail: [
    "listDrafts", "setDraftChecked", "setDraftStatus", "setDraftTone", "ackDraftCheck", "undoDraftStatus", "setClientMarks", "getClientTimeline", "getClientHistory", "listBatches", "getBatch", "undoBatch", "acknowledgeBatchWarnings", "getSafetyRules", "setSafetyRule", "getAgentSettings", "setAgentSettings",
    "listConversations", "getClientByKey", "getClientMap", "listStuckClients", "getConversation", "getConversationMail", "getConversationText", "refreshConversation", "createManualMailDraft", "getDraftMail", "saveDraftMail", "restoreDraftMail", "tidyDraftMail", "listInbox", "listNotByEmail", "listInbound", "checkInbound", "undismissInbound", "dismissInbound", "moveInboundMail",
    "getInboundDetail", "getInboundText", "listLeads", "getLeadDetail", "notNowLead", "spamLead", "undoLead",
  ],
  messengers: [
    "getTelegramUserStatus", "startTelegramUserLogin", "getTelegramUserLoginStatus", "sendTelegramUserCode", "sendTelegramUserPassword", "cancelTelegramUserLogin", "disconnectTelegramUser", "getWhatsAppStatus", "startWhatsAppConnect", "readWhatsAppConnect", "cancelWhatsAppConnect", "disconnectWhatsApp",
    "getAutolinkState", "previewAutolink", "findAutolinkRecords", "linkChatRecord", "createChatRecord", "hideChat", "unhideChat", "dropHideProposals", "listAccountDialogs", "changeChatClient", "undoChatClient", "addChatClientEmail", "unlinkChat", "neverLinkChat",
    "listMessengerChats", "getMessengerConversation", "createMessengerDraft", "editMessengerDraft", "skipMessengerDraft", "restoreMessengerDraft", "prepareMessengerReply", "setMessengerChatRules", "markMessengerChatDone", "undoMessengerChatDone",
    "createAutopilotTicket", "getAutopilot", "setAutopilot", "getProjectAutopilot", "setProjectAutopilot",
  ],
  send: ["createSendTicket", "createBatchSendTicket", "sendOneMailDraft", "sendMessengerDraft", "getBatchSend", "runBatchSend", "stopBatchSend", "getLeadReview", "confirmLeadReview", "listSends", "cancelSend", "stopSends", "resumeSends"],
  agent: ["getAgentFeed", "getAgentTools", "refreshAgentTools", "postFocus", "getPointer"],
  terminal: ["getTerminal", "createTerminalSession", "ensureTerminalSession", "dropTerminalFiles", "closeTerminalSession", "createTerminalTicket"],
  watch: ["listWatchProjects", "getWatch", "joinWatchGroup"],
} as const;

export type GeneratedOperation = (typeof GENERATED_OPERATIONS)[keyof typeof GENERATED_OPERATIONS][number];

/** Operations reached only through their URL helper, with the reason and the one admin module that uses it. */
export const URL_HELPERS: Readonly<Partial<Record<GeneratedOperation, { file: string; why: string }>>> = {
  streamLive: { file: "lib/api/instance.ts", why: "server-sent events, opened with EventSource (architecture rule 16)" },
  getInstanceLogo: { file: "lib/api/instance.ts", why: "an image file, the brand's <img> source" },
  dropTerminalFiles: { file: "lib/api/terminal.ts", why: "a multipart form of files (P76)" },
  postFocus: { file: "lib/api/terminal.ts", why: "the clear at page close, a keepalive beacon that outlives the page" },
};

/** The doors by the facade that may import them (an operation listed under two files may be imported by both, by no other) (send-boundary and generated-api-clients rule 12). */
export const DOORS: Readonly<Record<string, readonly GeneratedOperation[]>> = {
  "lib/api/send.ts": ["createSendTicket", "createBatchSendTicket", "sendOneMailDraft", "getBatchSend", "runBatchSend", "stopBatchSend", "confirmLeadReview", "cancelSend", "stopSends", "resumeSends"],
  "lib/api/messengers/send.ts": ["createSendTicket", "sendMessengerDraft"],
  "lib/api/connections.ts": ["setConnectionSecret", "removeConnectionSecret"],
  "lib/api/messengers/telegram-user.ts": ["startTelegramUserLogin", "getTelegramUserLoginStatus", "sendTelegramUserCode", "sendTelegramUserPassword", "cancelTelegramUserLogin", "disconnectTelegramUser"],
  "lib/api/messengers/whatsapp.ts": ["startWhatsAppConnect", "readWhatsAppConnect", "cancelWhatsAppConnect", "disconnectWhatsApp"],
  "lib/api/messengers/autopilot.ts": ["createAutopilotTicket", "setAutopilot", "setProjectAutopilot"],
  "lib/api/instance.ts": ["openLocal"],
  "lib/api/terminal.ts": ["createTerminalTicket", "postFocus"],
  // P144: Join asks Telegram to add the owner's account to one public group, on his click only.
  "lib/api/project/watch.ts": ["joinWatchGroup"],
};

export const generatedOperations = (): readonly GeneratedOperation[] => Object.values(GENERATED_OPERATIONS).flat();
