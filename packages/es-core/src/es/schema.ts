/**
 * The ES structured part: its media type and the JSON records it carries.
 *
 * Wire format (UTF-8 JSON, one object):
 *
 *   { "$type": "es.social.post",
 *     "author": "did:es:…",                      (optional, metadata only)
 *     "value": { "text", "via", "createdAt",      (required; see below for "text")
 *                "email": { "messageId", "subject", "inReplyTo", "references",
 *                           "textSha256", "topicRoot", "topicLabel",
 *                           "replyTo": { "messageId", "from": { "name", "address" },
 *                                        "excerpt" } },
 *                "requestReceipts": ["delivered", "read"] } }
 *
 *   { "$type": "es.social.receipt",
 *     "author": "did:es:…",
 *     "value": { "kind": "delivered" | "read", "messageId", "via", "createdAt" } }
 *
 *   { "$type": "es.social.story",
 *     "author": "did:es:…",
 *     "value": { "via", "createdAt", "email": { "messageId", "textSha256" },
 *                "title", "expiresAt", "unsubscribe": { "mailto" } | { "url" },
 *                "text" } }
 *
 * The post record is the direct-message subset of the draft's es.social.post
 * lexicon (spec 2.3.1): text, via, createdAt and email. Facets, embeds,
 * visibility, geo, reply (AT URIs) and langs belong to features this
 * repository does not have. The record envelope keeps `$type`, `value` and
 * `author`; `uri`, `cid` and `signature` are not produced and are ignored when
 * present. `requestReceipts` and the receipt record are additions: the draft
 * has no receipts.
 *
 * `email` is the sub-object that is ours (the lexicon's `reply`, with AT
 * URIs, stays unwritten and is ignored). Topics and deliberate replies live
 * there:
 * - `topicRoot`: the Message-ID of the root of the topic (a thread inside a
 *   chat) the message belongs to; the root writes its own Message-ID. Left
 *   out when the root has no Message-ID.
 * - `topicLabel`: the topic's name, on every message of a named topic, so the
 *   name survives the root falling outside what a reader holds.
 * - `replyTo`: only on a deliberate reply, the message it answers: its
 *   Message-ID (null when it has none), its sender, and the start of what the
 *   sender wrote (at most 140 characters). It has nothing to do with the
 *   RFC 5322 Reply-To header field.
 *
 * A text longer than ES_TEXT_MAX_BYTES is not put in the record (the lexicon
 * limit); the full text is always in the message's text/plain part. Such a
 * record leaves `text` out and carries `email.textSha256`, the lowercase hex
 * SHA-256 of the UTF-8 text, so a reader can tie it to that body.
 *
 * The story record marks a newsletter or promotion explicitly (spec section
 * "Stories"). It is ours, like the receipt record: the draft has none. It
 * never asks for receipts (`requestReceipts` is neither written nor read),
 * its title is at most ES_STORY_TITLE_MAX_BYTES, and its text follows the
 * post rule above.
 *
 * Parsing is liberal (unknown fields are ignored, malformed optional fields
 * are dropped); a record missing a required field is rejected as a whole.
 */

import { canonicalAddress } from "../headers/canonical.js";
import { normalizeMessageId } from "../headers/message-id.js";
import { isValidDid } from "../did.js";
import { utf8Encode } from "../util/bytes.js";
import type { EsEmailMeta, EsPart, EsPostPart, EsReceiptPart, EsReplyToCard, EsStoryPart, EsStoryUnsubscribe, ReceiptKind } from "../types.js";

/** Media type of the ES part written by es-core. */
export const ES_MEDIA_TYPE = "application/vnd.email-social.message+json";
/** Media type used by the v2 draft (spec 4.1); accepted when parsing, never written. */
export const ES_DRAFT_MEDIA_TYPE = "application/vnd.es.social+json";
/** Filename given to the ES part so ordinary clients show it as a small, named attachment. */
export const ES_PART_FILENAME = "email-social.json";

export const ES_POST_TYPE = "es.social.post";
export const ES_RECEIPT_TYPE = "es.social.receipt";
export const ES_STORY_TYPE = "es.social.story";

/** Lexicon limits (spec 2.3.1), in UTF-8 bytes as in AT Protocol lexicons. */
export const ES_TEXT_MAX_BYTES = 10000;
export const ES_SUBJECT_MAX_BYTES = 500;
/** Longest story title, in UTF-8 bytes. */
export const ES_STORY_TITLE_MAX_BYTES = 200;

/** An unsubscribe URL a story record may give: http or https, printable ASCII without spaces or brackets. */
export const STORY_URL = /^https?:\/\/[\x21-\x7e]+$/i;

const RECEIPT_KINDS: readonly ReceiptKind[] = ["delivered", "read"];

/** True for the media types that carry an ES part (parameters and case ignored). */
export function isEsMediaType(contentType: string): boolean {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return type === ES_MEDIA_TYPE || type === ES_DRAFT_MEDIA_TYPE;
}

/** RFC 3339 §5.6 date-time with range checks on each field. */
export function isRfc3339DateTime(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (m === null) return false;
  const [, , month, day, hour, minute, second, , , offH, offM] = m;
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= 31 &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 60 &&
    (offH === undefined || (Number(offH) <= 23 && Number(offM) <= 59))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = canonicalAddress(value);
  return address.includes("@") ? address : null;
}

function readReceiptKinds(value: unknown): ReceiptKind[] {
  if (!Array.isArray(value)) return [];
  return RECEIPT_KINDS.filter((kind) => value.includes(kind));
}

/** An address with something before and after its last "@", in canonical form; null otherwise. */
function readUsableAddress(value: unknown): string | null {
  const address = readAddress(value);
  if (address === null) return null;
  const at = address.lastIndexOf("@");
  return at > 0 && at < address.length - 1 && !/[\s<>]/.test(address) ? address : null;
}

/** A story's `unsubscribe`: `{ mailto }` with a usable address or `{ url }` with an http(s) URL; null otherwise. */
function readStoryUnsubscribe(value: unknown): EsStoryUnsubscribe | null {
  if (!isObject(value)) return null;
  if (typeof value.mailto === "string") {
    const mailto = readUsableAddress(value.mailto);
    return mailto === null ? null : { mailto };
  }
  if (typeof value.url === "string" && value.url.length <= 2000 && STORY_URL.test(value.url) && !/[<>"\\]/.test(value.url)) return { url: value.url };
  return null;
}

/** `email.replyTo`, or null when it is not an object with a usable `from.address`. */
function readReplyTo(value: unknown): EsReplyToCard | null {
  if (!isObject(value) || !isObject(value.from)) return null;
  const address = readAddress(value.from.address);
  if (address === null) return null;
  return {
    messageId: typeof value.messageId === "string" ? normalizeMessageId(value.messageId) : null,
    from: { name: typeof value.from.name === "string" ? value.from.name : "", address },
    excerpt: typeof value.excerpt === "string" ? value.excerpt : "",
  };
}

function readEmailMeta(value: unknown): EsEmailMeta {
  const meta: EsEmailMeta = { messageId: null, subject: null, inReplyTo: null, references: [], textSha256: null, topicRoot: null, topicLabel: null, replyTo: null };
  if (!isObject(value)) return meta;
  if (typeof value.topicRoot === "string") meta.topicRoot = normalizeMessageId(value.topicRoot);
  if (typeof value.topicLabel === "string") meta.topicLabel = value.topicLabel;
  meta.replyTo = readReplyTo(value.replyTo);
  if (typeof value.messageId === "string") meta.messageId = normalizeMessageId(value.messageId);
  if (typeof value.subject === "string") meta.subject = value.subject;
  if (typeof value.inReplyTo === "string") meta.inReplyTo = normalizeMessageId(value.inReplyTo);
  if (typeof value.textSha256 === "string" && /^[0-9a-f]{64}$/i.test(value.textSha256)) {
    meta.textSha256 = value.textSha256.toLowerCase();
  }
  if (Array.isArray(value.references)) {
    // A Set for the duplicate test: the array comes from the sender and may hold any number of ids.
    const seen = new Set<string>();
    for (const ref of value.references) {
      const id = typeof ref === "string" ? normalizeMessageId(ref) : null;
      if (id !== null && !seen.has(id)) {
        seen.add(id);
        meta.references.push(id);
      }
    }
  }
  return meta;
}

/**
 * Parses the JSON body of an ES part. Returns null for invalid JSON, an
 * unknown `$type`, or a record without its required fields. Does not check
 * that the record belongs to the surrounding message; see `parseMessage`.
 */
export function parseEsJson(json: string): EsPart | null {
  let root: unknown;
  try {
    root = JSON.parse(json.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (!isObject(root) || !isObject(root.value)) return null;
  const value = root.value;
  const author = typeof root.author === "string" && isValidDid(root.author) ? root.author : null;
  const via = readAddress(value.via);
  const createdAt = typeof value.createdAt === "string" && isRfc3339DateTime(value.createdAt) ? value.createdAt : null;
  if (via === null || createdAt === null) return null;

  if (root.$type === ES_POST_TYPE) {
    const email = readEmailMeta(value.email);
    // `text` is required unless the sender left a long text out and gave its hash instead.
    const text = typeof value.text === "string" ? value.text : null;
    const omitted = (value.text === undefined || value.text === null) && email.textSha256 !== null;
    if (text === null && !omitted) return null;
    const post: EsPostPart = {
      $type: ES_POST_TYPE,
      author,
      text,
      via,
      createdAt,
      email,
      requestReceipts: readReceiptKinds(value.requestReceipts),
    };
    return post;
  }
  if (root.$type === ES_STORY_TYPE) {
    const email = isObject(value.email) ? value.email : {};
    const messageId = typeof email.messageId === "string" ? normalizeMessageId(email.messageId) : null;
    const textSha256 = typeof email.textSha256 === "string" && /^[0-9a-f]{64}$/i.test(email.textSha256) ? email.textSha256.toLowerCase() : null;
    const title = typeof value.title === "string" ? value.title : null;
    if (messageId === null || title === null || title.trim() === "" || utf8Encode(title).length > ES_STORY_TITLE_MAX_BYTES) return null;
    const text = typeof value.text === "string" ? value.text : null;
    const omitted = (value.text === undefined || value.text === null) && textSha256 !== null;
    if (text === null && !omitted) return null;
    const story: EsStoryPart = {
      $type: ES_STORY_TYPE,
      author,
      via,
      createdAt,
      email: { messageId, textSha256 },
      title,
      expiresAt: typeof value.expiresAt === "string" && isRfc3339DateTime(value.expiresAt) ? value.expiresAt : null,
      unsubscribe: readStoryUnsubscribe(value.unsubscribe),
      text,
    };
    return story;
  }
  if (root.$type === ES_RECEIPT_TYPE) {
    const kind = RECEIPT_KINDS.find((k) => k === value.kind);
    const messageId = typeof value.messageId === "string" ? normalizeMessageId(value.messageId) : null;
    if (kind === undefined || messageId === null) return null;
    const receipt: EsReceiptPart = { $type: ES_RECEIPT_TYPE, author, kind, messageId, via, createdAt };
    return receipt;
  }
  return null;
}

/** The wire object of an ES part, with a fixed key order so output is byte-stable. */
export function esPartToWire(part: EsPart): Record<string, unknown> {
  const wire: Record<string, unknown> = { $type: part.$type };
  if (part.author !== null) wire.author = part.author;
  if (part.$type === ES_POST_TYPE) {
    const value: Record<string, unknown> = {};
    if (part.text !== null) value.text = part.text;
    value.via = part.via;
    value.createdAt = part.createdAt;
    const email: Record<string, unknown> = {};
    if (part.email.messageId !== null) email.messageId = part.email.messageId;
    if (part.email.subject !== null) email.subject = part.email.subject;
    if (part.email.inReplyTo !== null) email.inReplyTo = part.email.inReplyTo;
    if (part.email.references.length > 0) email.references = [...part.email.references];
    if (part.email.textSha256 !== null) email.textSha256 = part.email.textSha256;
    if (part.email.topicRoot !== null) email.topicRoot = part.email.topicRoot;
    if (part.email.topicLabel !== null) email.topicLabel = part.email.topicLabel;
    const replyTo = part.email.replyTo;
    if (replyTo !== null) {
      email.replyTo = { messageId: replyTo.messageId, from: { name: replyTo.from.name, address: replyTo.from.address }, excerpt: replyTo.excerpt };
    }
    if (Object.keys(email).length > 0) value.email = email;
    if (part.requestReceipts.length > 0) value.requestReceipts = readReceiptKinds(part.requestReceipts);
    wire.value = value;
  } else if (part.$type === ES_STORY_TYPE) {
    const value: Record<string, unknown> = { via: part.via, createdAt: part.createdAt };
    value.email = part.email.textSha256 === null ? { messageId: part.email.messageId } : { messageId: part.email.messageId, textSha256: part.email.textSha256 };
    value.title = part.title;
    if (part.expiresAt !== null) value.expiresAt = part.expiresAt;
    if (part.unsubscribe !== null) value.unsubscribe = "mailto" in part.unsubscribe ? { mailto: part.unsubscribe.mailto } : { url: part.unsubscribe.url };
    if (part.text !== null) value.text = part.text;
    wire.value = value;
  } else {
    wire.value = { kind: part.kind, messageId: part.messageId, via: part.via, createdAt: part.createdAt };
  }
  return wire;
}

/** Serialises an ES part as pretty-printed UTF-8 JSON text ending in a newline. */
export function formatEsJson(part: EsPart): string {
  return JSON.stringify(esPartToWire(part), null, 2) + "\n";
}
