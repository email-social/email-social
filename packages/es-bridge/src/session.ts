/**
 * One signed-in mailbox: messages held in memory, shown as chats with
 * people (es-core groupByParticipants) and "Other mail" (lists and
 * automated senders); replies, new chats and receipts sent through the
 * adapter.
 *
 * Loading is progressive: start() returns once the newest messages are in
 * (firstBatch), the rest downloads in the background with a count, and a
 * server that stops answering is noticed (stallMs) instead of waited for.
 *
 * Nothing here writes message content to disk. The optional metadata cache
 * (cache.ts) stores headers and flags only.
 */

import { createHash } from "node:crypto";
import {
  canonicalAddress,
  classifyMessage,
  deriveContacts,
  extractPart,
  groupByParticipants,
  normalizeSubject,
  parseMessage,
  quoteForReply,
  replyTargetOf,
  serializeMessage,
  serializeReceipt,
  splitQuoted,
  type Chat,
  type EsAddress,
  type EsMessage,
  type EsPartContent,
  type MessageKind,
  type QuotedSplit,
  type ReceiptKind,
} from "@email-social/es-core";
import { DELIVERED_SENT, READ_SENT, SEEN, type ConnectionStatus, type MailboxAdapter, type MailEntry, type MailRef } from "./adapters/types.js";
import type {
  ChatSummary,
  ChatView,
  ContactDetail,
  ContactView,
  MessageView,
  OtherSummary,
  OtherView,
  Person,
  SendRequest,
  SendResult,
  StartProgress,
  SyncStatus,
} from "./api-types.js";
import type { MetadataCache } from "./cache.js";

export interface SessionOptions {
  adapter: MailboxAdapter;
  account: Person;
  mode: "imap" | "maildir";
  /** Store a copy of sent messages in the sent folder (false when the provider does it). Default true. */
  appendToSent?: boolean;
  clock?: () => Date;
  /** A new Message-ID in angle brackets. */
  newMessageId?: () => string;
  cache?: MetadataCache | null;
  /** Called after anything in the mailbox changed (new mail, a reply, flags). */
  onChange?: () => void;
  /** Called when loading progress, the connection or an error changed (see status()). */
  onStatus?: () => void;
  /** Called during start() as it connects, lists and downloads. */
  onProgress?: (progress: StartProgress) => void;
  log?: (message: string) => void;
  /** Messages downloaded before start() returns; the rest follows in the background. Default 50. */
  firstBatch?: number;
  /** No answer from the mailbox for this long (ms) counts as a server that stopped answering. Default 45 s. */
  stallMs?: number;
  /** Time zone of the date in quoted replies. Default: this computer's. */
  timeZone?: string;
}

interface Stored {
  key: string;
  entry: MailEntry;
  message: EsMessage;
  /** False for a message restored from the metadata cache until its text is fetched again. */
  hasText: boolean;
  /** Raw bytes of a message sent in this session whose copy is not in the mailbox (yet). */
  raw?: Uint8Array;
}

interface OtherGroup {
  summaryId: string;
  kind: "list" | "automated";
  title: string;
  address: string;
  messageIds: string[];
}

interface Model {
  chats: Chat[];
  others: OtherGroup[];
  /** Message-ID → the stored copies of that message. */
  copies: Map<string, Stored[]>;
  /** Message-ID of an own message → receipt kinds received for it. */
  receipts: Map<string, Set<ReceiptKind>>;
  /** Canonical addresses that have sent an accepted ES part. */
  esSenders: Set<string>;
}

export const DEFAULT_STALL_MS = 45_000;
const DEFAULT_FIRST_BATCH = 50;

const encoder = new TextEncoder();

export function keyOf(entry: { folder: string; uid: string }): string {
  return `${entry.folder}:${entry.uid}`;
}

/** The first non-empty line of a text, shortened to `max` characters. */
export function firstLine(text: string, max = 140): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
  }
  return "";
}

/** The subject of a new chat without one: the first line of the text, cut at 60 characters at a word boundary. */
export function subjectFromText(text: string, max = 60): string {
  const line = firstLine(text, Number.MAX_SAFE_INTEGER).replace(/\s+/g, " ");
  if (line.length <= max) return line;
  const cut = line.lastIndexOf(" ", max);
  return (cut > 0 ? line.slice(0, cut) : line.slice(0, max)).trimEnd();
}

/** A syntactically plausible address (the mail server decides the rest). */
export function isAddress(value: string): boolean {
  return /^[^@\s<>(),;:"\\[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
}

function person(a: EsAddress): Person {
  return { address: a.address, name: a.name.trim() === "" ? a.address : a.name };
}

function byDateOldestFirst(a: EsMessage, b: EsMessage): number {
  return (a.date ?? "\uffff").localeCompare(b.date ?? "\uffff") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Calls `onStall` when `kick` has not been called for `ms`. */
class Watchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ms: number,
    private readonly onStall: () => void,
  ) {
    this.kick();
  }

  kick(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(this.onStall, this.ms);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Calls `fn` at most every `ms`, and once more after the last call. */
function throttle(ms: number, fn: () => void): { call(): void; flush(): void } {
  let last = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const run = (): void => {
    pending = null;
    last = Date.now();
    fn();
  };
  return {
    call(): void {
      if (pending !== null) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) run();
      else pending = setTimeout(run, wait);
    },
    flush(): void {
      if (pending !== null) clearTimeout(pending);
      run();
    },
  };
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
  private readonly stallMs: number;
  private loading: { loaded: number; total: number } | null = null;
  /** Messages still to download after a stopped background load. */
  private remaining: MailEntry[] = [];
  private connection: ConnectionStatus = { state: "online" };
  private error: string | null = null;
  private closed = false;
  private readonly statusChanged: { call(): void; flush(): void };
  private readonly mailChanged: { call(): void; flush(): void };
  private readonly splits = new Map<string, QuotedSplit>();

  private constructor(private readonly options: SessionOptions) {
    this.me = canonicalAddress(options.account.address);
    this.clock = options.clock ?? (() => new Date());
    this.newMessageId = options.newMessageId ?? (() => `<${crypto.randomUUID()}@${this.me.split("@")[1] ?? "localhost"}>`);
    this.log = options.log ?? (() => undefined);
    this.stallMs = options.stallMs ?? DEFAULT_STALL_MS;
    this.statusChanged = throttle(250, () => options.onStatus?.());
    this.mailChanged = throttle(1000, () => options.onChange?.());
  }

  /**
   * Connects, lists the mailbox and downloads the newest messages; returns
   * then, while older messages keep downloading. Fails when the server
   * stops answering for stallMs.
   */
  static async start(options: SessionOptions): Promise<MailSession> {
    const session = new MailSession(options);
    await session.begin();
    return session;
  }

  private async begin(): Promise<void> {
    const adapter = this.options.adapter;
    const progress = (p: StartProgress): void => this.options.onProgress?.(p);
    let stalled: (reason: Error) => void = () => undefined;
    const stall = new Promise<never>((_, reject) => {
      stalled = reject;
    });
    stall.catch(() => undefined);
    const dog = new Watchdog(this.stallMs, () =>
      stalled(new Error(`No answer from the mail server for ${Math.round(this.stallMs / 1000)} seconds. Check the connection and try again.`)),
    );
    const guard = <T>(work: Promise<T>): Promise<T> => Promise.race([work, stall]);
    try {
      progress({ step: "connecting", loaded: 0, total: null });
      await guard(adapter.open());
      dog.kick();
      progress({ step: "listing", loaded: 0, total: null });
      const cached = (await this.options.cache?.load()) ?? new Map();
      const changes = await guard(adapter.listSince(null));
      dog.kick();
      const pending = this.applyListing(changes, cached);
      this.cursor = changes.cursor;
      const total = pending.length;
      let loaded = 0;
      progress({ step: "loading", loaded, total });
      const firstBatch = pending.slice(0, this.options.firstBatch ?? DEFAULT_FIRST_BATCH);
      await guard(
        this.download(firstBatch, true, () => {
          loaded++;
          dog.kick();
          progress({ step: "loading", loaded, total });
        }),
      );
      const rest = pending.slice(firstBatch.length);
      if (rest.length > 0) {
        this.loading = { loaded, total };
        this.syncing = this.backgroundLoad(rest);
      }
    } finally {
      dog.stop();
    }
    await this.saveCache();
    this.stopWatching = adapter.watch(
      () => void this.sync().catch((e: unknown) => this.log(`sync failed: ${errorText(e)}`)),
      (status) => {
        this.connection = status;
        this.statusChanged.call();
      },
    );
  }

  /**
   * Takes a listing into the store: updates flags of known messages,
   * forgets deleted ones, restores cached ones. Returns the entries whose
   * text must be downloaded, newest first.
   */
  private applyListing(
    changes: { entries: MailEntry[]; complete: string[] },
    cached: Map<string, { entry: MailEntry; message: EsMessage }> = new Map(),
  ): MailEntry[] {
    const pending: MailEntry[] = [];
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
      if (fromCache !== undefined) this.store.set(key, { key, entry, message: fromCache.message, hasText: false });
      else pending.push(entry);
    }
    for (const [key, stored] of [...this.store]) {
      if (changes.complete.includes(stored.entry.folder) && !listed.has(key) && !key.startsWith("local:")) this.store.delete(key);
    }
    this.model = null;
    // Newest first: by the mailbox's arrival date when known, else by uid, taking the folders in turn.
    const order = new Map(pending.map((entry, index) => [entry, index]));
    return pending.sort((a, b) => {
      if (a.date !== undefined && b.date !== undefined && a.date !== b.date) return a.date < b.date ? 1 : -1;
      return order.get(b)! - order.get(a)!;
    });
  }

  /** Downloads and parses messages, then sends the Delivered receipts they ask for. */
  private async download(entries: readonly MailEntry[], initial: boolean, each: () => void): Promise<void> {
    if (entries.length === 0) return;
    const byKey = new Map(entries.map((entry) => [keyOf(entry), entry]));
    const added: Stored[] = [];
    await this.options.adapter.fetchMany(entries, (ref: MailRef, raw: Uint8Array) => {
      const key = keyOf(ref);
      const entry = byKey.get(key);
      if (entry === undefined || this.closed) return;
      const message = parseMessage(raw);
      const stored: Stored = { key, entry, message, hasText: true };
      this.store.set(key, stored);
      added.push(stored);
      // A message sent without a copy in the mailbox is replaced by the provider's copy once it shows up.
      for (const [other, s] of this.store) if (other.startsWith("local:") && s.message.id === message.id) this.store.delete(other);
      this.model = null;
      each();
    });
    for (const stored of added.sort((a, b) => byDateOldestFirst(a.message, b.message))) {
      // Without keywords the mailbox cannot record a Delivered receipt; then only new arrivals get one.
      if (initial && !this.options.adapter.keepsKeywords) continue;
      // A message already read arrived long ago; "delivered" would be news to no one (Read covers it).
      if (stored.entry.flags.includes(SEEN)) continue;
      await this.receipt("delivered", stored);
    }
  }

  /** Downloads the older messages after start(); a stall stops it with an error the page shows. */
  private async backgroundLoad(entries: MailEntry[]): Promise<void> {
    const done = new Set<string>();
    const dog = new Watchdog(this.stallMs, () => {
      const reason = `No answer from the mail server for ${Math.round(this.stallMs / 1000)} seconds`;
      this.error = `Loading stopped: ${reason.toLowerCase()}.`;
      this.options.adapter.reconnect(reason);
    });
    try {
      await this.download(entries, true, () => {
        dog.kick();
        if (this.loading !== null) this.loading = { ...this.loading, loaded: this.loading.loaded + 1 };
        this.statusChanged.call();
        this.mailChanged.call();
      });
      for (const entry of entries) done.add(keyOf(entry));
      this.loading = null;
      this.remaining = [];
    } catch (e) {
      for (const entry of entries) if (this.store.has(keyOf(entry))) done.add(keyOf(entry));
      this.remaining = entries.filter((entry) => !done.has(keyOf(entry)));
      this.error ??= `Loading stopped: ${errorText(e)}`;
      this.log(`background loading failed: ${errorText(e)}`);
    } finally {
      dog.stop();
      if (!this.closed) {
        await this.saveCache();
        this.statusChanged.flush();
        this.mailChanged.flush();
      }
    }
  }

  get account(): Person {
    return this.options.account;
  }

  get mode(): "imap" | "maildir" {
    return this.options.mode;
  }

  status(): SyncStatus {
    return { loading: this.loading, connection: this.connection.state, error: this.error };
  }

  /** "Try again" after an error: downloads what is missing and checks for new mail. */
  retry(): Promise<void> {
    this.error = null;
    this.statusChanged.flush();
    const remaining = this.remaining;
    this.remaining = [];
    if (remaining.length > 0) {
      this.loading = { loaded: this.loading?.loaded ?? 0, total: this.loading?.total ?? remaining.length };
      const run = this.syncing.then(() => this.backgroundLoad(remaining));
      this.syncing = run.catch(() => undefined);
    }
    return this.sync();
  }

  /** Fetches new messages; syncs run one after another. A sync that stops getting answers drops the connection. */
  sync(): Promise<void> {
    const run = this.syncing.then(async () => {
      const dog = new Watchdog(this.stallMs, () => this.options.adapter.reconnect(`No answer from the mail server for ${Math.round(this.stallMs / 1000)} seconds`));
      try {
        await this.syncOnce(() => dog.kick());
      } finally {
        dog.stop();
      }
    });
    this.syncing = run.catch(() => undefined);
    return run;
  }

  private async syncOnce(kick: () => void): Promise<void> {
    if (this.closed) return;
    const changes = await this.options.adapter.listSince(this.cursor);
    kick();
    const before = this.store.size;
    const pending = this.applyListing(changes);
    await this.download(pending, false, kick);
    this.cursor = changes.cursor;
    await this.saveCache();
    if (pending.length > 0 || changes.complete.length > 0 || this.store.size !== before) this.mailChanged.flush();
  }

  private async saveCache(): Promise<void> {
    try {
      await this.options.cache?.save([...this.store.values()].filter((s) => !s.key.startsWith("local:")));
    } catch (e) {
      this.log(`could not write the metadata cache: ${errorText(e)}`);
    }
  }

  private isMine(stored: Stored): boolean {
    return stored.entry.folder === "sent" || (stored.message.from !== null && canonicalAddress(stored.message.from.address) === this.me);
  }

  private isReceipt(stored: Stored): boolean {
    return stored.message.es?.$type === "es.social.receipt";
  }

  // ---------------------------------------------------------------- the model

  private build(): Model {
    if (this.model !== null) return this.model;
    const copies = new Map<string, Stored[]>();
    const receipts = new Map<string, Set<ReceiptKind>>();
    const esSenders = new Set<string>();
    const messages: { stored: Stored; message: EsMessage }[] = [];
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
        messages.push({ stored, message: stored.message });
      } else list.push(stored);
    }

    // Lists: the addresses list mail was sent to, keyed by the list; own posts to them are list mail too.
    const kinds = new Map<string, MessageKind>();
    const listKeyOf = new Map<string, string>();
    for (const { stored, message } of messages) {
      const kind = this.isMine(stored) ? "person" : classifyMessage(message);
      kinds.set(message.id, kind);
      if (kind !== "list") continue;
      const key = message.delivery.listId ?? canonicalAddress(message.from?.address ?? "");
      for (const a of [...message.to, ...message.cc]) {
        const address = canonicalAddress(a.address);
        if (address !== this.me) listKeyOf.set(address, key);
      }
    }
    const people: EsMessage[] = [];
    const groups = new Map<string, OtherGroup>();
    const addOther = (kind: "list" | "automated", key: string, title: string, address: string, id: string): void => {
      const groupKey = `${kind}:${key}`;
      let group = groups.get(groupKey);
      if (group === undefined) {
        group = { summaryId: "other-" + createHash("sha256").update(groupKey).digest("hex").slice(0, 32), kind, title, address, messageIds: [] };
        groups.set(groupKey, group);
      }
      group.messageIds.push(id);
      if (title !== "") group.title = title;
    };
    for (const { message } of messages.sort((a, b) => byDateOldestFirst(a.message, b.message))) {
      const kind = kinds.get(message.id)!;
      const from = message.from === null ? "" : canonicalAddress(message.from.address);
      if (kind === "person") {
        const list = [...message.to, ...message.cc].map((a) => listKeyOf.get(canonicalAddress(a.address))).find((k) => k !== undefined);
        if (list === undefined) people.push(message);
        else addOther("list", list, "", [...message.to, ...message.cc].map((a) => canonicalAddress(a.address)).find((a) => listKeyOf.has(a)) ?? "", message.id);
      } else if (kind === "list") {
        const key = message.delivery.listId ?? from;
        // A mailing list is named by its address; a newsletter (sent to the account itself) by its sender.
        const address = [...message.to, ...message.cc].map((a) => canonicalAddress(a.address)).find((a) => listKeyOf.get(a) === key && a !== this.me) ?? from;
        addOther("list", key, address !== from || message.from === null ? address : person(message.from).name, address, message.id);
      } else {
        addOther("automated", from, message.from === null ? "" : person(message.from).name, from, message.id);
      }
    }
    const others = [...groups.values()].sort((a, b) => {
      const last = (g: OtherGroup): string => this.shownIn(copies, g.messageIds[g.messageIds.length - 1]!).message.date ?? "";
      return last(b).localeCompare(last(a)) || a.summaryId.localeCompare(b.summaryId);
    });
    this.model = { chats: groupByParticipants(people, { self: this.me }), others, copies, receipts, esSenders };
    return this.model;
  }

  private shownIn(copies: Map<string, Stored[]>, id: string): Stored {
    const list = copies.get(id)!;
    return list.find((s) => s.entry.folder === "sent") ?? list[0]!;
  }

  /** The copy shown for a message: the sent copy of an own message, else the first one. */
  private shown(model: Model, id: string): Stored {
    return this.shownIn(model.copies, id);
  }

  private unread(model: Model, id: string): boolean {
    return model.copies.get(id)!.some((s) => s.entry.folder === "inbox" && !this.isMine(s) && !s.entry.flags.includes(SEEN));
  }

  /** Fetches the text of messages that were restored from the metadata cache. */
  private async ensureText(stored: Stored[]): Promise<void> {
    const missing = stored.filter((s) => !s.hasText);
    if (missing.length === 0) return;
    const byKey = new Map(missing.map((s) => [s.key, s]));
    await this.options.adapter.fetchMany(
      missing.map((s) => s.entry),
      (ref, raw) => {
        const s = byKey.get(keyOf(ref));
        if (s === undefined) return;
        s.message = parseMessage(raw);
        s.hasText = true;
      },
    );
  }

  private split(message: EsMessage): QuotedSplit {
    let split = this.splits.get(message.id + "\u0000" + message.text.length);
    if (split === undefined) {
      split = splitQuoted(message);
      this.splits.set(message.id + "\u0000" + message.text.length, split);
    }
    return split;
  }

  private chatSummary(model: Model, chat: Chat): ChatSummary {
    const newest = this.shown(model, chat.messages[chat.messages.length - 1]!.id);
    const participants = chat.participants.map(person);
    const split = this.split(newest.message);
    return {
      id: chat.id,
      title: participants.length === 0 ? "You" : participants.map((p) => p.name).join(", "),
      participants,
      group: participants.length > 1,
      lastLine: firstLine(split.fresh !== "" ? split.fresh : newest.message.text),
      lastDate: chat.lastDate,
      lastFromMe: this.isMine(newest),
      unread: chat.messages.filter((m) => this.unread(model, m.id)).length,
      emailSocial: participants.some((p) => model.esSenders.has(canonicalAddress(p.address))),
    };
  }

  /** The text of the newest message of each chat is needed for its last line. */
  private async newestTexts(model: Model): Promise<void> {
    const newest = [
      ...model.chats.map((c) => this.shown(model, c.messages[c.messages.length - 1]!.id)),
      ...model.others.map((g) => this.shown(model, g.messageIds[g.messageIds.length - 1]!)),
    ];
    await this.ensureText(newest);
  }

  /** Chats, most recent first. */
  async chats(): Promise<ChatSummary[]> {
    const model = this.build();
    await this.newestTexts(model);
    return model.chats.map((chat) => this.chatSummary(model, chat));
  }

  private view(model: Model, stored: Stored): MessageView {
    const mine = this.isMine(stored);
    const kinds = model.receipts.get(stored.message.id);
    const key = encodeURIComponent(stored.key);
    const split = this.split(stored.message);
    return {
      key: stored.key,
      from: stored.message.from === null ? null : person(stored.message.from),
      mine,
      date: stored.message.date,
      subject: normalizeSubject(stored.message.subject).base,
      text: stored.message.text,
      fresh: split.fresh,
      quoted: split.quoted,
      signature: split.signature,
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

  async chat(chatId: string): Promise<ChatView | null> {
    const model = this.build();
    const chat = model.chats.find((c) => c.id === chatId);
    if (chat === undefined) return null;
    const shown = chat.messages.map((m) => this.shown(model, m.id));
    await this.ensureText(shown);
    return { chat: this.chatSummary(model, chat), messages: shown.map((s) => this.view(model, s)) };
  }

  private otherSummary(model: Model, group: OtherGroup): OtherSummary {
    const newest = this.shown(model, group.messageIds[group.messageIds.length - 1]!);
    const split = this.split(newest.message);
    return {
      id: group.summaryId,
      kind: group.kind,
      title: group.title === "" ? group.address : group.title,
      address: group.address,
      count: group.messageIds.length,
      unread: group.messageIds.filter((id) => this.unread(model, id)).length,
      lastLine: firstLine(split.fresh !== "" ? split.fresh : newest.message.text),
      lastDate: newest.message.date,
    };
  }

  /** "Other mail": lists and automated senders, most recent first. */
  async others(): Promise<OtherSummary[]> {
    const model = this.build();
    await this.newestTexts(model);
    return model.others.map((group) => this.otherSummary(model, group));
  }

  async other(id: string): Promise<OtherView | null> {
    const model = this.build();
    const group = model.others.find((g) => g.summaryId === id);
    if (group === undefined) return null;
    const shown = group.messageIds.map((m) => this.shown(model, m));
    await this.ensureText(shown);
    return { sender: this.otherSummary(model, group), messages: shown.map((s) => this.view(model, s)) };
  }

  private messageIdsOf(model: Model, id: string): string[] | null {
    const chat = model.chats.find((c) => c.id === id);
    if (chat !== undefined) return chat.messages.map((m) => m.id);
    return model.others.find((g) => g.summaryId === id)?.messageIds ?? null;
  }

  /**
   * Marks the incoming messages of a chat (or an "Other mail" sender) \Seen
   * and sends the Read receipts their senders asked for (once per message),
   * plus \Seen on receipts that concern them. Returns false for an unknown id.
   */
  async markRead(id: string): Promise<boolean> {
    const model = this.build();
    const messageIds = this.messageIdsOf(model, id);
    if (messageIds === null) return false;
    let changed = false;
    for (const messageId of messageIds) {
      for (const stored of model.copies.get(messageId)!) {
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
    const ids = new Set(messageIds);
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
      this.mailChanged.flush();
    }
    return true;
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
      this.log(`could not send a ${kind} receipt: ${errorText(e)}`);
    }
  }

  /** Display names known for addresses, from the mailbox. */
  private names(): Map<string, string> {
    const messages = [...this.store.values()].filter((s) => !this.isReceipt(s)).map((s) => s.message);
    return new Map(deriveContacts(messages, { exclude: [this.me] }).map((c) => [c.address, c.name]));
  }

  /**
   * Sends a message: a reply in a chat (to everyone else in it) or the first
   * message of a new chat (to the given addresses). It carries the ES part,
   * and asks for receipts, only when a recipient has sent an ES part before;
   * otherwise it is plain text/plain e-mail. A reply in a chat where nobody
   * has sent an ES part quotes the message it answers below the text, since
   * the recipient's mail client shows no chat history.
   */
  async send(request: SendRequest): Promise<SendResult> {
    const text = request.text;
    if (typeof text !== "string" || text.trim() === "") throw new RangeError("The message is empty");
    const model = this.build();
    const subject = typeof request.subject === "string" ? request.subject.replace(/\s+/g, " ").trim() : "";
    let recipients: string[];
    let answered: EsMessage | null = null;
    if (request.chatId !== undefined) {
      const chat = model.chats.find((c) => c.id === request.chatId);
      if (chat === undefined) throw new RangeError("No such chat");
      recipients = chat.participants.map((p) => p.address);
      const shown = chat.messages.map((m) => this.shown(model, m.id));
      await this.ensureText(shown);
      const fromOthers = shown.filter((s) => !this.isMine(s));
      answered = (fromOthers[fromOthers.length - 1] ?? shown[shown.length - 1])!.message;
    } else {
      const to = (request.to ?? []).map((a) => (typeof a === "string" ? a.trim() : ""));
      if (to.length === 0) throw new RangeError("Add at least one recipient");
      const invalid = to.filter((a) => !isAddress(a));
      if (invalid.length > 0) throw new RangeError(`Not an e-mail address: ${invalid.join(", ")}`);
      recipients = [...new Set(to.map(canonicalAddress))].filter((a) => a !== this.me);
    }
    const names = this.names();
    const toList: EsAddress[] = recipients.length > 0 ? recipients.map((address) => ({ name: names.get(address) ?? "", address })) : [{ name: "", address: this.me }];
    const emailSocial = recipients.some((a) => model.esSenders.has(canonicalAddress(a)));
    const reply = answered !== null && subject === "";
    const body = reply && !emailSocial ? joinQuote(text, quoteForReply(answered!, { maxLines: 40, timeZone: this.options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })) : text;
    const messageId = this.newMessageId();
    const raw = serializeMessage(
      {
        from: { name: this.options.account.name, address: this.me },
        to: toList,
        text: body,
        ...(reply && answered!.refs.messageId !== null
          ? { inReplyTo: replyTargetOf(answered!) }
          : { subject: subject !== "" ? subject : reply ? `Re: ${normalizeSubject(answered!.subject).base}` : subjectFromText(text) }),
        ...(emailSocial ? { es: { requestReceipts: ["delivered", "read"] as ReceiptKind[] } } : {}),
      },
      { date: this.clock(), messageId, includeEsPart: emailSocial },
    );
    const bytes = encoder.encode(raw);
    await this.options.adapter.send(bytes, { from: this.me, to: toList.map((a) => a.address) });
    let stored: Stored;
    const entry = this.options.appendToSent !== false ? await this.options.adapter.appendToSent(bytes) : null;
    if (entry !== null) {
      stored = { key: keyOf(entry), entry, message: parseMessage(bytes), hasText: true };
    } else {
      const local: MailEntry = { folder: "sent", uid: messageId, flags: [SEEN] };
      stored = { key: `local:${messageId}`, entry: local, message: parseMessage(bytes), hasText: true, raw: bytes };
    }
    this.store.set(stored.key, stored);
    this.model = null;
    await this.saveCache();
    this.mailChanged.flush();
    const after = this.build();
    const chat = after.chats.find((c) => c.messages.some((m) => m.id === stored.message.id));
    return { chatId: chat?.id ?? "", message: this.view(after, stored) };
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

  /** Everything about one person: names, dates, count, the chat, attachments exchanged, shared groups. */
  contact(address: string): ContactDetail | null {
    const target = canonicalAddress(address);
    if (target === this.me) return null;
    const model = this.build();
    const involved = (m: EsMessage): boolean => [...(m.from === null ? [] : [m.from]), ...m.to, ...m.cc].some((a) => canonicalAddress(a.address) === target);
    const messages = [...model.copies.keys()].map((id) => this.shown(model, id)).filter((s) => involved(s.message));
    if (messages.length === 0) return null;
    const contact = deriveContacts(
      messages.map((s) => s.message),
      { exclude: [this.me] },
    ).find((c) => c.address === target)!;
    const dates = messages.map((s) => s.message.date).filter((d): d is string => d !== null).sort();
    const attachments = messages
      .filter((s) => {
        const from = s.message.from === null ? "" : canonicalAddress(s.message.from.address);
        return from === target || this.isMine(s);
      })
      .sort((a, b) => byDateOldestFirst(b.message, a.message))
      .flatMap((s) => this.view(model, s).attachments.map((a) => ({ ...a, date: s.message.date, fromMe: this.isMine(s) })));
    const chats = model.chats.filter((c) => c.participants.some((p) => p.address === target));
    return {
      address: target,
      name: contact.name === "" ? target : contact.name,
      names: contact.names,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      count: messages.length,
      emailSocial: model.esSenders.has(target),
      chatId: chats.find((c) => c.participants.length === 1)?.id ?? null,
      attachments,
      groups: chats.filter((c) => c.participants.length > 1).map((c) => this.chatSummary(model, c)),
    };
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
    this.closed = true;
    this.stopWatching?.();
    await Promise.race([this.syncing, new Promise((resolve) => setTimeout(resolve, 2000).unref?.())]);
    await this.options.adapter.close();
  }
}

/** The text, a blank line, and the quote (for replies to people without Email Social). */
function joinQuote(text: string, quote: string): string {
  return quote === "" ? text : `${text.replace(/\s+$/, "")}\n\n${quote}`;
}
