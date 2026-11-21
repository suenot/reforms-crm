import type { MtClient, MtMe, MtMessage, MtPeer } from "./telegram-user";
import type { MtLoginClient } from "./telegram-user-login";

/** A Telegram-shaped RPC error (what mtcute throws), for fakes and tests: `FLOOD_WAIT_%d` carries `seconds`. */
export class FakeRpcError extends Error {
  constructor(
    readonly code: number,
    readonly text: string,
    readonly seconds?: number,
  ) {
    super(`Telegram API error ${code}: ${text}`);
  }
}

export const fakePerson = (id: number, name = `Person ${id}`, extra: { username?: string; phone?: string } = {}): MtPeer => ({
  type: "user",
  id,
  displayName: name,
  username: extra.username ?? null,
  phoneNumber: extra.phone ?? null,
  isBot: false,
  isSelf: false,
});

/**
 * An mtcute client with no network, for tests: `emit` plays a new message, `fail` an error of the connection, `history` and
 * `dialogs` are scripted, `connectError` makes `connect` throw. `sendText` records the text in `sent` and reaches no network;
 * `sendError` makes it throw.
 */
export class FakeMtClient implements MtClient {
  connects = 0;
  closed = 0;
  connectError: unknown = null;
  peers: MtPeer[] = [];
  past: MtMessage[] = [];
  historyCalls: { chatId: number; minId: number }[] = [];
  sent: { chatId: number; text: string; id: number }[] = [];
  sendError: unknown = null;
  private onMessage: ((m: MtMessage) => void) | null = null;
  private onError: ((e: unknown) => void) | null = null;
  private seq = 100;

  constructor(readonly me: MtMe = { id: 42, displayName: "Owner" }) {}

  async connect(): Promise<MtMe> {
    this.connects++;
    if (this.connectError) throw this.connectError;
    return this.me;
  }
  async listen(onMessage: (m: MtMessage) => void, onError: (e: unknown) => void): Promise<void> {
    this.onMessage = onMessage;
    this.onError = onError;
  }
  get listening(): boolean {
    return this.onMessage !== null;
  }
  /** Plays one new message; returns it. */
  emit(chat: MtPeer, text: string, o: { out?: boolean; media?: string; id?: number; date?: Date } = {}): MtMessage {
    const m: MtMessage = { id: o.id ?? ++this.seq, date: o.date ?? new Date("2026-11-20T10:00:00.000Z"), text, mediaType: o.media ?? null, isOutgoing: o.out ?? false, isService: false, chat };
    this.onMessage?.(m);
    return m;
  }
  fail(e: unknown): void {
    this.onError?.(e);
  }
  /** P84c: a dialog's newest message as the list reports it (time and side). Unset: the newest of `past` for that chat, else "just now". */
  last = new Map<number, { at: Date; outgoing: boolean } | null>();
  async dialogs(limit: number): Promise<(MtPeer & { last: { at: Date; outgoing: boolean } | null })[]> {
    return this.peers.slice(0, limit).map((p) => {
      if (this.last.has(p.id)) return { ...p, last: this.last.get(p.id) ?? null };
      const top = this.past.filter((m) => m.chat.id === p.id).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
      return { ...p, last: top ? { at: top.date, outgoing: top.isOutgoing } : { at: new Date(), outgoing: false } };
    });
  }
  async history(chatId: number, o: { since: Date; minId: number; limit: number }): Promise<MtMessage[]> {
    this.historyCalls.push({ chatId, minId: o.minId });
    return this.past
      .filter((m) => m.chat.id === chatId && m.id > o.minId && m.date >= o.since)
      .sort((a, b) => b.id - a.id)
      .slice(0, o.limit);
  }
  async sendText(chatId: number, text: string): Promise<{ id: number; date: Date }> {
    if (this.sendError) throw this.sendError;
    const id = ++this.seq;
    this.sent.push({ chatId, text, id });
    return { id, date: new Date("2026-11-20T12:00:00.000Z") };
  }
  /** Decision 0048: the chats a typing status was shown in, in order. */
  typed: number[] = [];
  async typing(chatId: number): Promise<void> {
    this.typed.push(chatId);
  }
  async close(): Promise<void> {
    this.closed++;
    this.onMessage = null;
  }
}

/** A login client with no network: code `12345` passes, the password `pw` passes when `twoFactor` is set; anything else is refused. */
export class FakeLoginClient implements MtLoginClient {
  closed = 0;
  sentTo: string[] = [];
  qrUrl: ((url: string, expires: Date) => void) | null = null;
  qrResolve: ((me: MtMe) => void) | null = null;
  qrReject: ((err: unknown) => void) | null = null;
  constructor(
    readonly o: { twoFactor?: boolean; me?: MtMe; sendError?: unknown } = {},
  ) {}
  async sendCode(phone: string) {
    if (this.o.sendError) throw this.o.sendError;
    this.sentTo.push(phone);
    return { phoneCodeHash: "hash-1" };
  }
  async signIn(o: { phone: string; phoneCodeHash: string; code: string }): Promise<MtMe> {
    if (o.code !== "12345") throw new FakeRpcError(400, "PHONE_CODE_INVALID");
    if (this.o.twoFactor) throw new FakeRpcError(401, "SESSION_PASSWORD_NEEDED");
    return this.o.me ?? { id: 42, displayName: "Owner" };
  }
  signInQr(o: { onUrlUpdated: (url: string, expires: Date) => void; abortSignal: AbortSignal }): Promise<MtMe> {
    this.qrUrl = o.onUrlUpdated;
    return new Promise((resolve, reject) => {
      this.qrResolve = resolve;
      this.qrReject = reject;
      o.abortSignal.addEventListener("abort", () => reject(o.abortSignal.reason), { once: true });
    });
  }
  async checkPassword(password: string): Promise<MtMe> {
    if (password !== "pw") throw new FakeRpcError(400, "PASSWORD_HASH_INVALID");
    return this.o.me ?? { id: 42, displayName: "Owner" };
  }
  async exportSession() {
    return "SESSION-STRING-OF-THE-FAKE-0123456789";
  }
  async close() {
    this.closed++;
  }
}
