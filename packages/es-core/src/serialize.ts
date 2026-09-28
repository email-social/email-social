/**
 * Writing messages and receipts as raw RFC 5322 / MIME text.
 *
 * Layout (rule 1 of the repository: plain e-mail always works):
 *
 *   multipart/mixed                       (never multipart/alternative)
 *   ├── text/plain; charset=utf-8         the full text, 7bit or quoted-printable
 *   └── application/vnd.email-social.message+json
 *                                         the ES record, base64, as a named attachment
 *
 * Output uses CRLF line endings and 7-bit ASCII only, so it passes any SMTP
 * server unchanged (RFC 5321 §2.4, no 8BITMIME or SMTPUTF8 needed). Nothing
 * here reads a clock or a random source: the date and Message-ID come from
 * the caller, and the same input always gives the same bytes.
 */

import { base64Encode } from "./codec/base64.js";
import { encodeHeaderValue } from "./codec/encoded-word.js";
import { qpEncodeText } from "./codec/quoted-printable.js";
import { isValidDid } from "./did.js";
import { formatAddress, formatAddressList, parseAddressList } from "./headers/address.js";
import { canonicalAddress, splitAddress } from "./headers/canonical.js";
import { formatDate } from "./headers/date.js";
import { isValidMessageId } from "./headers/message-id.js";
import {
  ES_MEDIA_TYPE,
  ES_PART_FILENAME,
  ES_POST_TYPE,
  ES_RECEIPT_TYPE,
  ES_SUBJECT_MAX_BYTES,
  ES_TEXT_MAX_BYTES,
  formatEsJson,
  isRfc3339DateTime,
} from "./es/schema.js";
import { utf8Encode } from "./util/bytes.js";
import { sha256Hex } from "./util/sha256.js";
import type {
  EsAddress,
  EsMessage,
  EsOutgoing,
  EsOutgoingReceipt,
  EsPart,
  EsPostPart,
  EsReceiptPart,
  ReceiptKind,
  ReplyTarget,
  SerializeOptions,
} from "./types.js";

const CRLF = "\r\n";
/** Recommended line length limit without CRLF (RFC 5322 §2.1.1). */
const MAX_LINE = 78;
/** Hard line length limit without CRLF (RFC 5322 §2.1.1); an id must fit on an "In-Reply-To: " line. */
const MAX_ID_LENGTH = 998 - "In-Reply-To: ".length;
/** RFC 5321 §4.5.3.1.3: a path holds at most 256 octets, "<" and ">" included. */
const MAX_ADDRESS_LENGTH = 254;
/** RFC 5537 §3.4.4 style trimming of a long References chain: the root and the 19 most recent ids. */
const MAX_REFERENCES = 20;
/** RFC 2045 §2.7 / §6.7: 7bit lines kept to the quoted-printable limit, so both encodings look alike. */
const MAX_7BIT_LINE = 76;

const RECEIPT_KINDS: readonly ReceiptKind[] = ["delivered", "read"];
const PREAMBLE = "This is a multi-part message in MIME format.";

/** A msg-id in angle brackets that can be written as it is: printable ASCII, no white space, no "<" or ">" inside. */
const WRITABLE_ID = /^<[\x21-\x3b\x3d\x3f-\x7e]+>$/;

/**
 * addr-spec (RFC 5322 §3.4.1) in printable ASCII: a local part of atext and
 * dots (dot placement is not checked, obs-local-part §4.4, as such addresses
 * exist) or a quoted-string, "@", a domain of atext and dots or a domain
 * literal. Non-ASCII addresses (RFC 6532) would need SMTPUTF8 and are refused.
 */
const ATEXT = "A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~";
const LOCAL_PART = `(?:[${ATEXT}.]+|"(?:[\\x20\\x21\\x23-\\x5b\\x5d-\\x7e]|\\\\[\\x20-\\x7e])*")`;
const DOMAIN = `(?:[${ATEXT}.]+|\\[[\\x21-\\x5a\\x5e-\\x7e]*\\])`;
const ADDR_SPEC = new RegExp(`^${LOCAL_PART}@${DOMAIN}$`);

// ---------------------------------------------------------------------------
// Input checks

function checkMessageId(id: unknown): string {
  if (typeof id !== "string" || !isValidMessageId(id) || id.length > MAX_ID_LENGTH) {
    throw new TypeError(`Not a valid Message-ID (expected "<left@right>" in printable ASCII): ${JSON.stringify(id)}`);
  }
  return id;
}

/** The id of the message being answered; any writable msg-id is accepted (old mailers wrote ids without "@"). */
function checkParentId(id: unknown): string {
  if (typeof id !== "string" || !WRITABLE_ID.test(id) || id.length > MAX_ID_LENGTH) {
    throw new TypeError(`The message being answered has no usable Message-ID: ${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * The date as a whole second: the Date header (RFC 5322 §3.3) has no
 * fractions, and createdAt must name the same instant. Strings must carry an
 * explicit zone ("Z" or "+hh:mm", RFC 3339), because a string without one is
 * read in the local time zone of the machine.
 */
function checkDate(value: unknown): Date {
  let time = Number.NaN;
  if (value instanceof Date) time = value.getTime();
  else if (typeof value === "string" && isRfc3339DateTime(value)) time = Date.parse(value);
  if (Number.isNaN(time)) throw new TypeError(`Not a valid date (expected a Date or an RFC 3339 string): ${String(value)}`);
  const date = new Date(Math.floor(time / 1000) * 1000);
  const year = date.getUTCFullYear();
  // RFC 5322 §3.3: four-digit years from 1900.
  if (year < 1900 || year > 9999) throw new TypeError(`Date out of range for an e-mail header: ${date.toISOString()}`);
  return date;
}

/** A mailbox with its address in canonical form (domain lowercased), after checking it can be written and read back. */
function checkMailbox(mailbox: unknown, role: string): EsAddress {
  const input = mailbox as Partial<EsAddress> | null | undefined;
  const raw = input?.address;
  const address = typeof raw === "string" ? canonicalAddress(raw) : "";
  const valid =
    splitAddress(address) !== null &&
    address.length <= MAX_ADDRESS_LENGTH &&
    ADDR_SPEC.test(address) &&
    // Belt and braces: the written form must read back as the same address.
    parseAddressList(formatAddress({ name: "", address }))[0]?.address === address;
  if (!valid) throw new TypeError(`Not a usable e-mail address in ${role}: ${JSON.stringify(raw)}`);
  return { name: typeof input?.name === "string" ? input.name : "", address };
}

function checkAuthor(author: unknown): string | null {
  if (author === undefined || author === null) return null;
  if (typeof author !== "string" || !isValidDid(author)) {
    throw new TypeError(`Not a valid did:es identifier: ${JSON.stringify(author)}`);
  }
  return author;
}

/**
 * A lone UTF-16 surrogate has no UTF-8 form; UTF-8 encoding turns it into
 * U+FFFD. Doing it up front keeps the text part and the JSON record (where
 * JSON.stringify would keep it as an escape such as \ud800) identical.
 */
function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

/** The model's line ending is "\n"; CRLF and lone CR are converted, nothing else changes (apart from lone surrogates). */
function normalizeText(text: unknown): string {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  return wellFormed(text.replace(/\r\n?/g, "\n"));
}

/**
 * Subjects are written with white space runs (any \s, NBSP included)
 * collapsed to one space and trimmed. parseMessage collapses them the same
 * way while other readers keep them, so only a collapsed subject reads back
 * identically everywhere, and the ES record holds that same string.
 */
function normalizeSubject(subject: string): string {
  return wellFormed(subject.replace(/\s+/g, " ").trim());
}

/** RFC 5322 §3.6.5: a reply's subject is the original's with "Re: " in front, added only once. */
function replySubject(subject: string): string {
  const base = normalizeSubject(subject);
  return /^re:/i.test(base) ? base : normalizeSubject("Re: " + base);
}

function normalizeReceiptKinds(kinds: readonly ReceiptKind[] | undefined): ReceiptKind[] {
  if (kinds === undefined) return [];
  return RECEIPT_KINDS.filter((kind) => kinds.includes(kind));
}

/**
 * References of a reply (RFC 5322 §3.6.4): the parent's References followed
 * by the parent's Message-ID, duplicates removed, the parent last. Ids that
 * cannot be written in 7-bit ASCII are skipped. Longer chains keep the first
 * id (the thread root) and the 19 most recent.
 */
function referencesFor(parent: ReplyTarget, parentId: string): string[] {
  const ids: string[] = [];
  for (const id of parent.references ?? []) {
    const writable = typeof id === "string" && WRITABLE_ID.test(id) && id.length <= MAX_ID_LENGTH;
    if (writable && id !== parentId && !ids.includes(id)) ids.push(id);
  }
  ids.push(parentId);
  return ids.length <= MAX_REFERENCES ? ids : [ids[0]!, ...ids.slice(ids.length - (MAX_REFERENCES - 1))];
}

// ---------------------------------------------------------------------------
// Writing

/** One header field; the body is already encoded and folded. */
function field(name: string, body: string): string {
  if (body === "") return name + ":";
  return body.startsWith(CRLF) ? name + ":" + body : name + ": " + body;
}

/** Ids separated by folding white space, folded before an id that would pass 78 characters. */
function formatIdList(ids: readonly string[], offset: number): string {
  let out = "";
  let column = offset;
  for (const id of ids) {
    if (out === "") {
      out = id;
      column += id.length;
    } else if (column + 1 + id.length > MAX_LINE) {
      out += CRLF + " " + id;
      column = 1 + id.length;
    } else {
      out += " " + id;
      column += 1 + id.length;
    }
  }
  return out;
}

interface Envelope {
  date: Date;
  messageId: string;
  from: EsAddress;
  to: readonly EsAddress[];
  cc: readonly EsAddress[];
  subject: string;
  inReplyTo: string | null;
  references: readonly string[];
  autoSubmitted: boolean;
}

function headerLines(e: Envelope): string[] {
  const lines = [field("Date", formatDate(e.date)), field("From", formatAddressList([e.from], "From: ".length))];
  if (e.to.length > 0) lines.push(field("To", formatAddressList(e.to, "To: ".length)));
  if (e.cc.length > 0) lines.push(field("Cc", formatAddressList(e.cc, "Cc: ".length)));
  lines.push(field("Subject", encodeHeaderValue(e.subject, { phrase: false, offset: "Subject: ".length })));
  lines.push(field("Message-ID", e.messageId));
  if (e.inReplyTo !== null) {
    lines.push(field("In-Reply-To", e.inReplyTo));
    lines.push(field("References", formatIdList(e.references, "References: ".length)));
  }
  // RFC 3834 §5: marks an automatic response so that vacation responders and similar agents do not answer it.
  if (e.autoSubmitted) lines.push(field("Auto-Submitted", "auto-replied"));
  return lines;
}

/**
 * True when the text can go as 7bit (RFC 2045 §2.7): printable ASCII and TAB,
 * short lines, no trailing white space (some transports strip or pad it,
 * RFC 2045 §6.7 rule 3), no line starting with "From " (mbox) or "." (SMTP, RFC 5321 §4.5.2),
 * and no occurrence of the boundary. Anything else is written as
 * quoted-printable, which cannot contain "=_" and so never the boundary
 * (RFC 2045 §6.7, note on multipart boundaries).
 */
function fitsSevenBit(text: string, boundary: string): boolean {
  if (!/^[\t\n\x20-\x7e]*$/.test(text) || text.includes(boundary)) return false;
  return text
    .split("\n")
    .every(
      (line) =>
        line.length <= MAX_7BIT_LINE && !/[ \t]$/.test(line) && !line.startsWith("From ") && !line.startsWith("."),
    );
}

/** The full message: header fields, then the multipart/mixed body (RFC 2046 §5.1.1, §5.1.3). */
function assemble(envelope: Envelope, text: string, es: EsPart): string {
  // "=_" cannot occur in quoted-printable or base64 output, and the hash keeps the value stable for a Message-ID.
  const boundary = "=_es_" + sha256Hex(envelope.messageId).slice(0, 24);
  const sevenBit = fitsSevenBit(text, boundary);
  const body = sevenBit ? text.replace(/\n/g, CRLF) : qpEncodeText(text);
  const lines = [
    ...headerLines(envelope),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    PREAMBLE,
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: " + (sevenBit ? "7bit" : "quoted-printable"),
    "",
    body,
    "--" + boundary,
    "Content-Type: " + ES_MEDIA_TYPE,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${ES_PART_FILENAME}"`,
    "",
    base64Encode(utf8Encode(formatEsJson(es))),
    "--" + boundary + "--",
    "",
  ];
  return lines.join(CRLF);
}

/**
 * Serialises a message as raw RFC 5322 text: a multipart/mixed message whose
 * first part is the text as text/plain and whose second part is the ES post
 * record. Replies get In-Reply-To and References so every client threads them.
 *
 * Throws TypeError for an invalid Message-ID, date, address, did:es author or
 * a message without recipients, and RangeError for text over 10000 UTF-8 bytes.
 */
export function serializeMessage(out: EsOutgoing, options: SerializeOptions): string {
  const messageId = checkMessageId(options.messageId);
  const date = checkDate(options.date);
  const from = checkMailbox(out.from, "from");
  const to = (out.to ?? []).map((mailbox) => checkMailbox(mailbox, "to"));
  const cc = (out.cc ?? []).map((mailbox) => checkMailbox(mailbox, "cc"));
  if (to.length + cc.length === 0) throw new TypeError("A message needs at least one recipient in to or cc");
  const author = checkAuthor(out.es?.author);
  const text = normalizeText(out.text);
  const textBytes = utf8Encode(text).length;
  if (textBytes > ES_TEXT_MAX_BYTES) {
    throw new RangeError(`Text is ${textBytes} UTF-8 bytes; the limit is ${ES_TEXT_MAX_BYTES}`);
  }

  const parent = out.inReplyTo;
  const inReplyTo = parent === undefined ? null : checkParentId(parent.messageId);
  const references = parent === undefined || inReplyTo === null ? [] : referencesFor(parent, inReplyTo);
  const subject = normalizeSubject(
    out.subject ?? (parent?.subject !== undefined ? replySubject(parent.subject) : ""),
  );

  const post: EsPostPart = {
    $type: ES_POST_TYPE,
    author,
    text,
    via: from.address,
    createdAt: date.toISOString(),
    email: {
      messageId,
      subject: utf8Encode(subject).length > ES_SUBJECT_MAX_BYTES ? null : subject,
      inReplyTo,
      references,
    },
    requestReceipts: normalizeReceiptKinds(out.es?.requestReceipts),
  };
  const envelope: Envelope = { date, messageId, from, to, cc, subject, inReplyTo, references, autoSubmitted: false };
  return assemble(envelope, text, post);
}

function receiptText(kind: ReceiptKind, subject: string, messageId: string, from: string, date: string): string {
  const what = subject === "" ? `the message ${messageId}` : `the message "${subject}" (${messageId})`;
  return kind === "read"
    ? `Read receipt: ${what} was opened by ${from} on ${date}.\n`
    : `Delivery receipt: ${what} was received by the Email Social client of ${from} on ${date}.\n`;
}

/**
 * Serialises a receipt (spec chapter 4 semantics) with the same layout as a
 * message: a short English text for any client, and an es.social.receipt
 * record. It answers the original (In-Reply-To, References) so it lands in
 * the same thread everywhere, and carries "Auto-Submitted: auto-replied".
 */
export function serializeReceipt(r: EsOutgoingReceipt, options: SerializeOptions): string {
  const kind = RECEIPT_KINDS.find((k) => k === r.kind);
  if (kind === undefined) throw new TypeError(`Not a receipt kind: ${JSON.stringify(r.kind)}`);
  const messageId = checkMessageId(options.messageId);
  const date = checkDate(options.date);
  const from = checkMailbox(r.from, "from");
  const to = checkMailbox(r.to, "to");
  const author = checkAuthor(r.author);
  const original = checkParentId(r.original?.messageId);
  const references = referencesFor(r.original, original);

  const originalSubject = normalizeSubject(typeof r.original.subject === "string" ? r.original.subject : "");
  const subject =
    originalSubject === ""
      ? kind === "read"
        ? "Read receipt"
        : "Delivery receipt"
      : (kind === "read" ? "Read: " : "Delivered: ") + originalSubject;
  const text = receiptText(kind, originalSubject, original, from.address, formatDate(date));

  const receipt: EsReceiptPart = {
    $type: ES_RECEIPT_TYPE,
    author,
    kind,
    messageId: original,
    via: from.address,
    createdAt: date.toISOString(),
  };
  const envelope: Envelope = {
    date,
    messageId,
    from,
    to: [to],
    cc: [],
    subject,
    inReplyTo: original,
    references,
    autoSubmitted: true,
  };
  return assemble(envelope, text, receipt);
}

/**
 * What a reply to `message` needs (RFC 5322 §3.6.4): its Message-ID, its
 * References (or, when it has none, its In-Reply-To if that holds exactly
 * one id; otherwise nothing) and its subject. Throws TypeError when the
 * message has no Message-ID, since a reply could not point at it.
 */
export function replyTargetOf(message: EsMessage): ReplyTarget {
  const { messageId, references, inReplyTo } = message.refs;
  if (messageId === null) throw new TypeError("The message has no Message-ID to reply to");
  const chain = references.length > 0 ? references : inReplyTo.length === 1 ? inReplyTo : [];
  return { messageId, references: [...chain], subject: message.subject };
}
