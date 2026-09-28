/**
 * Charset decoding for MIME text (RFC 2045 §5.1, RFC 2046 §4.1.2) using the
 * WHATWG Encoding Standard labels that TextDecoder understands in browsers
 * and in Node alike.
 */

import { isAscii, utf8DecodeStrict } from "../util/bytes.js";

/** Labels of US-ASCII (RFC 2046 §4.1.2), the MIME default charset. */
const ASCII_LABELS = new Set(["us-ascii", "ascii", "ansi_x3.4-1968", "iso646-us", "us", "iso-ir-6", "csascii"]);

/**
 * Labels TextDecoder accepts but whose result is useless for mail:
 * "x-user-defined" maps bytes to private-use code points; senders use it to
 * say they do not know the charset.
 */
const TREAT_AS_UNKNOWN = new Set(["x-user-defined"]);

const decoders = new Map<string, TextDecoder | null>();
const windows1252 = new TextDecoder("windows-1252");

function normalizeLabel(label: string): string {
  return label.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
}

function decoderFor(label: string): TextDecoder | null {
  let decoder = decoders.get(label);
  if (decoder !== undefined) return decoder;
  decoder = null;
  if (!TREAT_AS_UNKNOWN.has(label)) {
    try {
      decoder = new TextDecoder(label, { fatal: false });
    } catch {
      // RangeError: not a WHATWG label (e.g. "utf-7", "cp852"), or one mapped to "replacement".
      decoder = null;
    }
  }
  decoders.set(label, decoder);
  return decoder;
}

/** UTF-8 when the bytes are valid UTF-8, else windows-1252 (every byte sequence is valid in it). */
function guess(bytes: Uint8Array): string {
  return utf8DecodeStrict(bytes) ?? windows1252.decode(bytes);
}

/**
 * Decodes text in the given MIME charset.
 *
 * - No label or a US-ASCII label: ASCII bytes are ASCII; 8-bit bytes are read
 *   as UTF-8 when valid, else as windows-1252. Real mail that omits the charset
 *   or claims us-ascii often carries 8-bit text.
 * - A label TextDecoder knows is decoded with it, invalid sequences becoming
 *   U+FFFD. WHATWG maps iso-8859-1 and latin1 to windows-1252, which is what
 *   such senders actually use.
 * - An unknown label falls back to UTF-8 when valid, else windows-1252.
 * - A UTF-8 byte order mark at the start is removed.
 */
export function decodeText(bytes: Uint8Array, charset: string | null | undefined): string {
  const label = normalizeLabel(charset ?? "");
  if (label === "" || ASCII_LABELS.has(label)) {
    if (isAscii(bytes)) return windows1252.decode(bytes);
    return guess(bytes);
  }
  const decoder = decoderFor(label);
  return decoder === null ? guess(bytes) : decoder.decode(bytes);
}

/** True when `decodeText` decodes this label itself instead of guessing. */
export function isSupportedCharset(label: string): boolean {
  const normalized = normalizeLabel(label);
  if (normalized === "") return false;
  return ASCII_LABELS.has(normalized) || decoderFor(normalized) !== null;
}
