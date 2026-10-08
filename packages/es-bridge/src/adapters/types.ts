/**
 * The one interface through which the bridge reads and writes a mailbox.
 * Implementations: ImapSmtpAdapter (a real account, RFC 9051 IMAP + RFC 5321
 * SMTP) and MaildirAdapter (a directory of .eml files, for tests and offline
 * use). The bridge never stores message content anywhere else.
 */

/** The folders the bridge works with. */
export type FolderRole = "inbox" | "sent";

/** A message in the mailbox: its folder and a uid that is stable within the adapter. */
export interface MailRef {
  folder: FolderRole;
  /** Opaque and stable for the life of the message (IMAP: UIDVALIDITY.UID; Maildir: the file name). */
  uid: string;
}

/** A message with its current flags (IMAP system flags and keywords, RFC 9051 §2.3.2). */
export interface MailEntry extends MailRef {
  flags: string[];
  /** When the mailbox received it (IMAP INTERNALDATE), ISO 8601; used to load the newest first. */
  date?: string;
}

/** The connection to the mail server, for "Reconnecting…" on the page. */
export type ConnectionStatus = { state: "online" } | { state: "reconnecting"; error: string | null };

/** The IMAP \Seen flag; also used by the Maildir adapter. */
export const SEEN = "\\Seen";
/** Keywords recording that the bridge has sent a receipt for a message, so it is sent once. */
export const DELIVERED_SENT = "$EsDelivered";
export const READ_SENT = "$EsRead";

export interface MailboxChanges {
  /** Messages added since the cursor (all messages when the cursor was null or is no longer valid). */
  entries: MailEntry[];
  /** Folders whose `entries` are their complete content, so anything else in them was deleted. */
  complete: FolderRole[];
  /** Pass back to listSince to get only newer messages. */
  cursor: string;
}

/** The SMTP envelope (RFC 5321 §3.3): who the message is sent from and to. */
export interface Envelope {
  from: string;
  to: string[];
}

export interface MailboxAdapter {
  /** Connects (IMAP login, SMTP check) or prepares the directories. */
  open(): Promise<void>;
  /** Messages in the inbox and the sent folder added since `cursor` (null: all). */
  listSince(cursor: string | null): Promise<MailboxChanges>;
  /** The raw RFC 5322 bytes of a message. */
  fetchRaw(ref: MailRef): Promise<Uint8Array>;
  /** The raw bytes of several messages, handed to `each` one by one as they arrive (in any order). */
  fetchMany(refs: readonly MailRef[], each: (ref: MailRef, raw: Uint8Array) => void): Promise<void>;
  /** Adds flags or keywords to a message (IMAP STORE +FLAGS, RFC 9051 §6.4.6). */
  addFlags(ref: MailRef, flags: readonly string[]): Promise<void>;
  /**
   * Stores a copy of a sent message in the sent folder, marked \Seen. Returns
   * null when the stored copy's uid is not known (IMAP without UIDPLUS,
   * RFC 4315); the copy then shows up at the next sync.
   */
  appendToSent(raw: Uint8Array): Promise<MailEntry | null>;
  /** Sends a message to the envelope recipients. */
  send(raw: Uint8Array, envelope: Envelope): Promise<void>;
  /**
   * Calls `onChange` when the mailbox may have changed (new mail, and after
   * a lost connection is back) and `onStatus` when the connection is lost or
   * restored; returns a function that stops watching.
   */
  watch(onChange: () => void, onStatus?: (status: ConnectionStatus) => void): () => void;
  /** Drops a connection that stopped answering and connects again (IMAP); nothing for local folders. */
  reconnect(reason: string): void;
  /** Whether keywords such as $EsRead are kept by the mailbox (IMAP PERMANENTFLAGS with \*). */
  readonly keepsKeywords: boolean;
  close(): Promise<void>;
}
