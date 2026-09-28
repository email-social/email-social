/**
 * Content-Type (RFC 2045 §5.1) and Content-Disposition (RFC 2183) values:
 * a type followed by ";"-separated parameters, with RFC 2231 extended and
 * continued parameters and, as real mailers write them, RFC 2047
 * encoded-words inside quoted values.
 */

import { decodeText } from "../codec/charset.js";
import { decodeEncodedWords } from "../codec/encoded-word.js";
import { concatBytes } from "../util/bytes.js";

interface RawParam {
  name: string;
  value: string;
}

/** Media type syntax: token "/" token (RFC 2045 §5.1). */
const MEDIA_TYPE = /^[!#$%&'*+\-.^_`|~0-9a-z]+\/[!#$%&'*+\-.^_`|~0-9a-z]+$/;

/** Splits "type; a=1; b="x"" into its first segment and raw parameters, tolerating sloppy syntax. */
function tokenize(value: string): { head: string; params: RawParam[] } {
  const params: RawParam[] = [];
  let i = value.indexOf(";");
  let head = i < 0 ? value : value.slice(0, i);
  if (i < 0) i = value.length;
  // A first segment containing "=" is a parameter whose type was left out.
  if (head.includes("=")) {
    i = 0;
    head = "";
  }
  while (i < value.length) {
    while (i < value.length && /[\s;]/.test(value[i]!)) i++;
    if (i >= value.length) break;
    const nameStart = i;
    while (i < value.length && value[i] !== "=" && value[i] !== ";") i++;
    const name = value.slice(nameStart, i).trim().toLowerCase();
    if (value[i] !== "=") continue; // a parameter without a value is ignored
    i++;
    while (i < value.length && /[ \t\r\n]/.test(value[i]!)) i++;
    let paramValue = "";
    if (value[i] === '"') {
      // RFC 5322 §3.2.4 quoted-string with quoted-pairs; unterminated runs to the end.
      i++;
      while (i < value.length && value[i] !== '"') {
        if (value[i] === "\\" && i + 1 < value.length) i++;
        paramValue += value[i];
        i++;
      }
      i++;
      while (i < value.length && value[i] !== ";") i++;
    } else {
      const start = i;
      while (i < value.length && value[i] !== ";") i++;
      paramValue = value.slice(start, i).trim();
    }
    if (name !== "") params.push({ name, value: paramValue });
  }
  return { head: head.replace(/\([^()]*\)/g, "").replace(/\s+/g, "").toLowerCase(), params };
}

/** Percent-decodes an RFC 2231 value into bytes; "%" not followed by two hex digits stays literal. */
function percentDecode(text: string): (Uint8Array | string)[] {
  const pieces: (Uint8Array | string)[] = [];
  let bytes: number[] = [];
  const flush = (): void => {
    if (bytes.length > 0) pieces.push(Uint8Array.from(bytes));
    bytes = [];
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x25 && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (code < 0x80) {
      bytes.push(code);
    } else {
      // Raw non-ASCII in an extended value is invalid (§4); keep the character itself.
      flush();
      const cp = text.codePointAt(i)!;
      pieces.push(String.fromCodePoint(cp));
      if (cp > 0xffff) i++;
    }
  }
  flush();
  return pieces;
}

interface Piece {
  index: number;
  extended: boolean;
  value: string;
}

/** Assembles RFC 2231 continuations (§3) and extended values (§4) into one decoded string. */
function assemble(pieces: Piece[]): string {
  pieces.sort((a, b) => a.index - b.index);
  let charset = "";
  let out = "";
  let run: Uint8Array[] = [];
  const flush = (): void => {
    if (run.length > 0) out += decodeText(concatBytes(run), charset);
    run = [];
  };
  pieces.forEach((piece, n) => {
    if (!piece.extended) {
      flush();
      out += piece.value;
      return;
    }
    let text = piece.value;
    if (n === 0) {
      // charset'language'value; only the first piece carries them (§4.1).
      const first = text.indexOf("'");
      const second = first < 0 ? -1 : text.indexOf("'", first + 1);
      if (second >= 0) {
        charset = text.slice(0, first);
        text = text.slice(second + 1);
      }
    }
    for (const part of percentDecode(text)) {
      if (typeof part === "string") {
        flush();
        out += part;
      } else {
        run.push(part);
      }
    }
  });
  flush();
  return out;
}

/**
 * Turns raw parameters into a record: names lowercased, RFC 2231 pieces
 * joined and decoded (they take precedence over a plain parameter of the
 * same name, which senders add as a fallback), RFC 2047 words decoded except
 * in "boundary", whose characters may legally look like an encoded-word
 * (RFC 2046 §5.1.1). The first occurrence of a name wins.
 */
function collect(raw: readonly RawParam[]): Record<string, string> {
  const plain = new Map<string, string>();
  const extended = new Map<string, Piece[]>();
  for (const { name, value } of raw) {
    const match = /^(.*?)\*(?:(\d+)(\*)?|)$/.exec(name);
    if (match === null || match[1] === "") {
      if (!plain.has(name)) plain.set(name, value);
      continue;
    }
    const base = match[1]!;
    const index = match[2] === undefined ? 0 : Number(match[2]);
    const isExtended = match[2] === undefined || match[3] === "*";
    const pieces = extended.get(base) ?? [];
    if (!pieces.some((p) => p.index === index)) pieces.push({ index, extended: isExtended, value });
    extended.set(base, pieces);
  }
  const params = new Map<string, string>();
  for (const [name, pieces] of extended) {
    const value = assemble(pieces);
    params.set(name, pieces.some((p) => p.extended) || name === "boundary" ? value : decodeEncodedWords(value));
  }
  for (const [name, value] of plain) {
    if (!params.has(name)) params.set(name, name === "boundary" ? value : decodeEncodedWords(value));
  }
  // Own data properties only, so names like "__proto__" or "constructor" are ordinary keys.
  return Object.fromEntries(params);
}

/**
 * Parses a Content-Type value. The type is lowercased "type/subtype"; an
 * absent or unparseable type means "text/plain" (RFC 2045 §5.2), keeping the
 * parameters that could be read.
 */
export function parseContentType(value: string | null): { type: string; params: Record<string, string> } {
  if (value === null) return { type: "text/plain", params: {} };
  const { head, params } = tokenize(value);
  return { type: MEDIA_TYPE.test(head) ? head : "text/plain", params: collect(params) };
}

/**
 * Parses a Content-Disposition value (RFC 2183 §2). Null when the header is
 * absent; any type other than "inline" counts as "attachment" (§2.8).
 */
export function parseContentDisposition(value: string | null): {
  disposition: "inline" | "attachment" | null;
  params: Record<string, string>;
} {
  if (value === null) return { disposition: null, params: {} };
  const { head, params } = tokenize(value);
  return { disposition: head === "inline" ? "inline" : "attachment", params: collect(params) };
}
