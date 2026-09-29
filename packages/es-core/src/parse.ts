/**
 * parseMessage: a raw RFC 5322 message → EsMessage.
 *
 * Body text is chosen the way a plain-text mail reader would: text/plain
 * wherever it exists, HTML reduced to text only when there is none. The ES
 * part is taken only when it belongs to this message (see `acceptEsPart`).
 */

import { decodeText } from "./codec/charset.js";
import { decodeEncodedWords } from "./codec/encoded-word.js";
import { ES_POST_TYPE, isEsMediaType, parseEsJson } from "./es/schema.js";
import { parseAddressList } from "./headers/address.js";
import { parseDate } from "./headers/date.js";
import { getHeader, getHeaders } from "./headers/header-block.js";
import { parseMessageId, parseMessageIds } from "./headers/message-id.js";
import { decodeFlowed } from "./mime/flowed.js";
import { htmlToText } from "./mime/html-to-text.js";
import { decodeBody, decodedSize, normalizeContentId, parseMimeTree, type MimeNode } from "./mime/tree.js";
import type { EsAddress, EsAttachment, EsMessage, EsPart, EsRefs, TextSource } from "./types.js";
import { toBytes, utf8Decode } from "./util/bytes.js";
import { sha256Hex } from "./util/sha256.js";

/** A body-text leaf chosen by the selection rules. */
interface Piece {
  kind: "plain" | "html";
  node: MimeNode;
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== "" ? value : null;
}

/** Content-Disposition filename, else Content-Type name (RFC 2183 §2.3, RFC 2046 §4.5.1), else null. */
function filenameOf(node: MimeNode): string | null {
  return nonEmpty(node.dispositionParams.filename) ?? nonEmpty(node.params.name);
}

/** A text/plain or text/html leaf meant to be read as the message, not saved as a file. */
function isBodyText(node: MimeNode): boolean {
  return (
    node.children.length === 0 &&
    (node.contentType === "text/plain" || node.contentType === "text/html") &&
    node.disposition !== "attachment" &&
    filenameOf(node) === null
  );
}

function lower(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Decoded text of a text/plain part with "\n" line endings, format=flowed unwrapped (RFC 3676), never trimmed. */
function plainText(node: MimeNode): string {
  const text = decodeText(decodeBody(node), node.params.charset).replace(/\r\n?/g, "\n");
  return lower(node.params.format) === "flowed" ? decodeFlowed(text, lower(node.params.delsp) === "yes") : text;
}

function htmlText(node: MimeNode): string {
  return htmlToText(decodeText(decodeBody(node), node.params.charset));
}

/** Decodes each chosen part at most once. */
class TextCache {
  private readonly texts = new Map<MimeNode, string>();

  of(piece: Piece): string {
    let text = this.texts.get(piece.node);
    if (text === undefined) {
      text = piece.kind === "plain" ? plainText(piece.node) : htmlText(piece.node);
      this.texts.set(piece.node, text);
    }
    return text;
  }

  hasPlainText(pieces: readonly Piece[]): boolean {
    return pieces.some((p) => p.kind === "plain" && this.of(p).trim() !== "");
  }
}

/**
 * The body-text leaves of a subtree, in reading order:
 * - multipart/alternative: the first alternative with non-blank plain text,
 *   else the last one with HTML (RFC 2046 §5.1.4: later is richer);
 * - multipart/related: its root (RFC 2387 §3.2 "start", else the first part);
 * - any other multipart (mixed, signed, report, …): every part in order;
 * - message/rfc822 and other non-text leaves: nothing.
 */
function select(node: MimeNode, cache: TextCache): Piece[] {
  if (node.children.length === 0) {
    if (!isBodyText(node)) return [];
    return [{ kind: node.contentType === "text/plain" ? "plain" : "html", node }];
  }
  if (node.contentType === "multipart/alternative") {
    const options = node.children.map((child) => select(child, cache));
    const withHtml = options.filter((o) => o.some((p) => p.kind === "html"));
    return (
      options.find((o) => cache.hasPlainText(o)) ??
      withHtml[withHtml.length - 1] ??
      options.find((o) => o.length > 0) ??
      []
    );
  }
  if (node.contentType === "multipart/related") {
    const start = normalizeContentId(node.params.start ?? null);
    const root = (start === null ? undefined : node.children.find((c) => c.contentId === start)) ?? node.children[0]!;
    return select(root, cache);
  }
  return node.children.flatMap((child) => select(child, cache));
}

/**
 * The message text: the chosen plain parts, or the chosen HTML parts when no
 * plain part has text, joined with "\n" where a part does not end with one.
 */
function bodyText(root: MimeNode): { text: string; textSource: TextSource } {
  const cache = new TextCache();
  const pieces = select(root, cache);
  let chosen = pieces.filter((p) => p.kind === "plain");
  let source: TextSource = "plain";
  if (!cache.hasPlainText(chosen)) {
    const html = pieces.filter((p) => p.kind === "html");
    if (html.length > 0) {
      chosen = html;
      source = "html";
    }
  }
  const texts: string[] = [];
  for (const piece of chosen) {
    const part = cache.of(piece);
    if (part === "") continue;
    const previous = texts[texts.length - 1];
    if (previous !== undefined && !previous.endsWith("\n")) texts.push("\n");
    texts.push(part);
  }
  const text = texts.join("");
  return { text, textSource: text === "" ? "none" : source };
}

function leaves(node: MimeNode, out: MimeNode[] = []): MimeNode[] {
  if (node.children.length === 0) out.push(node);
  else for (const child of node.children) leaves(child, out);
  return out;
}

/**
 * The ES part of this message, or null. Only the first leaf with an ES media
 * type is considered. It must parse, its `via` must be the From address, and
 * a post's `email.messageId` must be the header Message-ID when both exist:
 * a forward made by an ordinary client carries the original's ES part along,
 * and that part describes another message.
 */
function acceptEsPart(node: MimeNode, from: EsAddress | null, messageId: string | null): EsPart | null {
  const es = parseEsJson(utf8Decode(decodeBody(node)));
  if (es === null) return null;
  if (from !== null && es.via !== from.address) return null;
  if (es.$type === ES_POST_TYPE && messageId !== null && es.email.messageId !== null && es.email.messageId !== messageId) {
    return null;
  }
  return es;
}

function toAttachment(node: MimeNode): EsAttachment {
  return {
    filename: filenameOf(node),
    contentType: node.contentType,
    // RFC 2183 §2: no Content-Disposition; a part with a Content-ID is referenced from the body.
    disposition: node.disposition ?? (node.contentId !== null ? "inline" : "attachment"),
    size: decodedSize(node),
    contentId: node.contentId,
    // A single-part message is part "1" (RFC 9051 §6.4.5).
    partId: node.partId === "" ? "1" : node.partId,
  };
}

/** The first mailbox of the first From field that has one. */
function firstMailbox(values: readonly string[]): EsAddress | null {
  for (const value of values) {
    const list = parseAddressList(value);
    if (list.length > 0) return list[0]!;
  }
  return null;
}

function parseBytes(bytes: Uint8Array): EsMessage {
  const root = parseMimeTree(bytes);
  const fields = root.fields;
  const addresses = (name: string): EsAddress[] => getHeaders(fields, name).flatMap((v) => parseAddressList(v));

  const messageIdValue = getHeader(fields, "message-id");
  const refs: EsRefs = {
    messageId: messageIdValue === null ? null : parseMessageId(messageIdValue),
    inReplyTo: parseMessageIds(getHeader(fields, "in-reply-to") ?? ""),
    references: parseMessageIds(getHeader(fields, "references") ?? ""),
  };
  const from = firstMailbox(getHeaders(fields, "from"));
  const subjectValue = getHeader(fields, "subject");
  const dateValue = getHeader(fields, "date");

  const all = leaves(root);
  const esNode = all.find((node) => isEsMediaType(node.contentType)) ?? null;
  const es = esNode === null ? null : acceptEsPart(esNode, from, refs.messageId);
  const { text, textSource } = bodyText(root);

  return {
    id: refs.messageId ?? "sha256:" + sha256Hex(bytes),
    from,
    to: addresses("to"),
    cc: addresses("cc"),
    replyTo: addresses("reply-to"),
    date: dateValue === null ? null : parseDate(dateValue),
    subject: subjectValue === null ? "" : decodeEncodedWords(subjectValue).replace(/[ \t\n\v\f\r]+/g, " ").replace(/^ | $/g, ""),
    text,
    textSource,
    es,
    attachments: all.filter((node) => !isBodyText(node) && !(es !== null && node === esNode)).map(toAttachment),
    refs,
  };
}

/**
 * Parses a raw message (bytes, or a string taken as already-decoded text and
 * encoded as UTF-8). Never throws: malformed input gives empty fields, and an
 * unexpected internal error gives a message with only its SHA-256 id.
 */
export function parseMessage(raw: string | Uint8Array): EsMessage {
  const bytes = toBytes(raw);
  try {
    return parseBytes(bytes);
  } catch {
    return {
      id: "sha256:" + sha256Hex(bytes),
      from: null,
      to: [],
      cc: [],
      replyTo: [],
      date: null,
      subject: "",
      text: "",
      textSource: "none",
      es: null,
      attachments: [],
      refs: { messageId: null, inReplyTo: [], references: [] },
    };
  }
}

/**
 * parseMessage without its last-resort error handler, so tests (fuzzing) can
 * see an exception instead of the fallback message. Not part of the public API.
 * @internal
 */
export function parseMessageUnguarded(raw: string | Uint8Array): EsMessage {
  return parseBytes(toBytes(raw));
}
