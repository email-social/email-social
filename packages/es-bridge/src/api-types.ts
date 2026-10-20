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

/**
 * The quote card above a deliberate reply (es-core replyCardOf), plus whether
 * the answered message is the account's own.
 */
export interface ReplyCardView {
  /** MessageView.id of the answered message when the mailbox holds it, else null. */
  messageId: string | null;
  from: string;
  fromMe: boolean;
  /** What the card quotes of it, at most 140 characters. */
  excerpt: string;
  /** The file name of its first attachment, or null. */
  attachment: string | null;
  /** The answered message is a bubble of this chat, so pressing the card can show it. */
  clickable: boolean;
}

/** A thread inside a chat (es-core topicsOf), identified by its root message. */
export interface TopicView {
  /** MessageView.id of the root message. */
  rootId: string;
  /** The name an Email Social user gave it, or null. */
  label: string | null;
  /** The root's base subject; "" when it has none. */
  base: string;
  /** "named": it has a label; "carrier": the implicit topic of an Email Social chat ("Ongoing chat"); "plain": started by a mail with its own subject. */
  kind: "named" | "carrier" | "plain";
  /** Messages in the topic. */
  count: number;
}

export interface MessageView {
  /** The bridge's key for the message (folder and uid), used in paths. */
  key: string;
  /** The message's identity (its Message-ID), as quote cards name it. */
  id: string;
  from: Person | null;
  mine: boolean;
  date: string | null;
  /** The base subject (no "Re:"/"AW:"). Topics are identified by their root, not by this. */
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
  /** The topic the message belongs to; null outside a chat (Other mail, contact page) and for Auto-Submitted mail. */
  topic: Pick<TopicView, "rootId" | "label" | "kind"> | null;
  /** The previous message of the chat belongs to another topic (true for the first); false outside a chat. */
  topicStart: boolean;
  /** The card above a deliberate reply; null for a continuation and outside a chat. */
  replyCard: ReplyCardView | null;
  /** A plain message whose subject differs from its topic's (a gateway tag, a renamed reply): its base subject, shown as one small line; else null. */
  subjectNote: string | null;
  /** Answered point by point (es-core isInterleaved): the bubble shows its ">" lines muted, in place. False outside a chat. */
  interleaved: boolean;
}

export interface ChatView {
  chat: ChatSummary;
  /** Oldest first. */
  messages: MessageView[];
  /** The chat's topics, in the order their roots appear. */
  topics: TopicView[];
  /** The topic the composer is bound to when the chat is opened: that of the account's own newest message, else the newest topic. */
  composerTopic: string | null;
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

/**
 * POST /api/messages: a message in a chat (chatId), or the first message to
 * a set of people (to). Without replyTo it continues a topic; with it, it is
 * a deliberate reply to that message.
 */
export interface SendRequest {
  chatId?: string;
  /** Recipient addresses of a new chat; several make a group. */
  to?: string[];
  /** MessageView.id of the message of this chat being answered (a Message-ID, or the "sha256:…" id of a message without one). */
  replyTo?: string;
  /** The topic to write in: an existing one by its root, or one by name (re-entered when it exists, else started). A new chat takes a name only. */
  topic?: { root: string } | { label: string };
  text: string;
}

export interface SendResult {
  chatId: string;
  message: MessageView;
}

/** Pushed over the WebSocket /api/events: "session" (sign-in state, loading, connection) or "changed" (mail). */
export type ServerEvent = { type: "session" } | { type: "changed" };
