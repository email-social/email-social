/**
 * RFC 2047 encoded-words ("=?charset?Q|B?text?=") in header values: decoding
 * for every header Email Social reads, encoding for the ones it writes.
 */

import { concatBytes, utf8Encode } from "../util/bytes.js";
import { base64Decode, base64Encode } from "./base64.js";
import { decodeText } from "./charset.js";

/**
 * One encoded-word (§2). The charset may carry an RFC 2231 §5 language tag
 * ("utf-8*cs"). The payload may not contain "?" (§2) but spaces are accepted,
 * as other readers do, for words broken by careless folding.
 */
const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\r\n]*)\?=/g;

interface Word {
  start: number;
  end: number;
  charset: string;
  bytes: Uint8Array;
}

/** Q encoding (§4.2): "_" is a space, "=XX" a byte; an invalid "=" stays literal. */
function decodeQ(payload: string): Uint8Array {
  const parts: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i];
    if (ch === "_") {
      parts.push(0x20);
    } else if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(payload.slice(i + 1, i + 3))) {
      parts.push(parseInt(payload.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Raw non-ASCII in a payload is invalid (§2); keep the character as UTF-8.
      const code = payload.codePointAt(i)!;
      if (code < 0x80) {
        parts.push(code);
      } else {
        parts.push(...utf8Encode(String.fromCodePoint(code)));
        if (code > 0xffff) i++;
      }
    }
  }
  return Uint8Array.from(parts);
}

/**
 * Decodes every RFC 2047 encoded-word in `text`.
 *
 * - Linear white space between two adjacent encoded-words is removed (§6.2).
 * - Adjacent encoded-words in the same charset are joined as bytes before the
 *   charset is decoded, so a character split across two words (which §5
 *   forbids but some mailers produce) comes out whole.
 * - Malformed words are left as they are. Words touching other text or inside
 *   quoted strings are decoded too: which parts of a header may hold them is
 *   the caller's decision.
 */
export function decodeEncodedWords(text: string): string {
  if (!text.includes("=?")) return text;
  const words: Word[] = [];
  ENCODED_WORD.lastIndex = 0;
  for (let m = ENCODED_WORD.exec(text); m !== null; m = ENCODED_WORD.exec(text)) {
    const charset = m[1]!.split("*")[0]!.toLowerCase();
    const payload = m[3]!;
    const bytes = m[2]!.toLowerCase() === "b" ? base64Decode(payload) : decodeQ(payload);
    words.push({ start: m.index, end: m.index + m[0].length, charset, bytes });
  }
  if (words.length === 0) return text;

  let out = "";
  let position = 0;
  let run: Uint8Array[] = [];
  let runCharset = "";
  const flush = (): void => {
    if (run.length > 0) out += decodeText(concatBytes(run), runCharset);
    run = [];
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const between = text.slice(position, word.start);
    const adjacent = i > 0 && /^[ \t\r\n]*$/.test(between);
    if (!adjacent) {
      flush();
      out += between;
    } else if (word.charset !== runCharset) {
      flush();
    }
    runCharset = word.charset;
    run.push(word.bytes);
    position = word.end;
  }
  flush();
  return out + text.slice(position);
}

/** Longest encoded-word allowed by RFC 2047 §2. */
const MAX_WORD = 75;
/** Recommended maximum line length without CRLF, RFC 5322 §2.1.1. */
const MAX_LINE = 78;
/** Hard maximum line length without CRLF, RFC 5322 §2.1.1. */
const HARD_LINE = 998;
const PREFIX_Q = "=?UTF-8?Q?";
const PREFIX_B = "=?UTF-8?B?";
const SUFFIX = "?=";
const OVERHEAD = PREFIX_Q.length + SUFFIX.length;
const HEX = "0123456789ABCDEF";

/** RFC 5322 §3.2.3 specials, which an atom cannot contain. */
const SPECIALS = /[()<>[\]:;@\\,."]/;

/** Bytes written literally in Q: §4.2 rule 3 for *text, the stricter §5(3) set in a phrase. */
function qLiteral(byte: number, phrase: boolean): boolean {
  if (phrase) {
    return (
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      byte === 0x21 ||
      byte === 0x2a ||
      byte === 0x2b ||
      byte === 0x2d ||
      byte === 0x2f
    );
  }
  return byte > 0x20 && byte < 0x7f && byte !== 0x3d && byte !== 0x3f && byte !== 0x5f;
}

function qEncode(bytes: Uint8Array, phrase: boolean): string {
  let out = "";
  for (const byte of bytes) {
    if (byte === 0x20) out += "_";
    else if (qLiteral(byte, phrase)) out += String.fromCharCode(byte);
    else out += "=" + HEX[byte >> 4]! + HEX[byte & 15]!;
  }
  return out;
}

function qLength(bytes: Uint8Array, phrase: boolean): number {
  let length = 0;
  for (const byte of bytes) length += byte === 0x20 || qLiteral(byte, phrase) ? 1 : 3;
  return length;
}

function bLength(byteCount: number): number {
  return Math.ceil(byteCount / 3) * 4;
}

/** The shorter of the Q and B encoded-words for these bytes (Q on a tie, as it stays readable). */
function encodeWord(bytes: Uint8Array, phrase: boolean): string {
  return qLength(bytes, phrase) <= bLength(bytes.length)
    ? PREFIX_Q + qEncode(bytes, phrase) + SUFFIX
    : PREFIX_B + base64Encode(bytes, 0) + SUFFIX;
}

/**
 * Splits text into UTF-8 encoded-words that hold whole code points (§5: a
 * multi-octet character must not be split); the first word is at most
 * `firstBudget` characters long, the others at most 75 (§2).
 */
function encodeWords(text: string, phrase: boolean, firstBudget: number): string[] {
  const words: string[] = [];
  let chunk: Uint8Array[] = [];
  let byteCount = 0;
  let qLen = 0;
  const budget = (): number => (words.length === 0 ? firstBudget : MAX_WORD) - OVERHEAD;
  const flush = (): void => {
    if (chunk.length > 0) words.push(encodeWord(concatBytes(chunk), phrase));
    chunk = [];
    byteCount = 0;
    qLen = 0;
  };
  for (const char of text) {
    const bytes = utf8Encode(char);
    const nextQ = qLen + qLength(bytes, phrase);
    const nextB = bLength(byteCount + bytes.length);
    if (chunk.length > 0 && Math.min(nextQ, nextB) > budget()) {
      flush();
      chunk.push(bytes);
      byteCount = bytes.length;
      qLen = qLength(bytes, phrase);
    } else {
      chunk.push(bytes);
      byteCount += bytes.length;
      qLen = nextQ;
    }
  }
  flush();
  return words;
}

/** Folds before white space so that lines stay within 78 characters where a break exists (RFC 5322 §2.2.3). */
function foldAtSpaces(value: string, offset: number): string {
  const segments = value.match(/[ \t]*[^ \t]+|[ \t]+$/g) ?? [];
  let out = "";
  let column = offset;
  for (const segment of segments) {
    if (out !== "" && column + segment.length > MAX_LINE && /^[ \t]/.test(segment)) {
      out += "\r\n";
      column = 0;
    }
    out += segment;
    column += segment.length;
  }
  return out;
}

function longestLine(folded: string, offset: number): number {
  return folded.split("\r\n").reduce((max, line, i) => Math.max(max, (i === 0 ? offset : 0) + line.length), 0);
}

/**
 * Encodes a header field body for writing and folds it; `offset` is the
 * number of characters already on the first line (e.g. "Subject: ".length).
 *
 * Printable ASCII without leading or trailing white space and without "=?"
 * or "?=" is written as it is. In a phrase (display name, `phrase: true`),
 * such text containing RFC 5322 specials becomes a quoted-string. Anything
 * else becomes UTF-8 encoded-words (RFC 2047) of at most 75 characters,
 * each the shorter of Q and B, separated by folding white space, which
 * decoders drop between encoded-words (§6.2). Spaces are encoded inside the
 * words, so decoding restores the text exactly.
 */
export function encodeHeaderValue(text: string, options: { phrase: boolean; offset: number }): string {
  const { phrase, offset } = options;
  if (text === "") return "";
  const plain =
    /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(text) && !text.includes("=?") && !text.includes("?=");
  if (plain) {
    // RFC 5322 §3.2.4: a quoted-string escapes '"' and '\' with a backslash.
    const value = phrase && SPECIALS.test(text) ? '"' + text.replace(/["\\]/g, "\\$&") + '"' : text;
    const folded = foldAtSpaces(value, offset);
    if (longestLine(folded, offset) <= HARD_LINE) return folded;
  }
  const room = MAX_LINE - offset;
  // A word holding one 4-byte character needs 20 characters (in B); with less room, start on the next line.
  const startOnNewLine = room < OVERHEAD + 8;
  const firstBudget = startOnNewLine ? MAX_WORD : Math.min(MAX_WORD, room);
  const words = encodeWords(text, phrase, firstBudget);
  return (startOnNewLine ? "\r\n " : "") + words.join("\r\n ");
}
