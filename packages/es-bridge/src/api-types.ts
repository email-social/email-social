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
  | { state: "signed-out"; error: string | null; presets: ProviderPreset[]; keychain: boolean }
  | { state: "connecting"; address: string }
  | { state: "ready"; account: Person; mode: "imap" | "maildir"; remembered: boolean };

export interface Person {
  address: string;
  /** Display name; the address when no name is known. */
  name: string;
}

export interface ConversationSummary {
  id: string;
  /** Names of the other participants. */
  title: string;
  subject: string;
  /** Everyone in the conversation except the account itself. */
  participants: Person[];
  /** More than one other participant ("many recipients"). */
  group: boolean;
  /** The first line of the newest message, without quoted text. */
  lastLine: string;
  lastDate: string | null;
  lastFromMe: boolean;
  /** Incoming messages without the \Seen flag. */
  unread: number;
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
  text: string;
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

export interface ThreadView {
  conversation: ConversationSummary;
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

export interface SendRequest {
  text: string;
}

/** Pushed over the WebSocket /api/events. */
export type ServerEvent = { type: "session" } | { type: "changed" };
