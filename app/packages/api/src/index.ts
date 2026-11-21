// The public generated surface (P120 W2): every operation of the emitted `openapi.json`, by Orval's tag file. Only `apps/admin`
// `lib/api/*` facades import it (`apps/admin/test/rules.test.ts`); the send doors' operations only from their facades.
export { checkApps, checkCoreUpdate, getActivity, getAgentFeed, getAgentSettings, getCoreUpdate, getHealth, getInstance, getKnowledgeText, getOpsErrors, getOpsLines, getOverview, getProjectDoctor, getProjectLinks, getProjectOverview, getPulse, getSafetyRules, getScheme, listKnowledge, listProjects, openLocal, setAgentSettings, setSafetyRule } from "./generated/meta/meta";
export { getGetInstanceLogoUrl } from "./generated/meta/meta";
export { getAgentTools, getAutostart, listConnections, refreshAgentTools, removeConnectionSecret, setAutostart, setConnectionSecret, testConnection } from "./generated/connections/connections";
export {
  ackDraftCheck, acknowledgeBatchWarnings, checkInbound, createManualMailDraft, dismissInbound, getBatch, getClientByKey, getClientHistory, getClientMap, getClientTimeline, getConversation, getConversationMail, getConversationText, getDraftMail, getInboundDetail, getInboundText, getLeadDetail,
  listBatches, listConversations, listDrafts, listEnrollments, listFollowUps, listInbound, listInbox, listLeads, listNotByEmail, listSequences, listStuckClients, notNowLead, refreshConversation, restoreDraftMail, runFollowUps, saveDraftMail, setClientMarks, setDraftChecked, setDraftStatus, setDraftTone, setFollowUp, spamLead, stopEnrollment, tidyDraftMail, undismissInbound, undoBatch, undoDraftStatus, undoLead,
  getLeadPass, redoLead, runLeadPass,
} from "./generated/mail/mail";
export {
  addChatClientEmail, cancelTelegramUserLogin, cancelWhatsAppConnect, changeChatClient, createChatRecord, createMessengerDraft, disconnectTelegramUser, disconnectWhatsApp, dropHideProposals, editMessengerDraft, findAutolinkRecords, getAutolinkState, getMessengerConversation, getTelegramUserLoginStatus, getTelegramUserStatus, getWhatsAppStatus, hideChat,
  linkChatRecord, listAccountDialogs, listMessengerChats, markMessengerChatDone, neverLinkChat, prepareMessengerReply, previewAutolink, readWhatsAppConnect, restoreMessengerDraft, sendTelegramUserCode, sendTelegramUserPassword, setMessengerChatRules, skipMessengerDraft, startTelegramUserLogin, startWhatsAppConnect, undoChatClient, undoMessengerChatDone, unhideChat, unlinkChat,
  createAutopilotTicket, getAutopilot, getProjectAutopilot, setAutopilot, setProjectAutopilot,
} from "./generated/messengers/messengers";
export { cancelSend, confirmLeadReview, createBatchSendTicket, createSendTicket, getBatchSend, getLeadReview, listSends, moveInboundMail, resumeSends, runBatchSend, sendOneMailDraft, sendMessengerDraft, stopBatchSend, stopSends } from "./generated/sending/sending";
export { getPointer, postFocus, getPostFocusUrl } from "./generated/agent/agent";
export { closeTerminalSession, createTerminalSession, createTerminalTicket, ensureTerminalSession, getTerminal, getDropTerminalFilesUrl } from "./generated/terminal/terminal";
export { getStreamLiveUrl } from "./generated/live/live";
export { getWatch, joinWatchGroup, listWatchProjects } from "./generated/watch/watch";
export type { GetConversationTextParams } from "./generated/models";
