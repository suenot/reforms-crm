import { chatRulesBody, messengerChatDoneDto, messengerChatDto, messengerChatsDto, messengerChatsQuery, messengerConversationDto, messengerDraftDto, messengerDraftTextBody, messengerPrepareBody, messengerSkippedDto } from "@hub/contract/messenger-panel";
import {
  autolinkCreateBody, autolinkDialogsBody, autolinkHiddenDto, autolinkHideBody, autolinkLinkBody, autolinkLinkedDto, autolinkMoveBody, autolinkPreviewDto, autolinkProposalsDropBody, autolinkProposalsDroppedDto, autolinkRecordsBody, autolinkRecordsDto, autolinkStateDto,
  chatEmailBody, chatEmailDto, chatMovedDto, chatMoveUndoBody, chatMoveUndoneDto, chatUnlinkedDto, telegramUserStatusDto, userDialogsDto, userDisconnectedDto, userLoginCancelBody, userLoginCancelledDto, userLoginCodeBody, userLoginPasswordBody, userLoginStartBody, userLoginStatusBody, userLoginStepDto,
  waConnectFlowBody, waConnectStartedDto, waConnectStepDto, whatsappStatusDto,
} from "@hub/contract/messengers";
import { accountParam, sendParam, slugParam } from "@hub/contract/requests";
import { autopilotInstanceDto, autopilotProjectDto, autopilotTicketBody, setAutopilotInstanceBody, setAutopilotProjectBody } from "@hub/contract/autopilot";
import { sendTicketDto } from "@hub/contract/sending";
import type { Operation } from "../http/openapi";

const step = { name: "UserLoginStep", schema: userLoginStepDto };
const cancelled = { name: "UserLoginCancelled", schema: userLoginCancelledDto };
const disconnected = { name: "UserDisconnected", schema: userDisconnectedDto };
const chat = { name: "MessengerChat", schema: messengerChatDto };
const draft = { name: "MessengerDraft", schema: messengerDraftDto };
const hidden = { name: "AutolinkHidden", schema: autolinkHiddenDto };
const linked = { name: "AutolinkLinked", schema: autolinkLinkedDto };
const unlinked = { name: "ChatUnlinked", schema: chatUnlinkedDto };
const autopilotInstance = { name: "AutopilotInstance", schema: autopilotInstanceDto };
const autopilotProject = { name: "AutopilotProject", schema: autopilotProjectDto };
// Every write here passes the admin gate (the page's own Origin, 403) and names its project (404 for another's).
const gated = [400, 403, 404, 409];

/**
 * The Messengers domain's operations (P120 W2): the accounts of this Mac, the autolink and chat management (owner-gated
 * identity writes), and the panel's reads and unsent-draft writes. The delivery is the send door (`send/openapi.ts`). Not
 * declared: the agent's own autolink routes (`composition/operations.ts`, `NOT_DECLARED`).
 */
export const operations: Operation[] = [
  { method: "get", path: "/api/messengers/telegram-user", operationId: "getTelegramUserStatus", summary: "Read the Telegram accounts of this Mac", tags: ["messengers"], reply: { name: "TelegramUserStatus", schema: telegramUserStatusDto }, errors: [503] },
  { method: "post", path: "/api/messengers/telegram-user/login/start", operationId: "startTelegramUserLogin", summary: "Start a Telegram sign-in", tags: ["messengers"], body: { name: "UserLoginStartBody", schema: userLoginStartBody }, reply: step, errors: [400, 403, 409] },
  { method: "post", path: "/api/messengers/telegram-user/login/status", operationId: "getTelegramUserLoginStatus", summary: "Read a Telegram QR sign-in", tags: ["messengers"], body: { name: "UserLoginStatusBody", schema: userLoginStatusBody }, reply: step, errors: [400, 403, 409] },
  { method: "post", path: "/api/messengers/telegram-user/login/code", operationId: "sendTelegramUserCode", summary: "Answer the sign-in's code", tags: ["messengers"], body: { name: "UserLoginCodeBody", schema: userLoginCodeBody }, reply: step, errors: [400, 403, 404] },
  { method: "post", path: "/api/messengers/telegram-user/login/password", operationId: "sendTelegramUserPassword", summary: "Answer the sign-in's two-step password", tags: ["messengers"], body: { name: "UserLoginPasswordBody", schema: userLoginPasswordBody }, reply: step, errors: [400, 403, 404] },
  { method: "post", path: "/api/messengers/telegram-user/login/cancel", operationId: "cancelTelegramUserLogin", summary: "Cancel a Telegram sign-in", tags: ["messengers"], body: { name: "UserLoginCancelBody", schema: userLoginCancelBody }, reply: cancelled, errors: [400, 403] },
  { method: "post", path: "/api/messengers/telegram-user/:account/disconnect", operationId: "disconnectTelegramUser", summary: "Disconnect one Telegram account", tags: ["messengers"], params: accountParam, reply: disconnected, errors: [400, 403, 404] },
  { method: "get", path: "/api/messengers/whatsapp", operationId: "getWhatsAppStatus", summary: "Read the WhatsApp accounts of this Mac", tags: ["messengers"], reply: { name: "WhatsAppStatus", schema: whatsappStatusDto }, errors: [503] },
  { method: "post", path: "/api/messengers/whatsapp/connect", operationId: "startWhatsAppConnect", summary: "Start pairing a WhatsApp account", tags: ["messengers"], reply: { name: "WaConnectStarted", schema: waConnectStartedDto }, errors: [400, 403, 409] },
  { method: "post", path: "/api/messengers/whatsapp/connect/state", operationId: "readWhatsAppConnect", summary: "Read a pairing's state", tags: ["messengers"], body: { name: "WaConnectFlowBody", schema: waConnectFlowBody }, reply: { name: "WaConnectStep", schema: waConnectStepDto }, errors: [400, 403, 404] },
  { method: "post", path: "/api/messengers/whatsapp/connect/cancel", operationId: "cancelWhatsAppConnect", summary: "Cancel a pairing", tags: ["messengers"], body: { name: "WaConnectFlowBody", schema: waConnectFlowBody }, reply: cancelled, errors: [400, 403] },
  { method: "post", path: "/api/messengers/whatsapp/:account/disconnect", operationId: "disconnectWhatsApp", summary: "Disconnect one WhatsApp account", tags: ["messengers"], params: accountParam, reply: disconnected, errors: [400, 403, 404] },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/state", operationId: "getAutolinkState", summary: "Read the autolink's state (the owner's contacts: a gated POST)", tags: ["messengers"], params: slugParam, reply: { name: "AutolinkState", schema: autolinkStateDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/preview", operationId: "previewAutolink", summary: "Preview what the autolink would link", tags: ["messengers"], params: slugParam, reply: { name: "AutolinkPreview", schema: autolinkPreviewDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/records", operationId: "findAutolinkRecords", summary: "Find Notion records for a chat", tags: ["messengers"], params: slugParam, body: { name: "AutolinkRecordsBody", schema: autolinkRecordsBody }, reply: { name: "AutolinkRecords", schema: autolinkRecordsDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/link", operationId: "linkChatRecord", summary: "Link a chat to a Notion record", tags: ["messengers"], params: slugParam, body: { name: "AutolinkLinkBody", schema: autolinkLinkBody }, reply: linked, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/create", operationId: "createChatRecord", summary: "Create a Clients card from a chat and link it", tags: ["messengers"], params: slugParam, body: { name: "AutolinkCreateBody", schema: autolinkCreateBody }, reply: linked, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/hide", operationId: "hideChat", summary: "Hide an unlinked chat (not a client)", tags: ["messengers"], params: slugParam, body: { name: "AutolinkHideBody", schema: autolinkHideBody }, reply: hidden, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/unhide", operationId: "unhideChat", summary: "Unhide a chat", tags: ["messengers"], params: slugParam, body: { name: "AutolinkHideBody", schema: autolinkHideBody }, reply: hidden, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/proposals/drop", operationId: "dropHideProposals", summary: "Drop the agent's proposed hides", tags: ["messengers"], params: slugParam, body: { name: "AutolinkProposalsDropBody", schema: autolinkProposalsDropBody }, reply: { name: "AutolinkProposalsDropped", schema: autolinkProposalsDroppedDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/autolink/dialogs", operationId: "listAccountDialogs", summary: "One account's dialogs against a record", tags: ["messengers"], params: slugParam, body: { name: "AutolinkDialogsBody", schema: autolinkDialogsBody }, reply: { name: "UserDialogs", schema: userDialogsDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/client", operationId: "changeChatClient", summary: "Change the client of a chat", tags: ["messengers"], params: sendParam, body: { name: "AutolinkMoveBody", schema: autolinkMoveBody }, reply: { name: "ChatMoved", schema: chatMovedDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/client/undo", operationId: "undoChatClient", summary: "Undo Change client", tags: ["messengers"], params: sendParam, body: { name: "ChatMoveUndoBody", schema: chatMoveUndoBody }, reply: { name: "ChatMoveUndone", schema: chatMoveUndoneDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/email", operationId: "addChatClientEmail", summary: "Add an email to a chat's client (merges when another client has it)", tags: ["messengers"], params: sendParam, body: { name: "ChatEmailBody", schema: chatEmailBody }, reply: { name: "ChatEmail", schema: chatEmailDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/unlink", operationId: "unlinkChat", summary: "Unlink a chat", tags: ["messengers"], params: sendParam, reply: unlinked, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/never", operationId: "neverLinkChat", summary: "Unlink a chat and never link it again", tags: ["messengers"], params: sendParam, reply: unlinked, errors: gated },
  { method: "get", path: "/api/projects/:slug/messengers/chats", operationId: "listMessengerChats", summary: "List the project's chats", tags: ["messengers"], params: slugParam, query: messengerChatsQuery, reply: { name: "MessengerChats", schema: messengerChatsDto }, errors: [400, 404, 503] },
  { method: "get", path: "/api/projects/:slug/messengers/chats/:id/conversation", operationId: "getMessengerConversation", summary: "Read one chat's conversation", tags: ["messengers"], params: sendParam, reply: { name: "MessengerConversation", schema: messengerConversationDto }, errors: [404, 503] },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/draft", operationId: "createMessengerDraft", summary: "Write the owner's words as one unsent messenger draft", tags: ["messengers"], params: sendParam, body: { name: "MessengerDraftTextBody", schema: messengerDraftTextBody }, reply: chat, errors: gated },
  { method: "put", path: "/api/projects/:slug/messengers/drafts/:id/text", operationId: "editMessengerDraft", summary: "Edit an unsent messenger draft", tags: ["messengers"], params: sendParam, body: { name: "MessengerDraftTextBody", schema: messengerDraftTextBody }, reply: draft, errors: [400, 403, 404] },
  { method: "post", path: "/api/projects/:slug/messengers/drafts/:id/skip", operationId: "skipMessengerDraft", summary: "Skip an unsent messenger draft", tags: ["messengers"], params: sendParam, reply: { name: "MessengerSkipped", schema: messengerSkippedDto }, errors: [400, 403, 404] },
  { method: "post", path: "/api/projects/:slug/messengers/drafts/:id/restore", operationId: "restoreMessengerDraft", summary: "Undo Skip", tags: ["messengers"], params: sendParam, reply: draft, errors: [400, 403, 404] },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/prepare", operationId: "prepareMessengerReply", summary: "Ask the agent to prepare a reply", tags: ["messengers"], params: sendParam, body: { name: "MessengerPrepareBody", schema: messengerPrepareBody }, reply: chat, errors: [400, 403, 404, 409, 503] },
  // P143 D2: No reply needed on a chat and its Undo.
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/done", operationId: "markMessengerChatDone", summary: "Mark a chat No reply needed", tags: ["messengers"], params: sendParam, reply: { name: "MessengerChatDone", schema: messengerChatDoneDto }, errors: gated },
  { method: "post", path: "/api/projects/:slug/messengers/chats/:id/done/undo", operationId: "undoMessengerChatDone", summary: "Undo No reply needed on a chat", tags: ["messengers"], params: sendParam, reply: { name: "MessengerChatDone", schema: messengerChatDoneDto }, errors: [400, 403, 404] },
  { method: "put", path: "/api/projects/:slug/messengers/chats/:id/rules", operationId: "setMessengerChatRules", summary: "Change one chat's rules", tags: ["messengers"], params: sendParam, body: { name: "MessengerChatRulesBody", schema: chatRulesBody }, reply: chat, errors: [400, 403, 404] },
  // P139 A1 (decision 0048): the autopilot's switches. Every write is the owner's door with a single-use `autopilot:<scope>` ticket.
  { method: "post", path: "/api/autopilot/tickets", operationId: "createAutopilotTicket", summary: "Get a ticket for one autopilot switch", tags: ["messengers"], body: { name: "AutopilotTicketBody", schema: autopilotTicketBody }, reply: { name: "SendTicket", schema: sendTicketDto }, errors: [400, 403, 404] },
  { method: "get", path: "/api/autopilot", operationId: "getAutopilot", summary: "Read the autopilot switch of this Mac", tags: ["messengers"], reply: autopilotInstance, errors: [404] },
  { method: "put", path: "/api/autopilot", operationId: "setAutopilot", summary: "Switch the autopilot of this Mac", tags: ["messengers"], body: { name: "SetAutopilotInstanceBody", schema: setAutopilotInstanceBody }, reply: autopilotInstance, errors: [400, 403, 404] },
  { method: "get", path: "/api/projects/:slug/autopilot", operationId: "getProjectAutopilot", summary: "Read a project's autopilot and its chats", tags: ["messengers"], params: slugParam, reply: autopilotProject, errors: [400, 404] },
  { method: "put", path: "/api/projects/:slug/autopilot", operationId: "setProjectAutopilot", summary: "Change a project's autopilot or one chat's switch", tags: ["messengers"], params: slugParam, body: { name: "SetAutopilotProjectBody", schema: setAutopilotProjectBody }, reply: autopilotProject, errors: [400, 403, 404, 409] },
];
