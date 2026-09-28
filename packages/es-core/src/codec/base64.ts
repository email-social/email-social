/**
 * Base64 Content-Transfer-Encoding (RFC 2045 §6.8), written with the
 * standard alphabet and padding, read tolerantly.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const PAD = 0x3d; // "="

/** Value of each alphabet character, -1 for every other code unit below 128. */
const VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charCodeAt(i)] = i;

function valueOf(code: number): number {
  return code < 128 ? VALUES[code]! : -1;
}

/**
 * Encodes bytes as base64, split into lines of `lineLength` characters joined
 * by CRLF, without a trailing line break. RFC 2045 §6.8 limits encoded lines
 * to 76 characters; `lineLength` 0 writes a single line.
 */
export function base64Encode(bytes: Uint8Array, lineLength = 76): string {
  let out = "";
  const full = bytes.length - (bytes.length % 3);
  for (let i = 0; i < full; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - full;
  if (rest === 1) {
    const n = bytes[full]! << 16;
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + "==";
  } else if (rest === 2) {
    const n = (bytes[full]! << 16) | (bytes[full + 1]! << 8);
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + "=";
  }
  if (lineLength <= 0 || out.length <= lineLength) return out;
  const lines: string[] = [];
  for (let i = 0; i < out.length; i += lineLength) lines.push(out.slice(i, i + lineLength));
  return lines.join("\r\n");
}

/** Number of alphabet characters before the first "=", i.e. the significant input. */
function significantCount(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === PAD) break;
    if (valueOf(code) >= 0) count++;
  }
  return count;
}

/** Decoded size: every 4 characters carry 3 bytes, a trailing 2 or 3 carry 1 or 2, a lone 1 carries none. */
export function base64DecodedLength(text: string): number {
  return Math.floor((significantCount(text) * 3) / 4);
}

/**
 * Decodes base64 liberally: characters outside the alphabet (line breaks,
 * whitespace, junk) are ignored as RFC 2045 §6.8 requires, missing padding is
 * tolerated, and decoding stops at the first "=" (the end of the data).
 */
export function base64Decode(text: string): Uint8Array {
  const out = new Uint8Array(base64DecodedLength(text));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length && o < out.length; i++) {
    const code = text.charCodeAt(i);
    if (code === PAD) break;
    const value = valueOf(code);
    if (value < 0) continue;
    acc = ((acc << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
