/**
 * One signed-in mailbox: messages held in memory, conversations and contacts
 * computed with es-core, replies and receipts sent through the adapter.
 *
 * Nothing here writes message content to disk. The optional metadata cache
 * (cache.ts) stores headers and flags only.
 */

import {
  canonicalAddress,
  deriveContacts,
  extractPart,
  parseMessage,
  replyTargetOf,
  serializeMessage,
  serializeReceipt,
  threadMessages,
  type Conversation,
  type EsAddress,
  type EsMessage,
  type EsPartContent,
  type ReceiptKind,
} from "@email-social/es-core";
import { DELIVERED_SENT, READ_SENT, SEEN, type MailboxAdapter, type MailEntry } from "./adapters/types.js";
import type { ContactView, ConversationSummary, MessageView, Person, ThreadView } from "./api-types.js";
import type { MetadataCache } from "./cache.js";

export interface SessionOptions {
  adapter: MailboxAdapter;
  account: Person;
  mode: "imap" | "maildir";
  /** Store a copy of sent replies in the sent folder (false when the provider does it). Default true. */
  appendToSent?: boolean;
  clock?: () => Date;
  /** A new Message-ID in angle brackets. */
  newMessageId?: () => string;
  cache?: MetadataCache | null;
  /** Called after anything visible changed (new mail, a reply, flags). */
  onChange?: () => void;
  log?: (message: string) => void;
}

interface Stored {
  key: string;
  entry: MailEntry;
  message: EsMessage;
  /** False for a message restored from the metadata cache until its text is fetched again. */
  hasText: boolean;
  /** Raw bytes of a reply sent in this session whose copy is not in the mailbox (yet). */
  raw?: Uint8Array;
}

interface Model {
  conversations: Conversation[];
  /** Message-ID → the stored copies of that message. */
  copies: Map<string, Stored[]>;
  /** Message-ID of an own message → receipt kinds received for it. */
  receipts: Map<string, Set<ReceiptKind>>;
  /** Canonical addresses that have sent an accepted ES part. */
  esSenders: Set<string>;
}

const encoder = new TextEncoder();

export function keyOf(entry: { folder: string; uid: string }): string {
  return `${entry.folder}:${entry.uid}`;
}

/** The first line of new text: skips empty lines and quoted lines ("> …"). */
export function firstLine(text: string, max = 140): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith(">")) continue;
    return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
  }
  return "";
}

function person(a: EsAddress): Person {
  return { address: a.address, name: a.name.trim() === "" ? a.address : a.name };
}

function byDate(a: Stored, b: Stored): number {
  return (a.message.date ?? "").localeCompare(b.message.date ?? "");
}

export class MailSession {
  private readonly store = new Map<string, Stored>();
  private cursor: string | null = null;
  private model: Model | null = null;
  private syncing: Promise<void> = Promise.resolve();
  private readonly receiptsSent = new Set<string>();
  private stopWatching: (() => void) | null = null;
  private readonly me: string;
  private readonly clock: () => Date;
  private readonly newMessageId: () => string;
  private readonly log: (message: string) => void;

  private constructor(private readonly options: SessionOptions) {
    this.me = canonicalAddress(options.account.address);
    this.clock = options.clock ?? (() => new Date());
    this.newMessageId = options.newMessageId ?? (() => `<${crypto.randomUUID()}@${this.me.split("@")[1] ?? "localhost"}>`);
    this.log = options.log ?? (() => undefined);
  }

  /** Opens the adapter, loads the mailbox and starts watching it. */
  static async start(options: SessionOptions): Promise<MailSession> {
    const session = new MailSession(options);
    await options.adapter.open();
    const cached = (await options.cache?.load()) ?? new Map();
    await session.sync(cached);
    session.stopWatching = options.adapter.watch(() => {
      void session.sync().catch((e: unknown) => session.log(`sync failed: ${String(e)}`));
    });
    return session;
  }

  get account(): Person {
    return this.options.account;
  }

  get mode(): "imap" | "maildir" {
    return this.options.mode;
  }

  /** Fetches new messages; syncs run one after another. */
  sync(cached: Map<string, { entry: MailEntry; message: EsMessage }> = new Map()): Promise<void> {
    const run = this.syncing.then(() => this.syncOnce(cached));
    this.syncing = run.catch(() => undefined);
    return run;
  }

  private async syncOnce(cached: Map<string, { entry: MailEntry; message: EsMessage }>): Promise<void> {
    const initial = this.cursor === null;
    const changes = await this.options.adapter.listSince(this.cursor);
    const added: Stored[] = [];
    const listed = new Set<string>();
    for (const entry of changes.entries) {
      const key = keyOf(entry);
      listed.add(key);
      const existing = this.store.get(key);
      if (existing !== undefined) {
        existing.entry = entry;
        continue;
      }
      const fromCache = cached.get(key);
      const stored: Stored =
        fromCache !== undefined
          ? { key, entry, message: fromCache.message, hasText: false }
          : { key, entry, message: parseMessage(await this.options.adapter.fetchRaw(entry)), hasText: true };
      this.store.set(key, stored);
      added.push(stored);
    }
    if (changes.complete) {
      for (const key of [...this.store.keys()]) {
        if (!listed.has(key) && !key.startsWith("local:")) this.store.delete(key);
      }
    }
    // A reply sent without appending to Sent is replaced by the provider's copy once it shows up.
    for (const stored of added) {
      for (const [key, other] of this.store) {
        if (key.startsWith("local:") && other.message.id === stored.message.id) this.store.delete(key);
      }
    }
    this.cursor = changes.cursor;
    this.model = null;
    for (const stored of added.sort(byDate)) {
      // Without keywords the mailbox cannot record a Delivered receipt; then only new arrivals get one.
      if (initial && !this.options.adapter.keepsKeywords) continue;
      await this.receipt("delivered", stored);
    }
    await this.saveCache();
    if (added.length > 0 || changes.complete) this.options.onChange?.();
  }

  private async saveCache(): Promise<void> {
    try {
      await this.options.cache?.save([...this.store.values()].filter((s) => !s.key.startsWith("local:")));
    } catch (e) {
      this.log(`could not write the metadata cache: ${String(e)}`);
    }
  }

  private isMine(stored: Stored): boolean {
    return stored.entry.folder === "sent" || (stored.message.from !== null && canonicalAddress(stored.message.from.address) === this.me);
  }

  private isReceipt(stored: Stored): boolean {
    return stored.message.es?.$type === "es.social.receipt";
  }

  private build(): Model {
    if (this.model !== null) return this.model;
    const copies = new Map<string, Stored[]>();
    const receipts = new Map<string, Set<ReceiptKind>>();
    const esSenders = new Set<string>();
    const messages: EsMessage[] = [];
    for (const stored of this.store.values()) {
      const es = stored.message.es;
      if (es !== null && !this.isMine(stored)) esSenders.add(canonicalAddress(es.via));
      if (es?.$type === "es.social.receipt") {
        if (!this.isMine(stored)) {
          const kinds = receipts.get(es.messageId) ?? new Set<ReceiptKind>();
          kinds.add(es.kind);
          receipts.set(es.messageId, kinds);
        }
        continue;
      }
      const list = copies.get(stored.message.id);
      if (list === undefined) {
        copies.set(stored.message.id, [stored]);
        messages.push(stored.message);
      } else list.push(stored);
    }
    this.model = { conversations: threadMessages(messages), copies, receipts, esSenders };
    return this.model;
  }

  /** The copy shown for a message: the sent copy of an own message, else the first one. */
  private shown(model: Model, id: string): Stored {
    const list = model.copies.get(id)!;
    return list.find((s) => s.entry.folder === "sent") ?? list[0]!;
  }

  private unread(model: Model, id: string): boolean {
    return model.copies.get(id)!.some((s) => s.entry.folder === "inbox" && !this.isMine(s) && !s.entry.flags.includes(SEEN));
  }

  /** Fetches the text of messages that were restored from the metadata cache. */
  private async ensureText(stored: Stored[]): Promise<void> {
    for (const s of stored) {
      if (s.hasText) continue;
      s.message = parseMessage(await this.options.adapter.fetchRaw(s.entry));
      s.hasText = true;
    }
  }

  private others(conversation: Conversation): Person[] {
    return conversation.participants.filter((p) => canonicalAddress(p.address) !== this.me).map(person);
  }

  private async summary(model: Model, conversation: Conversation): Promise<ConversationSummary> {
    const newest = this.shown(model, conversation.messageIds[conversation.messageIds.length - 1]!);
    await this.ensureText([newest]);
    const participants = this.others(conversation);
    return {
      id: conversation.id,
      title: participants.length === 0 ? this.options.account.name : participants.map((p) => p.name).join(", "),
      subject: conversation.subject,
      participants,
      group: participants.length > 1,
      lastLine: firstLine(newest.message.text),
      lastDate: conversation.lastDate,
      lastFromMe: this.isMine(newest),
      unread: conversation.messageIds.filter((id) => this.unread(model, id)).length,
    };
  }

  /** Conversations, most recent first (es-core's order). */
  async conversations(): Promise<ConversationSummary[]> {
    const model = this.build();
    const out: ConversationSummary[] = [];
    for (const conversation of model.conversations) out.push(await this.summary(model, conversation));
    return out;
  }

  private view(model: Model, stored: Stored): MessageView {
    const mine = this.isMine(stored);
    const kinds = model.receipts.get(stored.message.id);
    const key = encodeURIComponent(stored.key);
    return {
      key: stored.key,
      from: stored.message.from === null ? null : person(stored.message.from),
      mine,
      date: stored.message.date,
      text: stored.message.text,
      textSource: stored.message.textSource,
      attachments: stored.message.attachments.map((a) => ({
        partId: a.partId,
        filename: a.filename ?? `attachment-${a.partId}`,
        contentType: a.contentType,
        size: a.size,
        path: `/api/messages/${key}/attachments/${encodeURIComponent(a.partId)}`,
      })),
      originalPath: `/api/messages/${key}/original`,
      status: !mine ? null : kinds?.has("read") ? "read" : kinds?.has("delivered") ? "delivered" : "sent",
      emailSocial: stored.message.es !== null,
    };
  }

  async thread(conversationId: string): Promise<ThreadView | null> {
    const model = this.build();
    const conversation = model.conversations.find((c) => c.id === conversationId);
    if (conversation === undefined) return null;
    const shown = conversation.messageIds.map((id) => this.shown(model, id));
    await this.ensureText(shown);
    return { conversation: await this.summary(model, conversation), messages: shown.map((s) => this.view(model, s)) };
  }

  /**
   * Marks the incoming messages of a conversation \Seen and sends the Read
   * receipts their senders asked for (once per message), plus \Seen on
   * receipts that concern the conversation.
   */
  async markRead(conversationId: string): Promise<void> {
    const model = this.build();
    const conversation = model.conversations.find((c) => c.id === conversationId);
    if (conversation === undefined) return;
    let changed = false;
    for (const id of conversation.messageIds) {
      for (const stored of model.copies.get(id)!) {
        if (stored.entry.folder !== "inbox" || this.isMine(stored)) continue;
        const wasUnseen = !stored.entry.flags.includes(SEEN);
        if (wasUnseen) {
          await this.options.adapter.addFlags(stored.entry, [SEEN]);
          stored.entry.flags.push(SEEN);
          changed = true;
        }
        if (this.options.adapter.keepsKeywords || wasUnseen) await this.receipt("read", stored);
      }
    }
    const ids = new Set(conversation.messageIds);
    for (const stored of this.store.values()) {
      const es = stored.message.es;
      if (es?.$type !== "es.social.receipt" || !ids.has(es.messageId) || stored.entry.flags.includes(SEEN) || stored.entry.folder !== "inbox") continue;
      await this.options.adapter.addFlags(stored.entry, [SEEN]);
      stored.entry.flags.push(SEEN);
      changed = true;
    }
    if (changed) {
      this.model = null;
      await this.saveCache();
      this.options.onChange?.();
    }
  }

  /**
   * Sends a receipt of `kind` for an incoming message when its ES part asked
   * for one and none has been sent yet (keyword in the mailbox, or in this
   * session). Plain e-mail senders never get one.
   */
  private async receipt(kind: ReceiptKind, stored: Stored): Promise<void> {
    const es = stored.message.es;
    if (es?.$type !== "es.social.post" || !es.requestReceipts.includes(kind)) return;
    if (stored.entry.folder !== "inbox" || this.isMine(stored) || stored.message.refs.messageId === null) return;
    const flag = kind === "read" ? READ_SENT : DELIVERED_SENT;
    const once = `${kind} ${stored.message.id}`;
    if (stored.entry.flags.includes(flag) || this.receiptsSent.has(once)) return;
    this.receiptsSent.add(once);
    const to: EsAddress = { name: stored.message.from?.name ?? "", address: es.via };
    const raw = serializeReceipt(
      { kind, from: { name: this.options.account.name, address: this.me }, to, original: replyTargetOf(stored.message) },
      { date: this.clock(), messageId: this.newMessageId() },
    );
    try {
      await this.options.adapter.send(encoder.encode(raw), { from: this.me, to: [es.via] });
      await this.options.adapter.addFlags(stored.entry, [flag]);
      stored.entry.flags.push(flag);
    } catch (e) {
      this.receiptsSent.delete(once);
      this.log(`could not send a ${kind} receipt: ${String(e)}`);
    }
  }

  /**
   * Replies in a conversation to everyone else in it. The reply carries the
   * ES part (and asks for receipts) only when someone in the conversation
   * has sent an ES part before; otherwise it is plain text/plain e-mail.
   */
  async send(conversationId: string, text: string): Promise<MessageView> {
    if (text.trim() === "") throw new RangeError("The message is empty");
    const model = this.build();
    const conversation = model.conversations.find((c) => c.id === conversationId);
    if (conversation === undefined) throw new RangeError("No such conversation");
    const others = this.others(conversation);
    const to: EsAddress[] = others.length > 0 ? others.map((p) => ({ name: p.name === p.address ? "" : p.name, address: p.address })) : [{ name: "", address: this.me }];
    const newest = this.shown(model, conversation.messageIds[conversation.messageIds.length - 1]!);
    const emailSocial = others.some((p) => model.esSenders.has(canonicalAddress(p.address)));
    const messageId = this.newMessageId();
    const raw = serializeMessage(
      {
        from: { name: this.options.account.name, address: this.me },
        to,
        text,
        ...(newest.message.refs.messageId !== null
          ? { inReplyTo: replyTargetOf(newest.message) }
          : { subject: conversation.subject === "" ? "" : `Re: ${conversation.subject}` }),
        ...(emailSocial ? { es: { requestReceipts: ["delivered", "read"] as ReceiptKind[] } } : {}),
      },
      { date: this.clock(), messageId, includeEsPart: emailSocial },
    );
    const bytes = encoder.encode(raw);
    await this.options.adapter.send(bytes, { from: this.me, to: to.map((a) => a.address) });
    let stored: Stored;
    if (this.options.appendToSent !== false) {
      const entry = await this.options.adapter.appendToSent(bytes);
      stored = { key: keyOf(entry), entry, message: parseMessage(bytes), hasText: true };
    } else {
      const entry: MailEntry = { folder: "sent", uid: messageId, flags: [SEEN] };
      stored = { key: `local:${messageId}`, entry, message: parseMessage(bytes), hasText: true, raw: bytes };
    }
    this.store.set(stored.key, stored);
    this.model = null;
    await this.saveCache();
    this.options.onChange?.();
    return this.view(this.build(), stored);
  }

  contacts(): ContactView[] {
    const model = this.build();
    const messages = [...this.store.values()].filter((s) => !this.isReceipt(s)).map((s) => s.message);
    return deriveContacts(messages, { exclude: [this.me] }).map((c) => ({
      address: c.address,
      name: c.name === "" ? c.address : c.name,
      lastSeen: c.lastSeen,
      count: c.count,
      emailSocial: model.esSenders.has(c.address),
    }));
  }

  private async raw(key: string): Promise<Uint8Array | null> {
    const stored = this.store.get(key);
    if (stored === undefined) return null;
    if (stored.raw !== undefined) return stored.raw;
    return this.options.adapter.fetchRaw(stored.entry);
  }

  /** The original message as it is in the mailbox (for "open original"). */
  async original(key: string): Promise<Uint8Array | null> {
    return this.raw(key);
  }

  /** The decoded content of one attachment. */
  async attachment(key: string, partId: string): Promise<EsPartContent | null> {
    const raw = await this.raw(key);
    return raw === null ? null : extractPart(raw, partId);
  }

  async close(): Promise<void> {
    this.stopWatching?.();
    await this.syncing;
    await this.options.adapter.close();
  }
}
