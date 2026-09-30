/**
 * The JSON shapes of the local API (served on 127.0.0.1 to the web client
 * only). Shared with packages/es-web as types; no runtime code here.
 */

export type Security = "tls" | "starttls";

export interface ServerSettings {
  host: string;
  port: number;
  /** "tls": TLS from the first byte (IMAP 993, SMTP 465); "starttls": STARTTLS required before login (143, 587). */
  security: Security;
}

export interface ProviderPreset {
  id: string;
  label: string;
  imap: ServerSettings;
  smtp: ServerSettings;
  /** False when the provider already keeps a copy of mail sent through its SMTP server. */
  appendToSent: boolean;
  /** One sentence on the password to use (app passwords). */
  hint: string;
}

export interface LoginRequest {
  address: string;
  name?: string;
  /** The login name when it is not the address. */
  username?: string;
  password: string;
  imap: ServerSettings;
  smtp: ServerSettings;
  appendToSent?: boolean;
  /** Keep the settings and password in the OS keychain for the next start. */
  remember: boolean;
}

export type SessionInfo =
  | {
      state: "signed-out";
      error: string | null;
      presets: ProviderPreset[];
      keychain: boolean;
      /** The last sign-in can be tried again (POST /api/retry) with the settings the bridge still holds in memory. */
      canRetry: boolean;
    }
  | { state: "connecting"; address: string; progress: StartProgress }
  | { state: "ready"; account: Person; mode: "imap" | "maildir"; remembered: boolean; sync: SyncStatus };

/** What a sign-in is doing, so the page can show a number that changes. */
export interface StartProgress {
  step: "connecting" | "listing" | "loading";
  /** Messages downloaded so far. */
  loaded: number;
  /** Messages to download, once known. */
  total: number | null;
}

/** The state of the mailbox after sign-in. */
export interface SyncStatus {
  /** Older messages still being downloaded in the background; null when all are there. */
  loading: { loaded: number; total: number } | null;
  /** "reconnecting" while a lost connection to the mail server is being re-established. */
  connection: "online" | "reconnecting";
  /** Why loading or checking for new mail stopped; the page offers "Try again" (POST /api/retry). */
  error: string | null;
}

export interface Person {
  address: string;
  /** Display name; the address when no name is known. */
  name: string;
}

/** A chat: everything exchanged with one set of people, whatever the subjects. */
export interface ChatSummary {
  id: string;
  /** Names of the other participants ("You" for messages to yourself). */
  title: string;
  /** Everyone in the chat except the account itself. */
  participants: Person[];
  /** More than one other participant ("many recipients"). */
  group: boolean;
  /** The first line of what the newest message's sender wrote (no quoted text, no signature). */
  lastLine: string;
  lastDate: string | null;
  lastFromMe: boolean;
  /** Incoming messages without the \Seen flag. */
  unread: number;
  /** Someone in the chat has sent an Email Social message: replies carry the ES part and quote nothing. */
  emailSocial: boolean;
}

export interface AttachmentView {
  partId: string;
  filename: string;
  contentType: string;
  size: number;
  /** Download path under /api (the client adds its token). */
  path: string;
}

export interface MessageView {
  /** The bridge's key for the message (folder and uid), used in paths. */
  key: string;
  from: Person | null;
  mine: boolean;
  date: string | null;
  /** Base subject (no "Re:"/"AW:"), for the separator shown where the subject changes. */
  subject: string;
  /** The whole text. */
  text: string;
  /** What the sender wrote in this message (splitQuoted). */
  fresh: string;
  /** Earlier messages the sender's client quoted; "" when none. */
  quoted: string;
  /** The sender's signature; "" when none. */
  signature: string;
  /** "html": the message had no text/plain part and its HTML was reduced to text. */
  textSource: "plain" | "html" | "none";
  attachments: AttachmentView[];
  /** Download path of the original .eml. */
  originalPath: string;
  /** For the account's own messages: what receipts say about them. */
  status: "sent" | "delivered" | "read" | null;
  /** The message carried an Email Social part. */
  emailSocial: boolean;
}

export interface ChatView {
  chat: ChatSummary;
  /** Oldest first. */
  messages: MessageView[];
}

/** A sender under "Other mail": a mailing list, a newsletter or a program. Read-only. */
export interface OtherSummary {
  id: string;
  kind: "list" | "automated";
  /** List identifier or sender name. */
  title: string;
  /** The list or sender address. */
  address: string;
  count: number;
  unread: number;
  lastLine: string;
  lastDate: string | null;
}

export interface OtherView {
  sender: OtherSummary;
  messages: MessageView[];
}

export interface ContactView {
  address: string;
  name: string;
  lastSeen: string | null;
  count: number;
  /** This contact has sent at least one message with an Email Social part. */
  emailSocial: boolean;
}

export interface ContactAttachment extends AttachmentView {
  /** Date of the message it came with. */
  date: string | null;
  /** Sent by the account (true) or received from the contact (false). */
  fromMe: boolean;
}

/** Everything about one person (GET /api/contacts/:address). */
export interface ContactDetail {
  address: string;
  name: string;
  /** Every display name seen for the address, most recent first. */
  names: string[];
  firstDate: string | null;
  lastDate: string | null;
  /** Messages in which the address is the sender or a recipient. */
  count: number;
  emailSocial: boolean;
  /** The one-to-one chat, when there is one. */
  chatId: string | null;
  attachments: ContactAttachment[];
  /** Chats with more people that include this contact. */
  groups: ChatSummary[];
}

/** POST /api/messages: a reply in a chat (chatId), or a new chat (to). */
export interface SendRequest {
  chatId?: string;
  /** Recipient addresses of a new chat; several make a group. */
  to?: string[];
  /** Optional; a new chat without one takes the first line of the text, cut at 60 characters. */
  subject?: string;
  text: string;
}

export interface SendResult {
  chatId: string;
  message: MessageView;
}

/** Pushed over the WebSocket /api/events: "session" (sign-in state, loading, connection) or "changed" (mail). */
export type ServerEvent = { type: "session" } | { type: "changed" };
