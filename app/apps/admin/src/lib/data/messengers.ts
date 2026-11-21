"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatRulesBody, MessengerChatsQuery } from "@hub/contract/messenger-panel";
import type { LiveTopic } from "@hub/contract/live";
import type { MessengerSendPreviewDto } from "@hub/contract/messenger";
import type { AutolinkLinkedDto, AutolinkRecordDto, ChatMovedDto, UserLoginStartBody, UserLoginStepDto, WaConnectStepDto } from "@hub/contract/messengers";
import { ApiFailure, sentence } from "@/lib/api/client";
import { autopilotApi } from "@/lib/api/messengers/autopilot";
import { messengersApi } from "@/lib/api/messengers/panel";
import { messengerSendApi } from "@/lib/api/messengers/send";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { whatsappApi } from "@/lib/api/messengers/whatsapp";
import { keys } from "@/lib/cache/keys";
import { invalidateTopics, useCommand, useRefreshTopics } from "@/lib/cache/topics";
import { useSendDoor } from "./send-door";

/**
 * P127 C2's data half (V3): Messengers' reads and writes (state rule 4b). The chats of a view, a link state, a channel and a
 * search, one key each (`keys.messengerChats`), so the sidebar's counts and an open list share a request.
 */

/** The server's linked chats under the view and link state (P123 U3b), with the View menu's counts. `keep` keeps the last list while typing. */
export const useMessengerChats = (project: string | null, query: MessengerChatsQuery, o: { keep?: boolean; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.messengerChats(project ?? "", query.filter, query.link, query.channel, query.q),
    queryFn: () => messengersApi.chats(project ?? "", query),
    enabled: project !== null && (o.enabled ?? true),
    ...(o.keep ? { placeholderData: keepPreviousData } : {}),
  });

/** The autolink's memory: the unlinked and hidden chats, the directory's state. Never retried, never kept after the screen; a change bumps `messengers` (P126 S1). */
export const useAutolinkState = (project: string) => useQuery({ queryKey: keys.autolink(project), queryFn: () => messengersApi.autolinkState(project), gcTime: 0, retry: false });

/** One linked chat's rules (P71 M2b), written by the owner only; the chat's list and conversation read them again. */
export const useSaveChatRules = (project: string, chatId: number) => useCommand({ project, touches: ["messengers"], run: (patch: ChatRulesBody) => messengersApi.setRules(project, chatId, patch) });

/** Disconnect one account of a user-account channel: the session goes, the channel's status is read again. */
export function useDisconnectAccount(channel: "telegram_user" | "whatsapp", account: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (channel === "whatsapp" ? whatsappApi.disconnect(account) : telegramUserApi.disconnect(account)),
    onSettled: () => qc.invalidateQueries({ queryKey: channel === "whatsapp" ? keys.whatsapp() : keys.telegramUser() }),
  });
}

// ---- The Telegram account (P71 M3; `features/messengers/settings/use-telegram.ts` until P127 C2's data half)

export const useTelegramUser = () => useQuery({ queryKey: keys.telegramUser(), queryFn: telegramUserApi.status });

/** Where the connect form stands: the first step, the code, a QR code, the 2FA password, or done with the owner's own display name. The QR rows and flow live only in form state, never in a query cache or address. */
export type LoginStep = { step: "start" } | Exclude<UserLoginStepDto, { step: "done" }> | { step: "done"; name: string };

/**
 * The connect form's steps over M1's routes (decision 0036 point 4), one call each. The flow id lives in this state only; the
 * api_hash, phone, code and password are arguments of one call and are kept nowhere (no query key, no mutation variables, no
 * address). One sentence reaches the live region: a refusal (wrong code, Telegram's answer) is an alert.
 */
export function useTelegramLogin() {
  const qc = useQueryClient();
  const [state, setState] = useState<LoginStep>({ step: "start" });
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const activeQrFlow = useRef<string | null>(null);
  const mounted = useRef(true);
  const qrFlow = state.step === "qr" ? state.flow : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activeQrFlow.current) void telegramUserApi.cancel(activeQrFlow.current).catch(() => undefined);
    };
  }, []);

  const run = useCallback(
    async (call: () => Promise<UserLoginStepDto>) => {
      setBusy(true);
      setAlert(null);
      try {
        const r = await call();
        if (!mounted.current) {
          if (r.step === "qr") await telegramUserApi.cancel(r.flow).catch(() => undefined);
          return;
        }
        if (r.step === "qr") activeQrFlow.current = r.flow;
        if (r.step === "done") activeQrFlow.current = null;
        setState(r.step === "done" ? { step: "done", name: r.name } : r);
        if (r.step === "done") await qc.invalidateQueries({ queryKey: keys.telegramUser() });
      } catch (e) {
        if (mounted.current) setAlert(sentence(e));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [qc],
  );

  useEffect(() => {
    if (!qrFlow) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await telegramUserApi.loginStatus(qrFlow);
        if (!live || activeQrFlow.current !== qrFlow) return;
        setAlert(null);
        if (r.step === "done") {
          activeQrFlow.current = null;
          setState({ step: "done", name: r.name });
          await qc.invalidateQueries({ queryKey: keys.telegramUser() });
          return;
        }
        setState(r);
        if (r.step === "password" || r.step === "code") return;
      } catch (e) {
        if (!live || activeQrFlow.current !== qrFlow) return;
        if (e instanceof ApiFailure && e.status === 409) {
          activeQrFlow.current = null;
          setState({ step: "start" });
          setAlert(`${sentence(e)} Start a new login.`);
          return;
        }
        setAlert(sentence(e));
      }
      if (live && activeQrFlow.current === qrFlow) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [qrFlow, qc]);

  const start = useCallback((b: UserLoginStartBody) => run(() => telegramUserApi.start(b)), [run]);
  const code = useCallback((c: string) => (state.step === "code" ? run(() => telegramUserApi.code(state.flow, c)) : undefined), [run, state]);
  const password = useCallback((p: string) => (state.step === "password" ? run(() => telegramUserApi.password(state.flow, p)) : undefined), [run, state]);
  const cancel = useCallback(async () => {
    const qr = activeQrFlow.current;
    if (qr) {
      try {
        await telegramUserApi.cancel(qr);
      } catch (e) {
        if (mounted.current && activeQrFlow.current === qr) setAlert(sentence(e));
        return;
      }
      if (!mounted.current || activeQrFlow.current !== qr) return;
    }
    activeQrFlow.current = null;
    setAlert(null);
    setState({ step: "start" });
    if (!qr && (state.step === "code" || state.step === "password")) await telegramUserApi.cancel(state.flow).catch(() => undefined);
  }, [state]);
  return { state, busy, alert, start, code, password, cancel };
}

// ---- WhatsApp (P71 M5; `features/messengers/settings/whatsapp/use-whatsapp.ts` until P127 C2's data half)

export const useWhatsApp = () => useQuery({ queryKey: keys.whatsapp(), queryFn: whatsappApi.status });

const ended = (s: WaConnectStepDto | undefined) => s?.step === "done" || s?.step === "failed";

/**
 * The WhatsApp Connect (decision 0036 point 4): nothing happens until the owner presses Connect; then the server opens a pairing
 * and the admin reads its state again on each `connections` bump the server makes when the flow moves (P126 S1: the QR code to scan, then done or failed) until it ends or he cancels. The server drops
 * a pairing once its end is read, so the reads stop there. The flow id lives in this state only; the QR code is never cached past
 * the pairing (`gcTime: 0`).
 */
export function useWhatsAppConnect() {
  const qc = useQueryClient();
  const [flow, setFlow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const state = useQuery({
    queryKey: keys.whatsappPairing(flow ?? ""),
    queryFn: async () => {
      const s = await whatsappApi.state(flow ?? "");
      if (s.step === "done") void qc.invalidateQueries({ queryKey: keys.whatsapp() });
      return s;
    },
    enabled: flow !== null,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const s = flow !== null ? state.data : undefined;

  const connect = useCallback(async () => {
    setBusy(true);
    setRefused(null);
    try {
      setFlow((await whatsappApi.connect()).flow);
    } catch (e) {
      setFlow(null);
      setRefused(sentence(e));
    } finally {
      setBusy(false);
    }
  }, []);
  const cancel = useCallback(async () => {
    if (flow && !ended(state.data)) await whatsappApi.cancel(flow).catch(() => undefined);
    setFlow(null);
    setRefused(null);
  }, [flow, state.data]);

  const failed = s?.step === "failed" ? s.reason : flow !== null && state.isError ? sentence(state.error) : null;
  return {
    active: flow !== null && !ended(s) && !state.isError,
    qr: s?.step === "qr" ? s : null,
    busy,
    alert: refused ?? failed,
    done: s?.step === "done" ? `Linked as ${s.name || `+${s.account}`}.` : null,
    connect,
    cancel,
  };
}

// ---- One chat, its drafts and its moves (P127 C2's data half: `messengerMutationKeys` is gone, a write names `messengers`)

/** A Messengers write moves the panel's lists, the open conversation and the autolink's memory (all under `messenger-chats`). */
const MESSENGERS: readonly LiveTopic[] = ["messengers"];
type UserChannel = "telegram_user" | "whatsapp";
type Linkable = { channel: UserChannel; account: string; chatId: string; title: string };

/** One linked chat's conversation: the messages, the open draft and the reply policy (P106). */
export const useMessengerConversation = (project: string, chatId: number) => useQuery({ queryKey: keys.messengerConversation(project, chatId), queryFn: () => messengersApi.conversation(project, chatId) });

/** Prepare reply (the agent drafts one, nothing is sent). The chat is the variable, so a pending Prepare of another chat never shows here. */
export const usePrepareReply = (project: string) => useCommand({ project, touches: MESSENGERS, run: (chatId: number) => messengersApi.prepareReply(project, chatId) });

/** The owner's own words as an unsent draft of the chat (never sent here). */
export const useManualMessengerDraft = (project: string, chatId: number, onSuccess: () => void) => useCommand({ project, touches: MESSENGERS, run: (text: string) => messengersApi.createManualDraft(project, chatId, text), onSuccess });

/** P143 D2: No reply needed on a chat (Done) and its Undo; the panel and the open conversation are read again either way. */
export function useChatDone(project: string, on: { onDone: (v: { id: number; name: string }) => void; onError: (e: unknown) => void }) {
  const done = useCommand({ project, touches: MESSENGERS, onError: on.onError, run: ({ id }: { id: number; name: string }) => messengersApi.markDone(project, id), onSuccess: (_r, v) => on.onDone(v) });
  const undo = useCommand({ project, touches: MESSENGERS, onError: on.onError, run: (id: number) => messengersApi.undoDone(project, id) });
  return { done, undo };
}

/** Edit, Skip and its Undo (Restore) of a messenger draft (P71 M3). Send is not here: it is the door's (`useMessengerSendFlow`). */
export function useMessengerDraftCommands(project: string, on: { onSuccess: () => void; onError: (e: unknown) => void; onSkipped: (v: { id: number; name: string }) => void }) {
  const o = { project, touches: MESSENGERS, onError: on.onError };
  return {
    edit: useCommand({ ...o, run: ({ id, text }: { id: number; text: string }) => messengersApi.editDraft(project, id, text), onSuccess: on.onSuccess }),
    restore: useCommand({ ...o, run: (id: number) => messengersApi.restoreDraft(project, id), onSuccess: on.onSuccess }),
    skip: useCommand({
      ...o,
      run: ({ id }: { id: number; name: string }) => messengersApi.skipDraft(project, id),
      onSuccess: (_r, v) => {
        on.onSuccess();
        on.onSkipped(v);
      },
    }),
  };
}

/**
 * Send of one messenger draft (P71 M4, decision 0046) through the one door Mail's card uses (`send-door.ts`): the dry run, then the
 * apply with the chat and the exact text the owner read. Afterwards the panel and Activity ▸ Sends are read again.
 */
export function useMessengerSendFlow(project: string, draftId: number, sent: (p: MessengerSendPreviewDto) => void) {
  const refresh = useRefreshTopics(project);
  return useSendDoor<MessengerSendPreviewDto>({
    preview: () => messengerSendApi.preview(project, draftId),
    send: (p) => messengerSendApi.send(project, draftId, { chatId: p.chatId, text: p.text }),
    sent,
    settle: () => refresh(["messengers", "sends"]),
  });
}

/**
 * P102: the moves of a chat between its states (`features/messengers/status/use-moves.ts` keeps the toasts): Link, Change client
 * and its Undo, Unlink. `unlinkAgain` is Link's Undo (the row id is known only once linked, so the panel is read for it).
 */
export function useChatMoveCommands(project: string, on: { onError: (e: unknown) => void; onUnlinked: (v: { never: boolean; name: string }) => void; onLinked: (res: AutolinkLinkedDto, v: Linkable) => void; onChanged: (r: ChatMovedDto, v: { id: number; name: string }) => void }) {
  const refresh = useRefreshTopics(project);
  const o = { project, touches: MESSENGERS, onError: on.onError };
  const unlinkAgain = async (c: Pick<Linkable, "channel" | "chatId">) => {
    const linked = await messengersApi.chats(project, { filter: "all", link: "linked" });
    const row = linked.chats.find((x) => x.chatId === c.chatId && x.channel === c.channel);
    if (row) await messengersApi.unlinkChat(project, row.id, false);
    await refresh(MESSENGERS);
  };
  return {
    unlink: useCommand({ ...o, run: ({ id, never }: { id: number; never: boolean; name: string }) => messengersApi.unlinkChat(project, id, never), onSuccess: (_r, v) => on.onUnlinked(v) }),
    link: useCommand({
      ...o,
      run: ({ rec, ...c }: Linkable & { rec: Pick<AutolinkRecordDto, "key"> }) => messengersApi.linkRecord(project, { channel: c.channel, account: c.account, chatId: c.chatId, key: rec.key, title: c.title }),
      onSuccess: (res, v) => on.onLinked(res, v),
    }),
    undoChange: useCommand({ ...o, run: ({ id, clientId, draftId }: { id: number; clientId: number; draftId: number | null }) => messengersApi.undoChange(project, id, { clientId, draftId }) }),
    change: useCommand({ ...o, run: ({ id, key }: { id: number; key: string; name: string }) => messengersApi.changeClient(project, id, key), onSuccess: (r, v) => on.onChanged(r, v) }),
    unlinkAgain,
    refresh: () => refresh(MESSENGERS),
  };
}

type HiddenChat = { channel: UserChannel; chatId: string; title: string };

/** Hide ("not a client", P84c) and Unhide of an unlinked chat; the server keeps a keyed hash of the chat, never the chat. */
export function useHideCommands(project: string, on: { onError: (e: unknown) => void; onHidden: (c: HiddenChat) => void; onUnhidden: (c: HiddenChat) => void }) {
  const o = { project, touches: MESSENGERS, onError: on.onError };
  return {
    hide: useCommand({ ...o, run: (c: HiddenChat) => messengersApi.hideChat(project, { channel: c.channel, chatId: c.chatId }), onSuccess: (_r, c) => on.onHidden(c) }),
    unhide: useCommand({ ...o, run: (c: HiddenChat) => messengersApi.unhideChat(project, { channel: c.channel, chatId: c.chatId }), onSuccess: (_r, c) => on.onUnhidden(c) }),
  };
}

/** P128 X5: the owner's Keep of chats the agent proposed to hide: their proposals are dropped (the chats stay unlinked). */
export const useProposalDrop = (project: string) =>
  useCommand({ project, touches: MESSENGERS, run: (items: { channel: UserChannel; chatId: string }[]) => messengersApi.dropProposals(project, items) });

/** P102: each account's dialogs marked against the picked record (Link a chat…), read on demand and never stored. */
export const useDialogsOf = (project: string, accounts: readonly { channel: UserChannel; account: string }[], key: string | null) =>
  useQueries({
    queries: accounts.map((a) => ({
      queryKey: keys.autolinkDialogs(project, a.channel, a.account, key ?? ""),
      queryFn: () => messengersApi.dialogsOf(project, { channel: a.channel, account: a.account, key: key ?? "" }),
      enabled: key !== null,
      gcTime: 0,
      retry: false,
    })),
  });

/** P84: the Notion client records for one unlinked chat's Link (two or more characters), never kept. */
export const useRecordSearch = (project: string, term: string) =>
  useQuery({ queryKey: keys.autolinkRecords(project, term), queryFn: () => messengersApi.findRecords(project, term), enabled: term.replace(/^@/, "").length >= 2, gcTime: 0 });

/** Create a Notion client record for an unlinked chat and link it (P84). */
export const useCreateRecord = (project: string, onSuccess: (res: AutolinkLinkedDto) => void) =>
  useCommand({ project, touches: MESSENGERS, run: (body: Linkable & { name: string; email?: string }) => messengersApi.createRecord(project, body), onSuccess });

/** P141 C4: "Add email…" on a chat's client known only by the chat (the server merges when another client has the address). */
export const useAddClientEmail = (project: string, chatId: number, onSuccess: (r: { merged: boolean }) => void) =>
  useCommand({ project, touches: MESSENGERS, run: (email: string) => messengersApi.addClientEmail(project, chatId, email), onSuccess });

// P139 A5: the autopilot's switches on screen (decision 0048 point 2). Every write fetches its single-use ticket first
// (`autopilotApi`), then reads the project's view and the instance switch again, and the panel's chats (their marks).

type ProjectChange = Parameters<typeof autopilotApi.setProject>[1];

/** A project's autopilot: its mode, disclose, quiet hours, every linked chat's state, and the last day's counts. */
export const useProjectAutopilot = (project: string | null) => useQuery({ queryKey: keys.autopilot(project ?? ""), queryFn: () => autopilotApi.project(project ?? ""), enabled: !!project, retry: false });

export const useAutopilotInstance = () => useQuery({ queryKey: keys.autopilotInstance(), queryFn: autopilotApi.instance, retry: false });

function useRefresh(project: string | null) {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.autopilotInstance() }), project ? qc.invalidateQueries({ queryKey: keys.autopilot(project) }) : Promise.resolve(), invalidateTopics(qc, project, ["messengers"])]).then(() => undefined);
}

/** One change of a project's block (its mode, a chat's switch, disclose, quiet hours). */
export function useSetProjectAutopilot(project: string) {
  const refresh = useRefresh(project);
  return useMutation({ mutationFn: (change: ProjectChange) => autopilotApi.setProject(project, change), onSettled: refresh });
}

/** The switch of this Mac. */
export function useSetAutopilotInstance(project: string | null) {
  const refresh = useRefresh(project);
  return useMutation({ mutationFn: (on: boolean) => autopilotApi.setInstance(on), onSettled: refresh });
}
