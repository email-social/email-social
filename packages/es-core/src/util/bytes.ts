/**
 * Byte helpers built on Uint8Array, TextEncoder and TextDecoder only, so the
 * library runs unchanged in browsers (no Node Buffer). A Node Buffer is a
 * Uint8Array and is accepted everywhere a Uint8Array is.
 */

const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");
const utf8StrictDecoder = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 bytes of a string. */
export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Decodes UTF-8, replacing invalid sequences with U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

/** Decodes UTF-8, or returns null when the bytes are not valid UTF-8. */
export function utf8DecodeStrict(bytes: Uint8Array): string | null {
  try {
    return utf8StrictDecoder.decode(bytes);
  } catch {
    return null;
  }
}

/** One character per byte (ISO-8859-1 code points 0–255). */
export function latin1Decode(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

/** Inverse of latin1Decode; code points above 255 are truncated to their low byte. */
export function latin1Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** True when every byte is below 0x80. */
export function isAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i]! >= 0x80) return false;
  return true;
}

/** Concatenates byte arrays. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Accepts the public input forms of a raw message. Strings are taken as already-decoded text and encoded as UTF-8. */
export function toBytes(raw: string | Uint8Array): Uint8Array {
  return typeof raw === "string" ? utf8Encode(raw) : raw;
}
