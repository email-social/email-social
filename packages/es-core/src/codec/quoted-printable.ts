/**
 * Quoted-Printable Content-Transfer-Encoding (RFC 2045 §6.7).
 */

import { utf8Encode } from "../util/bytes.js";

const EQUALS = 0x3d;
const CR = 0x0d;
const LF = 0x0a;
const SPACE = 0x20;
const TAB = 0x09;
const HEX = "0123456789ABCDEF";

function hexValue(byte: number | undefined): number {
  if (byte === undefined) return -1;
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57;
  return -1;
}

/**
 * Decodes quoted-printable bytes.
 *
 * - "=XX" in upper or lower case hex becomes one byte (§6.7 rule 1 asks for
 *   upper case; lower case is common and unambiguous).
 * - Trailing spaces and tabs of an encoded line are dropped (§6.7 rule 3).
 * - A line ending in "=" (after that trimming) is a soft line break and is
 *   removed together with its CRLF or LF (§6.7 rule 5).
 * - An "=" not followed by two hex digits is kept literally, as the note in
 *   §6.7 recommends for robust decoders.
 * - Hard line breaks (CRLF or LF) and 8-bit bytes pass through unchanged.
 */
export function qpDecode(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  let o = 0;
  let lineStart = 0;
  while (lineStart <= input.length) {
    let lf = input.indexOf(LF, lineStart);
    if (lf < 0) lf = input.length;
    const hasBreak = lf < input.length;
    const breakStart = hasBreak && lf > lineStart && input[lf - 1] === CR ? lf - 1 : lf;
    let end = breakStart;
    while (end > lineStart && (input[end - 1] === SPACE || input[end - 1] === TAB)) end--;
    const soft = end > lineStart && input[end - 1] === EQUALS;
    if (soft) end--;
    for (let i = lineStart; i < end; i++) {
      const byte = input[i]!;
      if (byte === EQUALS) {
        const hi = hexValue(input[i + 1]);
        const lo = hexValue(input[i + 2]);
        if (hi >= 0 && lo >= 0 && i + 2 < end) {
          out[o++] = (hi << 4) | lo;
          i += 2;
          continue;
        }
      }
      out[o++] = byte;
    }
    if (hasBreak && !soft) for (let i = breakStart; i <= lf; i++) out[o++] = input[i]!;
    if (!hasBreak) break;
    lineStart = lf + 1;
  }
  return out.slice(0, o);
}

interface Token {
  byte: number;
  encoded: boolean;
}

function width(token: Token): number {
  return token.encoded ? 3 : 1;
}

function write(token: Token): string {
  return token.encoded ? "=" + HEX[token.byte >> 4]! + HEX[token.byte & 15]! : String.fromCharCode(token.byte);
}

/** Bytes that may stand for themselves (§6.7 rules 2 and 3); a TAB or space ending a line is encoded separately. */
function isLiteral(byte: number): boolean {
  return byte === TAB || (byte >= SPACE && byte < 0x7f && byte !== EQUALS);
}

const FROM_ = [0x46, 0x72, 0x6f, 0x6d, 0x20]; // "From "

/** True when a physical line starting at `tokens[i]` would begin with a literal "From ". */
function startsWithFrom(tokens: readonly Token[], i: number): boolean {
  for (let k = 0; k < FROM_.length; k++) {
    const token = tokens[i + k];
    if (token === undefined || token.byte !== FROM_[k]) return false;
    if (token.encoded && k < 4) return false;
  }
  return true;
}

/** A token as it must be written at the start of a physical line. */
function atLineStart(tokens: readonly Token[], i: number): Token {
  const token = tokens[i]!;
  if (token.encoded) return token;
  // RFC 2049 §3 (8): some agents corrupt "." alone on a line and "From " at the start of one; "=2E" and
  // "=46rom " avoid that. Any leading "." is encoded, which also spares SMTP dot-stuffing (RFC 5321 §4.5.2).
  if (token.byte === 0x2e || startsWithFrom(tokens, i)) return { byte: token.byte, encoded: true };
  return token;
}

/** Encodes one line of text (no line breaks) into physical lines of at most 76 characters. */
function encodeLine(bytes: Uint8Array): string[] {
  const tokens: Token[] = [];
  for (let i = 0; i < bytes.length; i++) tokens.push({ byte: bytes[i]!, encoded: !isLiteral(bytes[i]!) });
  const last = tokens[tokens.length - 1];
  // §6.7 rule 3: white space at the end of an encoded line must be encoded.
  if (last !== undefined && (last.byte === SPACE || last.byte === TAB)) last.encoded = true;

  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < tokens.length; i++) {
    let token = current === "" ? atLineStart(tokens, i) : tokens[i]!;
    const isLast = i === tokens.length - 1;
    // §6.7 rule 5: lines of at most 76 characters, the soft break "=" included.
    const limit = isLast ? 76 : 75;
    if (current !== "" && current.length + width(token) > limit) {
      lines.push(current + "=");
      current = "";
      token = atLineStart(tokens, i);
    }
    current += write(token);
  }
  lines.push(current);
  return lines;
}

/**
 * Encodes text as quoted-printable UTF-8. "\n" in `text` is a hard line break
 * and is written as CRLF. Output lines have at most 76 characters (soft breaks
 * "=" CRLF), contain only printable ASCII and TAB, and never end in white
 * space. Lines starting with "From " or "." are protected so that mbox files
 * and SMTP servers cannot alter them.
 */
export function qpEncodeText(text: string): string {
  return text
    .split("\n")
    .map((line) => encodeLine(utf8Encode(line)).join("\r\n"))
    .join("\r\n");
}
