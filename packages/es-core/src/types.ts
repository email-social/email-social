/**
 * Public data model of es-core. Every type here is plain, JSON-serialisable
 * data (no Date objects, no class instances), so parsed messages can be
 * stored as test vectors and passed between processes unchanged.
 */

/** A mailbox (RFC 5322 §3.4): display name plus canonical address. */
export interface EsAddress {
  /** Decoded display name (RFC 2047 words decoded, quotes removed); "" when absent. */
  name: string;
  /**
   * Canonical address: the local part exactly as written, the domain
   * lowercased (see `canonicalAddress`). Always contains "@": list entries
   * without one (e.g. an empty group "undisclosed-recipients:;") are dropped.
   */
  address: string;
}

/** Message-ID, In-Reply-To and References (RFC 5322 §3.6.4). */
export interface EsRefs {
  /** The message's own Message-ID in angle brackets, or null when absent. */
  messageId: string | null;
  /** Every msg-id found in In-Reply-To, in order, in angle brackets. */
  inReplyTo: string[];
  /** Every msg-id found in References, in order, duplicates removed, in angle brackets. */
  references: string[];
}

/** Metadata of a MIME leaf part that is not body text. Content is never included. */
export interface EsAttachment {
  /** Decoded filename (RFC 2231 / RFC 2047 / raw UTF-8), or null when none is given. */
  filename: string | null;
  /** Lowercased media type, e.g. "application/pdf". */
  contentType: string;
  /** From Content-Disposition (RFC 2183); parts without the header count as "attachment" unless they carry a Content-ID. */
  disposition: "attachment" | "inline";
  /** Size in bytes after removing the Content-Transfer-Encoding. */
  size: number;
  /** Content-ID in angle brackets, or null. */
  contentId: string | null;
  /** IMAP-style part number (RFC 9051 §6.4.5), e.g. "2" or "1.2". */
  partId: string;
}

/** Receipt kinds carried in the ES part. */
export type ReceiptKind = "delivered" | "read";

/** The `email` object of an es.social.post record (spec 2.3.1). */
export interface EsEmailMeta {
  messageId: string | null;
  subject: string | null;
  inReplyTo: string | null;
  references: string[];
  /**
   * Lowercase hex SHA-256 of the UTF-8 text (with "\n" line endings), written
   * instead of `text` when the text is longer than ES_TEXT_MAX_BYTES; null
   * otherwise. It ties the record to the text/plain body of the message.
   */
  textSha256: string | null;
}

/** A direct message: the parsed `es.social.post` record (spec 2.3.1, direct-message subset). */
export interface EsPostPart {
  $type: "es.social.post";
  /** Author DID (`did:es:…`, metadata only), or null when absent or malformed. */
  author: string | null;
  /**
   * The message text, or null when the sender left it out because it is
   * longer than ES_TEXT_MAX_BYTES (then `email.textSha256` is set and the
   * text is only in the text/plain part, i.e. `EsMessage.text`).
   */
  text: string | null;
  /** Canonical sending address. */
  via: string;
  /** RFC 3339 timestamp as written by the sender. */
  createdAt: string;
  email: EsEmailMeta;
  /** Receipts the sender asks for; [] when none. Always in the order ["delivered", "read"]. */
  requestReceipts: ReceiptKind[];
}

/** A receipt: the parsed `es.social.receipt` record. */
export interface EsReceiptPart {
  $type: "es.social.receipt";
  author: string | null;
  kind: ReceiptKind;
  /** Message-ID (angle brackets) of the message this receipt is about. */
  messageId: string;
  /** Canonical address of the account sending the receipt. */
  via: string;
  createdAt: string;
}

/** The structured ES part of a message. */
export type EsPart = EsPostPart | EsReceiptPart;

/** The decoded content of one MIME leaf part (see `extractPart`). */
export interface EsPartContent {
  /** Lowercased media type, as in EsAttachment.contentType. */
  contentType: string;
  /** As in EsAttachment.filename. */
  filename: string | null;
  /** The content with its Content-Transfer-Encoding removed. */
  bytes: Uint8Array;
}

/** Where `EsMessage.text` came from. */
export type TextSource = "plain" | "html" | "none";

/**
 * Header fields that tell mail sent to a list or by a program from mail a
 * person wrote (see `classifyMessage`). Values are lowercased.
 */
export interface EsDelivery {
  /** Names of the RFC 2369 / RFC 2919 list fields present ("list-id", "list-unsubscribe", …), sorted, each once. */
  listHeaders: string[];
  /** The List-Id identifier (RFC 2919 §2) without angle brackets, or null. */
  listId: string | null;
  /** The Auto-Submitted keyword (RFC 3834 §5) without parameters or comments, or null when absent. */
  autoSubmitted: string | null;
  /** The Precedence value ("bulk", "list", "junk", …), or null when absent. */
  precedence: string | null;
  /** The Return-Path address (RFC 5322 §3.6.7) in canonical form; "" for the null path "<>"; null when absent. */
  returnPath: string | null;
}

/** A parsed e-mail message, as Email Social sees it. */
export interface EsMessage {
  /** refs.messageId when present, otherwise "sha256:" + hex SHA-256 of the raw bytes. */
  id: string;
  /** First mailbox of From, or null. */
  from: EsAddress | null;
  to: EsAddress[];
  cc: EsAddress[];
  replyTo: EsAddress[];
  /** Date header as an ISO 8601 UTC string (millisecond precision), or null when absent/unparseable. */
  date: string | null;
  /** Decoded Subject; "" when absent. */
  subject: string;
  /** Decoded body text with "\n" line endings (text/plain; HTML reduced to text only when no text/plain exists). */
  text: string;
  textSource: TextSource;
  /** Parsed ES part, or null when absent, malformed, or not belonging to this message. */
  es: EsPart | null;
  attachments: EsAttachment[];
  refs: EsRefs;
  delivery: EsDelivery;
}

/** A conversation: messages grouped by the threading algorithm. */
export interface Conversation {
  /** "conv-" + first 32 hex digits of SHA-256(UTF-8(rootMessageId)). */
  id: string;
  /** The root Message-ID (or synthetic "sha256:" id) the id was derived from. */
  rootMessageId: string;
  /** Base subject (prefixes and list tags removed) of the earliest message that has one; "". */
  subject: string;
  /** Union of From/To/Cc of all messages, sorted by address. */
  participants: EsAddress[];
  /** EsMessage.id values in chronological order. */
  messageIds: string[];
  firstDate: string | null;
  lastDate: string | null;
}

/** A message's text split by `splitQuoted`; every line of the text is in exactly one part. */
export interface QuotedSplit {
  /** What the sender wrote in this message (blank lines at the edges removed). */
  fresh: string;
  /** Earlier messages quoted by the sender's client: ">" lines with their attribution, Outlook header blocks and what follows. */
  quoted: string;
  /** The signature, from its "-- " delimiter, or a mobile client's one-line signature. */
  signature: string;
}

/** The quote card above a message (see `replyContextOf`). */
export type ReplyContext =
  | {
      kind: "parent";
      /** EsMessage.id of the message answered. */
      messageId: string;
      /** Its sender's display name, else address; "" when it has no sender. */
      from: string;
      /** The first two lines of what its sender wrote, at most 140 characters ("…" when cut). */
      excerpt: string;
      /** The file name of its first attachment, or null. */
      attachment: string | null;
    }
  | {
      kind: "subject";
      /** The base subject (no Re:/Fwd: prefixes or list tags). */
      subject: string;
    };

/** What a topic is called (see `topicsOf`). */
export type TopicKind =
  /** An Email Social user gave it a name (`email.topicLabel`). */
  | "named"
  /** No name; its root is an Email Social message or carries the carrier subject ("Message from …"). */
  | "carrier"
  /** Started by a fresh mail from any client; its subject is the root's base subject. */
  | "plain";

/** A thread inside a chat, identified by the Message-ID (EsMessage.id) of its root, never by its subject. */
export interface Topic {
  /** EsMessage.id of the root message. */
  rootId: string;
  /** The `email.topicLabel` of the oldest message of the topic that carries one, else null. */
  label: string | null;
  /** The root's base subject (`normalizeSubject`); "" when it has none. */
  base: string;
  kind: TopicKind;
  /** Number of messages in the topic. */
  count: number;
}

/** The topics of one chat (see `topicsOf`). */
export interface ChatTopics {
  /** In the order their roots appear. */
  topics: Topic[];
  /**
   * Where each message was placed, by EsMessage.id: its topic's root, and
   * whether it starts a run (the previous message belongs to another topic;
   * true for the first).
   */
  of: Record<string, { rootId: string; topicStart: boolean }>;
}

/** Who a message comes from (see `classifyMessage`). */
export type MessageKind = "person" | "list" | "automated";

/** One message of a chat, with its base subject. */
export interface ChatEntry {
  /** EsMessage.id. */
  id: string;
  /** Base subject of the message (see `normalizeSubject`); "" when it has none. Topics (`topicsOf`) are identified by their root, not by this. */
  subject: string;
}

/** A chat: every message exchanged with exactly one set of people (see `groupByParticipants`). */
export interface Chat {
  /** "chat-" + first 32 hex digits of SHA-256 over the participants' canonical addresses, sorted and joined with "\n". */
  id: string;
  /** Everyone in From, To and Cc except the account owner, sorted by address; [] for messages to oneself. */
  participants: EsAddress[];
  /** The messages, oldest first (undated last). */
  messages: ChatEntry[];
  firstDate: string | null;
  lastDate: string | null;
}

/** A contact derived from the addresses seen in messages. */
export interface Contact {
  /** Canonical address (identity of the contact). */
  address: string;
  /** Preferred display name ("" when none was ever seen). */
  name: string;
  /** Every distinct display name seen, most recent first. */
  names: string[];
  /** Date of the latest dated message mentioning the address, or null. */
  lastSeen: string | null;
  /** Number of distinct messages mentioning the address in From, To or Cc. */
  count: number;
}

/** The message a reply answers (RFC 5322 §3.6.4). */
export interface ReplyTarget {
  messageId: string;
  /** The parent's References (or its single In-Reply-To when it has no References). */
  references?: string[];
  /** The parent's subject, used for the default "Re: " subject. */
  subject?: string;
}

/** A message to send. */
export interface EsOutgoing {
  from: EsAddress;
  to: EsAddress[];
  cc?: EsAddress[];
  /** Defaults to "Re: " + inReplyTo.subject for replies, else "". */
  subject?: string;
  text: string;
  inReplyTo?: ReplyTarget;
  /** Optional ES fields. */
  es?: {
    requestReceipts?: ReceiptKind[];
    /** A did:es identifier to put in the ES part as metadata. */
    author?: string;
  };
}

/** A receipt to send back to the author of `original`. */
export interface EsOutgoingReceipt {
  kind: ReceiptKind;
  /** The account sending the receipt. */
  from: EsAddress;
  /** The author of the original message. */
  to: EsAddress;
  original: ReplyTarget;
  author?: string;
}

/** Injected values that make serialisation deterministic (no clock, no randomness inside es-core). */
export interface SerializeOptions {
  /** Date header and createdAt, as a Date or an ISO 8601 string. */
  date: Date | string;
  /** The new message's Message-ID, in angle brackets: "<left@right>". */
  messageId: string;
  /**
   * Whether to attach the ES part (default true). False writes a plain
   * single-part text/plain message, e.g. for a recipient who has never sent
   * an ES part; the ES fields of EsOutgoing (requestReceipts, author) are then
   * not sent. Receipts ignore it: they always carry their ES part.
   */
  includeEsPart?: boolean;
}
