/**
 * The MIME structure of a message (RFC 2045, RFC 2046 §5.1): a tree of
 * entities, each with its own header fields and raw (still transfer-encoded)
 * body. Parsing is liberal and never throws; content is decoded only on
 * request (`decodeBody`).
 */

import { base64Decode } from "../codec/base64.js";
import { qpDecode } from "../codec/quoted-printable.js";
import { getHeader, parseHeaderFields, splitHeaderBody, type HeaderField } from "../headers/header-block.js";
import { normalizeMessageId } from "../headers/message-id.js";
import { parseContentDisposition, parseContentType } from "../headers/params.js";
import { latin1Decode, utf8Encode } from "../util/bytes.js";

/** One MIME entity. A leaf has no children; its body is the raw, still-encoded content. */
export interface MimeNode {
  /** IMAP part number (RFC 9051 §6.4.5): "" for the root, "1", "2", "2.1", … for the parts of multiparts. */
  partId: string;
  fields: HeaderField[];
  /** Lowercased "type/subtype". */
  contentType: string;
  params: Record<string, string>;
  disposition: "inline" | "attachment" | null;
  dispositionParams: Record<string, string>;
  /** Lowercased Content-Transfer-Encoding; "7bit" when absent (RFC 2045 §6.1). */
  transferEncoding: string;
  /** Content-ID in angle brackets, or null. */
  contentId: string | null;
  /** The raw body. For a multipart, the whole body including preamble and epilogue. */
  body: Uint8Array;
  children: MimeNode[];
}

/** Multiparts nested deeper than this are left as leaves (protects against stack exhaustion). */
const MAX_DEPTH = 32;

const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;
const HYPHEN = 0x2d;

/** A header field line: printable ASCII name without ":", optional white space, ":" (RFC 5322 §2.2, §4.5). */
const FIELD_START = /^[\x21-\x39\x3b-\x7e]+[ \t]*:/;

/** Index just after the line break of the line starting at `start` (or the input length). */
function nextLine(bytes: Uint8Array, start: number): number {
  const lf = bytes.indexOf(LF, start);
  return lf < 0 ? bytes.length : lf + 1;
}

/**
 * Splits a body part into header and body. Unlike a top-level message, a
 * part whose first line neither is empty nor starts a header field is taken
 * as having no header at all, so text written by a generator that forgot the
 * empty line is not lost.
 */
function splitPart(bytes: Uint8Array): { header: Uint8Array; body: Uint8Array } {
  const firstLineEnd = nextLine(bytes, 0);
  const firstLine = latin1Decode(bytes.subarray(0, Math.min(firstLineEnd, 1000)));
  if (firstLine.length > 0 && firstLine !== "\n" && firstLine !== "\r\n" && !FIELD_START.test(firstLine)) {
    return { header: bytes.subarray(0, 0), body: bytes };
  }
  return splitHeaderBody(bytes);
}

/** "Base64 " → "base64"; comments and quotes removed. */
function normalizeEncoding(value: string | null): string {
  if (value === null) return "7bit";
  const cleaned = value.replace(/\([^()]*\)/g, " ").replace(/["']/g, "").trim().toLowerCase();
  const token = cleaned.split(/[\s;]+/)[0] ?? "";
  return token === "" ? "7bit" : token;
}

/**
 * A Content-ID (RFC 2045 §7) or a multipart/related "start" parameter
 * (RFC 2387 §3.2) in angle brackets; a comment or missing brackets are
 * tolerated. Null when absent or empty.
 */
export function normalizeContentId(value: string | null): string | null {
  if (value === null) return null;
  const bracketed = /<([^<>]*)>/.exec(value);
  return normalizeMessageId(bracketed !== null ? bracketed[1]! : value.replace(/\([^()]*\)/g, ""));
}

/**
 * The delimiter on the line from `start` to `end` (line break included):
 * "open" for "--boundary", "close" for "--boundary--", each optionally
 * followed by transport padding; null for any other line. Matching is exact
 * and case-sensitive, so "--boundaryX" or "--boundary-x" is content.
 */
function delimiterAt(bytes: Uint8Array, start: number, end: number, boundary: Uint8Array): "open" | "close" | null {
  if (end - start < boundary.length + 2 || bytes[start] !== HYPHEN || bytes[start + 1] !== HYPHEN) return null;
  for (let i = 0; i < boundary.length; i++) if (bytes[start + 2 + i] !== boundary[i]) return null;
  let p = start + 2 + boundary.length;
  let kind: "open" | "close" = "open";
  if (bytes[p] === HYPHEN && bytes[p + 1] === HYPHEN) {
    kind = "close";
    p += 2;
  }
  // RFC 2046 §5.1.1: transport padding (LWSP) may follow a delimiter; CR belongs to the line break.
  for (; p < end; p++) {
    const byte = bytes[p];
    if (byte !== SPACE && byte !== TAB && byte !== CR && byte !== LF) return null;
  }
  return kind;
}

/**
 * The encapsulated parts of a multipart body (RFC 2046 §5.1.1), or null when
 * the body has no delimiter line. The line break before a delimiter belongs
 * to the delimiter; preamble and epilogue are dropped; without a close
 * delimiter the last part runs to the end of the body.
 */
function splitMultipart(body: Uint8Array, boundary: Uint8Array): Uint8Array[] | null {
  const parts: Uint8Array[] = [];
  let partStart = -1;
  let found = false;
  for (let line = 0; line < body.length; ) {
    const next = nextLine(body, line);
    const kind = delimiterAt(body, line, next, boundary);
    if (kind !== null) {
      found = true;
      if (partStart >= 0) {
        let end = line;
        if (end > partStart && body[end - 1] === LF) end--;
        if (end > partStart && body[end - 1] === CR) end--;
        parts.push(body.subarray(partStart, end));
      }
      if (kind === "close") return parts;
      partStart = next;
    }
    line = next;
  }
  if (!found) return null;
  if (partStart >= 0) parts.push(body.subarray(Math.min(partStart, body.length)));
  return parts;
}

function parseEntity(
  header: Uint8Array,
  body: Uint8Array,
  partId: string,
  depth: number,
  defaultType: string | null,
): MimeNode {
  const fields = parseHeaderFields(header);
  const contentTypeValue = getHeader(fields, "content-type");
  const { type, params } =
    contentTypeValue === null && defaultType !== null
      ? { type: defaultType, params: {} as Record<string, string> }
      : parseContentType(contentTypeValue);
  const disposition = parseContentDisposition(getHeader(fields, "content-disposition"));
  const node: MimeNode = {
    partId,
    fields,
    contentType: type,
    params,
    disposition: disposition.disposition,
    dispositionParams: disposition.params,
    transferEncoding: normalizeEncoding(getHeader(fields, "content-transfer-encoding")),
    contentId: normalizeContentId(getHeader(fields, "content-id")),
    body,
    children: [],
  };
  if (!type.startsWith("multipart/")) return node;
  if (depth >= MAX_DEPTH) return node;
  const boundary = params.boundary ?? "";
  const parts = boundary === "" ? null : splitMultipart(body, utf8Encode(boundary));
  if (parts === null) {
    // No boundary, or no delimiter line for it: show the content as text instead of dropping it.
    node.contentType = "text/plain";
    return node;
  }
  // RFC 2046 §5.1.5: in a digest, a part without Content-Type is a message/rfc822.
  const childDefault = type === "multipart/digest" ? "message/rfc822" : null;
  node.children = parts.map((bytes, i) => {
    const { header: h, body: b } = splitPart(bytes);
    return parseEntity(h, b, partId === "" ? String(i + 1) : `${partId}.${i + 1}`, depth + 1, childDefault);
  });
  return node;
}

/**
 * Parses a raw message into its MIME tree. The root has part id "". A
 * message/rfc822 (or message/global) part is a leaf: its content is an
 * attached message, not part of this one.
 */
export function parseMimeTree(raw: Uint8Array): MimeNode {
  const { header, body } = splitHeaderBody(raw);
  return parseEntity(header, body, "", 0, null);
}

/** The body with its Content-Transfer-Encoding removed; 7bit, 8bit, binary and unknown encodings are returned as is. */
export function decodeBody(node: MimeNode): Uint8Array {
  switch (node.transferEncoding) {
    case "base64":
      return base64Decode(latin1Decode(node.body));
    case "quoted-printable":
      return qpDecode(node.body);
    default:
      return node.body;
  }
}

/**
 * Decoded size of a base64 body, read from the bytes: the base64 alphabet
 * characters before the first "=" carry 6 bits each (the same rule as
 * base64Decode, RFC 2045 §6.8), so no string or output buffer is built.
 */
function base64Size(body: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < body.length; i++) {
    const b = body[i]!;
    if (b === 0x3d) break;
    if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2f) {
      count++;
    }
  }
  return Math.floor((count * 3) / 4);
}

/** Size in bytes of `decodeBody(node)`, computed without decoding base64. */
export function decodedSize(node: MimeNode): number {
  switch (node.transferEncoding) {
    case "base64":
      return base64Size(node.body);
    case "quoted-printable":
      return qpDecode(node.body).length;
    default:
      return node.body.length;
  }
}
