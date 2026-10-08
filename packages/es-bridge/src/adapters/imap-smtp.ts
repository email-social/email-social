/**
 * A real mail account: IMAP (RFC 9051, via imapflow) for reading, SMTP
 * (RFC 5321, via nodemailer) for sending. The only network connections the
 * bridge makes are the two configured here.
 *
 * - Passwords go only over TLS: implicit TLS, or STARTTLS that must succeed
 *   before login. There is no plain-text option.
 * - uids are "UIDVALIDITY.UID" (RFC 9051 §2.3.1.1), so a mailbox that
 *   renumbers its messages is read again instead of being mixed up.
 * - INBOX stays selected between operations so imapflow can IDLE on it
 *   (RFC 2177) and report new mail at once; every folder is also checked on
 *   a timer, for servers without IDLE and for the sent folder.
 * - A lost connection is re-established with growing pauses (1 s up to
 *   60 s), and the watcher is told ("Reconnecting…").
 */

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { AccountConfig } from "../credentials.js";
import {
  SEEN,
  type ConnectionStatus,
  type Envelope,
  type FolderRole,
  type MailboxAdapter,
  type MailboxChanges,
  type MailEntry,
  type MailRef,
} from "./types.js";

interface MailboxInfo {
  path: string;
  uidValidity: bigint;
  uidNext: number;
  permanentFlags?: Set<string> | undefined;
}

interface FetchedMessage {
  uid: number;
  flags?: Set<string> | undefined;
  internalDate?: Date | string | undefined;
  source?: Buffer | undefined;
}

/** The part of ImapFlow the adapter uses (so tests can supply their own). */
export interface ImapClient {
  mailbox: MailboxInfo | false | object;
  connect(): Promise<void>;
  list(): Promise<{ path: string; specialUse?: string | undefined }[]>;
  mailboxCreate(path: string): Promise<unknown>;
  mailboxOpen(path: string): Promise<unknown>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(query: { all: true }, options: { uid: true }): Promise<number[] | false | undefined | object>;
  fetch(
    range: string,
    query: { uid: true; flags?: true; internalDate?: true; source?: true },
    options: { uid: true },
  ): AsyncIterable<FetchedMessage>;
  messageFlagsAdd(uid: string, flags: string[], options: { uid: true }): Promise<boolean>;
  append(path: string, content: Buffer, flags: string[]): Promise<{ uid?: number | undefined; uidValidity?: bigint | undefined } | false>;
  on(event: "exists" | "close" | "error", listener: (...args: unknown[]) => void): unknown;
  off(event: "exists" | "close" | "error", listener: (...args: unknown[]) => void): unknown;
  logout(): Promise<void>;
  /** Closes the connection at once, without LOGOUT. */
  close(): void;
}

/** The part of a nodemailer transport the adapter uses. */
export interface SmtpTransport {
  verify(): Promise<true>;
  sendMail(message: { envelope: Envelope; raw: Buffer }): Promise<unknown>;
  close(): void;
}

export interface ImapSmtpOptions {
  imap?: (options: ReturnType<typeof imapOptions>) => ImapClient;
  smtp?: (options: ReturnType<typeof smtpOptions>) => SmtpTransport;
  /** At most this many of the newest messages per folder are listed. Default 500. */
  maxMessages?: number;
  /** How often every folder is checked for new messages, in ms. Default 30 s. */
  pollMs?: number;
  /** Pauses between reconnection attempts, in ms (the last one repeats). */
  backoffMs?: readonly number[];
}

/** Messages fetched per UID FETCH when downloading many. */
const FETCH_BATCH = 25;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000, 60_000];

function login(config: AccountConfig): { user: string; pass: string } {
  return { user: config.username === "" ? config.address : config.username, pass: config.password };
}

export function imapOptions(config: AccountConfig) {
  return {
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.security === "tls",
    // imapflow: STARTTLS is required and login fails if the server does not offer it.
    ...(config.imap.security === "starttls" ? { doSTARTTLS: true } : {}),
    auth: login(config),
    clientInfo: { name: "Email Social" },
    // A server that does not answer is reported within a minute (the page shows the error).
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    logger: false as const,
  };
}

export function smtpOptions(config: AccountConfig) {
  return {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.security === "tls",
    requireTLS: config.smtp.security === "starttls",
    auth: login(config),
    // EHLO with an address literal (RFC 5321 §4.1.4) instead of this computer's name,
    // which would otherwise appear in the Received header of every sent message.
    name: "[127.0.0.1]",
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    logger: false,
  };
}

/** Localised names of the sent folder, for servers without SPECIAL-USE (RFC 6154). */
const SENT_NAMES = ["sent", "sent items", "sent messages", "sent mail", "inbox.sent", "odeslaná pošta", "odeslané", "gesendet", "gesendete elemente", "éléments envoyés", "envoyés"];

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** "3,5:9,12" for a sorted list of uids. */
function uidSet(uids: readonly number[]): string {
  const parts: string[] = [];
  let start = uids[0]!;
  let previous = start;
  for (const uid of [...uids.slice(1), Number.NaN]) {
    if (uid === previous + 1) {
      previous = uid;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}:${previous}`);
    start = previous = uid;
  }
  return parts.join(",");
}

function isoDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export class ImapSmtpAdapter implements MailboxAdapter {
  keepsKeywords = false;
  private client: ImapClient;
  private readonly smtp: SmtpTransport;
  private readonly makeClient: () => ImapClient;
  private readonly maxMessages: number;
  private readonly pollMs: number;
  private readonly backoffMs: readonly number[];
  private sentPath: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly watchers = new Set<{ change: () => void; status: ((s: ConnectionStatus) => void) | undefined }>();
  private closing = false;
  private online = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private lastError: string | null = null;

  constructor(
    private readonly config: AccountConfig,
    options: ImapSmtpOptions = {},
  ) {
    this.makeClient = () => options.imap?.(imapOptions(config)) ?? (new ImapFlow(imapOptions(config)) as unknown as ImapClient);
    this.client = this.makeClient();
    this.smtp = options.smtp?.(smtpOptions(config)) ?? (nodemailer.createTransport(smtpOptions(config)) as unknown as SmtpTransport);
    this.maxMessages = options.maxMessages ?? 500;
    this.pollMs = options.pollMs ?? 30_000;
    this.backoffMs = options.backoffMs ?? BACKOFF_MS;
  }

  /** Runs mailbox operations one at a time, so the selected mailbox is always known. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private withMailbox<T>(path: string, task: (box: MailboxInfo, client: ImapClient) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      if (!this.online) throw new Error(`Not connected to ${this.config.imap.host}${this.lastError === null ? "" : `: ${this.lastError}`}`);
      const client = this.client;
      const lock = await client.getMailboxLock(path);
      try {
        return await task(client.mailbox as MailboxInfo, client);
      } finally {
        lock.release();
        if (path !== "INBOX") await client.mailboxOpen("INBOX").catch(() => undefined);
      }
    });
  }

  private readonly onExists = (): void => {
    for (const watcher of this.watchers) watcher.change();
  };

  private readonly onClose = (): void => {
    if (this.closing || !this.online) return;
    this.online = false;
    this.lastError ??= "the connection was closed";
    this.status({ state: "reconnecting", error: this.lastError });
    this.scheduleReconnect();
  };

  private readonly onError = (e: unknown): void => {
    this.lastError = message(e);
  };

  private status(status: ConnectionStatus): void {
    for (const watcher of this.watchers) watcher.status?.(status);
  }

  /** With a connected client: finds the sent folder, selects INBOX and starts listening. */
  private async setUp(client: ImapClient): Promise<void> {
    const folders = await client.list();
    this.sentPath =
      folders.find((f) => f.specialUse === "\\Sent")?.path ??
      folders.find((f) => SENT_NAMES.includes(f.path.toLowerCase()))?.path ??
      null;
    if (this.sentPath === null && this.config.appendToSent) {
      await client.mailboxCreate("Sent");
      this.sentPath = "Sent";
    }
    await client.mailboxOpen("INBOX");
    // RFC 9051 §7.1: "\*" in PERMANENTFLAGS means new keywords can be stored.
    this.keepsKeywords = (client.mailbox as MailboxInfo).permanentFlags?.has("\\*") ?? false;
    client.on("exists", this.onExists);
    client.on("close", this.onClose);
    client.on("error", this.onError);
    this.client = client;
    this.online = true;
    this.lastError = null;
  }

  async open(): Promise<void> {
    const [imap, smtp] = await Promise.allSettled([this.client.connect(), this.smtp.verify()]);
    const failures = [
      imap.status === "rejected" ? `IMAP ${this.config.imap.host}: ${message(imap.reason)}` : null,
      smtp.status === "rejected" ? `SMTP ${this.config.smtp.host}: ${message(smtp.reason)}` : null,
    ].filter((f) => f !== null);
    if (failures.length > 0) {
      if (imap.status === "fulfilled") await this.client.logout().catch(() => undefined);
      this.client.close();
      this.smtp.close();
      throw new Error(failures.join("; "));
    }
    await this.setUp(this.client);
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer !== null) return;
    const delay = this.backoffMs[Math.min(this.attempt, this.backoffMs.length - 1)]!;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryReconnect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async tryReconnect(): Promise<void> {
    if (this.closing) return;
    const client = this.makeClient();
    try {
      await client.connect();
      await this.setUp(client);
      this.attempt = 0;
      this.status({ state: "online" });
      this.onExists();
    } catch (e) {
      this.lastError = message(e);
      try {
        client.close();
      } catch {
        // Already closed.
      }
      this.status({ state: "reconnecting", error: this.lastError });
      this.scheduleReconnect();
    }
  }

  /** Drops the current connection (it stopped answering) and connects again. */
  reconnect(reason: string): void {
    if (this.closing) return;
    this.lastError = reason;
    const client = this.client;
    if (this.online) {
      // The "close" event starts the reconnection.
      try {
        client.close();
      } catch {
        this.onClose();
      }
      if (this.online) this.onClose();
    }
    // Operations queued behind the silent connection fail instead of waiting for it.
    this.queue = Promise.resolve();
  }

  private folders(): [FolderRole, string][] {
    return this.sentPath === null ? [["inbox", "INBOX"]] : [["inbox", "INBOX"], ["sent", this.sentPath]];
  }

  private path(folder: FolderRole): string {
    if (folder === "inbox") return "INBOX";
    if (this.sentPath === null) throw new Error("This account has no sent folder");
    return this.sentPath;
  }

  async listSince(cursor: string | null): Promise<MailboxChanges> {
    let previous: Partial<Record<FolderRole, { v: string; n: number }>> = {};
    try {
      if (cursor !== null) previous = JSON.parse(cursor) as typeof previous;
    } catch {
      previous = {};
    }
    const next: Partial<Record<FolderRole, { v: string; n: number }>> = {};
    const entries: MailEntry[] = [];
    const complete: FolderRole[] = [];
    for (const [folder, path] of this.folders()) {
      await this.withMailbox(path, async (box, client) => {
        const v = box.uidValidity.toString();
        const seen = previous[folder];
        let range: string | null = null;
        let from = 0;
        if (seen !== undefined && seen.v === v) {
          // Always ask: while INBOX stays selected (for IDLE), the UIDNEXT known from
          // SELECT is stale, so it cannot tell whether anything arrived.
          from = seen.n;
          range = `${seen.n}:*`;
        } else {
          complete.push(folder);
          const all = await client.search({ all: true }, { uid: true });
          const uids = Array.isArray(all) ? [...all].sort((a, b) => a - b) : [];
          const newest = uids.slice(-this.maxMessages);
          if (newest.length > 0) {
            from = newest[0]!;
            range = `${from}:*`;
          }
        }
        let highest = Math.max(from - 1, 0);
        if (range !== null) {
          const found: MailEntry[] = [];
          for await (const m of client.fetch(range, { uid: true, flags: true, internalDate: true }, { uid: true })) {
            // "n:*" also matches the highest message when every uid is below n (RFC 9051 §6.4.8).
            if (m.uid < from) continue;
            highest = Math.max(highest, m.uid);
            const date = isoDate(m.internalDate);
            found.push({ folder, uid: `${v}.${m.uid}`, flags: [...(m.flags ?? [])], ...(date === undefined ? {} : { date }) });
          }
          entries.push(...found.sort((a, b) => Number(a.uid.split(".")[1]) - Number(b.uid.split(".")[1])));
        }
        next[folder] = { v, n: Math.max(highest + 1, seen?.v === v ? seen.n : 0, from) };
      });
    }
    return { entries, complete, cursor: JSON.stringify(next) };
  }

  private split(ref: MailRef): [string, string] {
    const match = /^(\d+)\.(\d+)$/.exec(ref.uid);
    if (match === null) throw new Error(`Not an IMAP uid: ${ref.uid}`);
    return [match[1]!, match[2]!];
  }

  async fetchRaw(ref: MailRef): Promise<Uint8Array> {
    let found: Uint8Array | null = null;
    await this.fetchMany([ref], (_, raw) => {
      found = raw;
    });
    if (found === null) throw new Error(`No message with UID ${this.split(ref)[1]}`);
    return found;
  }

  async fetchMany(refs: readonly MailRef[], each: (ref: MailRef, raw: Uint8Array) => void): Promise<void> {
    for (const folder of ["inbox", "sent"] as const) {
      const wanted = refs.filter((r) => r.folder === folder);
      if (wanted.length === 0) continue;
      const byUid = new Map<number, MailRef>();
      let validity: string | null = null;
      for (const ref of wanted) {
        const [v, uid] = this.split(ref);
        if (validity !== null && validity !== v) throw new Error("Messages from two UIDVALIDITY values");
        validity = v;
        byUid.set(Number(uid), ref);
      }
      const uids = [...byUid.keys()].sort((a, b) => a - b);
      for (let i = 0; i < uids.length; i += FETCH_BATCH) {
        const batch = uids.slice(i, i + FETCH_BATCH);
        // One batch per lock, so sending or flagging is not held up by a long download.
        await this.withMailbox(this.path(folder), async (box, client) => {
          if (box.uidValidity.toString() !== validity) throw new Error("The mailbox was renumbered (UIDVALIDITY changed)");
          for await (const m of client.fetch(uidSet(batch), { uid: true, source: true }, { uid: true })) {
            const ref = byUid.get(m.uid);
            if (ref !== undefined && m.source !== undefined) each(ref, new Uint8Array(m.source));
          }
        });
      }
    }
  }

  async addFlags(ref: MailRef, flags: readonly string[]): Promise<void> {
    const [v, uid] = this.split(ref);
    await this.withMailbox(this.path(ref.folder), async (box, client) => {
      if (box.uidValidity.toString() !== v) throw new Error("The mailbox was renumbered (UIDVALIDITY changed)");
      await client.messageFlagsAdd(uid, [...flags], { uid: true });
    });
  }

  async appendToSent(raw: Uint8Array): Promise<MailEntry | null> {
    const path = this.path("sent");
    const result = await this.exclusive(() => this.client.append(path, Buffer.from(raw), [SEEN]));
    // RFC 4315 (UIDPLUS) returns the new uid; without it the copy is found at the next sync.
    if (result === false || result.uid === undefined || result.uidValidity === undefined) return null;
    return { folder: "sent", uid: `${result.uidValidity}.${result.uid}`, flags: [SEEN] };
  }

  async send(raw: Uint8Array, envelope: Envelope): Promise<void> {
    await this.smtp.sendMail({ envelope, raw: Buffer.from(raw) });
  }

  watch(onChange: () => void, onStatus?: (status: ConnectionStatus) => void): () => void {
    const watcher = { change: onChange, status: onStatus };
    this.watchers.add(watcher);
    onStatus?.(this.online ? { state: "online" } : { state: "reconnecting", error: this.lastError });
    const timer = setInterval(onChange, this.pollMs);
    timer.unref?.();
    this.timers.add(timer);
    return () => {
      this.watchers.delete(watcher);
      clearInterval(timer);
      this.timers.delete(timer);
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    const client = this.client;
    client.off("exists", this.onExists);
    client.off("close", this.onClose);
    // LOGOUT politely, but never wait long for a server that stopped answering.
    const logout = this.online ? this.exclusive(() => client.logout()).catch(() => undefined) : Promise.resolve();
    await Promise.race([logout, new Promise((resolve) => setTimeout(resolve, 2000).unref?.())]);
    try {
      client.close();
    } catch {
      // Already closed.
    }
    this.online = false;
    this.smtp.close();
  }
}
