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
 *   (RFC 2177) and report new mail at once.
 */

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { AccountConfig } from "../credentials.js";
import { SEEN, type Envelope, type FolderRole, type MailboxAdapter, type MailboxChanges, type MailEntry, type MailRef } from "./types.js";

interface MailboxInfo {
  path: string;
  uidValidity: bigint;
  uidNext: number;
  permanentFlags?: Set<string> | undefined;
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
  fetch(range: string, query: { uid: true; flags: true }, options: { uid: true }): AsyncIterable<{ uid: number; flags?: Set<string> | undefined }>;
  fetchOne(uid: string, query: { source: true }, options: { uid: true }): Promise<{ uid: number; source?: Buffer | undefined } | false | undefined>;
  messageFlagsAdd(uid: string, flags: string[], options: { uid: true }): Promise<boolean>;
  append(path: string, content: Buffer, flags: string[]): Promise<{ uid?: number | undefined; uidValidity?: bigint | undefined } | false>;
  on(event: "exists", listener: () => void): unknown;
  off(event: "exists", listener: () => void): unknown;
  logout(): Promise<void>;
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
  /** A safety-net check for changes IDLE does not report (e.g. the sent folder), in ms. Default 60 s. */
  pollMs?: number;
}

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
    logger: false,
  };
}

/** Localised names of the sent folder, for servers without SPECIAL-USE (RFC 6154). */
const SENT_NAMES = ["sent", "sent items", "sent messages", "sent mail", "inbox.sent", "odeslaná pošta", "odeslané", "gesendet", "gesendete elemente", "éléments envoyés", "envoyés"];

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class ImapSmtpAdapter implements MailboxAdapter {
  keepsKeywords = false;
  private readonly client: ImapClient;
  private readonly smtp: SmtpTransport;
  private readonly maxMessages: number;
  private readonly pollMs: number;
  private sentPath: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly timers = new Set<ReturnType<typeof setInterval>>();

  constructor(
    private readonly config: AccountConfig,
    options: ImapSmtpOptions = {},
  ) {
    this.client = options.imap?.(imapOptions(config)) ?? (new ImapFlow(imapOptions(config)) as unknown as ImapClient);
    this.smtp = options.smtp?.(smtpOptions(config)) ?? (nodemailer.createTransport(smtpOptions(config)) as unknown as SmtpTransport);
    this.maxMessages = options.maxMessages ?? 500;
    this.pollMs = options.pollMs ?? 60_000;
  }

  /** Runs mailbox operations one at a time, so the selected mailbox is always known. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private withMailbox<T>(path: string, task: (box: MailboxInfo) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const lock = await this.client.getMailboxLock(path);
      try {
        return await task(this.client.mailbox as MailboxInfo);
      } finally {
        lock.release();
        if (path !== "INBOX") await this.client.mailboxOpen("INBOX").catch(() => undefined);
      }
    });
  }

  async open(): Promise<void> {
    const [imap, smtp] = await Promise.allSettled([this.client.connect(), this.smtp.verify()]);
    const failures = [
      imap.status === "rejected" ? `IMAP ${this.config.imap.host}: ${message(imap.reason)}` : null,
      smtp.status === "rejected" ? `SMTP ${this.config.smtp.host}: ${message(smtp.reason)}` : null,
    ].filter((f) => f !== null);
    if (failures.length > 0) {
      if (imap.status === "fulfilled") await this.client.logout().catch(() => undefined);
      this.smtp.close();
      throw new Error(failures.join("; "));
    }
    const folders = await this.client.list();
    this.sentPath =
      folders.find((f) => f.specialUse === "\\Sent")?.path ??
      folders.find((f) => SENT_NAMES.includes(f.path.toLowerCase()))?.path ??
      null;
    if (this.sentPath === null && this.config.appendToSent) {
      await this.client.mailboxCreate("Sent");
      this.sentPath = "Sent";
    }
    await this.client.mailboxOpen("INBOX");
    // RFC 9051 §7.1: "\*" in PERMANENTFLAGS means new keywords can be stored.
    this.keepsKeywords = (this.client.mailbox as MailboxInfo).permanentFlags?.has("\\*") ?? false;
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
      await this.withMailbox(path, async (box) => {
        const v = box.uidValidity.toString();
        const seen = previous[folder];
        let range: string | null = null;
        let from = 0;
        if (seen !== undefined && seen.v === v) {
          from = seen.n;
          if (box.uidNext > seen.n) range = `${seen.n}:*`;
        } else {
          complete.push(folder);
          const all = await this.client.search({ all: true }, { uid: true });
          const uids = Array.isArray(all) ? [...all].sort((a, b) => a - b) : [];
          const newest = uids.slice(-this.maxMessages);
          if (newest.length > 0) {
            from = newest[0]!;
            range = `${from}:*`;
          }
        }
        if (range !== null) {
          const found: MailEntry[] = [];
          for await (const m of this.client.fetch(range, { uid: true, flags: true }, { uid: true })) {
            // "n:*" also matches the highest message when every uid is below n (RFC 9051 §6.4.8).
            if (m.uid >= from) found.push({ folder, uid: `${v}.${m.uid}`, flags: [...(m.flags ?? [])] });
          }
          entries.push(...found.sort((a, b) => Number(a.uid.split(".")[1]) - Number(b.uid.split(".")[1])));
        }
        next[folder] = { v, n: box.uidNext };
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
    const [v, uid] = this.split(ref);
    return this.withMailbox(this.path(ref.folder), async (box) => {
      if (box.uidValidity.toString() !== v) throw new Error("The mailbox was renumbered (UIDVALIDITY changed)");
      const found = await this.client.fetchOne(uid, { source: true }, { uid: true });
      if (found === false || found === undefined || found.source === undefined) throw new Error(`No message with UID ${uid}`);
      return new Uint8Array(found.source);
    });
  }

  async addFlags(ref: MailRef, flags: readonly string[]): Promise<void> {
    const [v, uid] = this.split(ref);
    await this.withMailbox(this.path(ref.folder), async (box) => {
      if (box.uidValidity.toString() !== v) throw new Error("The mailbox was renumbered (UIDVALIDITY changed)");
      await this.client.messageFlagsAdd(uid, [...flags], { uid: true });
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

  watch(onChange: () => void): () => void {
    const listener = (): void => onChange();
    this.client.on("exists", listener);
    const timer = setInterval(onChange, this.pollMs);
    this.timers.add(timer);
    return () => {
      this.client.off("exists", listener);
      clearInterval(timer);
      this.timers.delete(timer);
    };
  }

  async close(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    await this.exclusive(() => this.client.logout()).catch(() => undefined);
    this.smtp.close();
  }
}
