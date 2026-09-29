/**
 * The header section of a message (RFC 5322 §2.2): splitting it from the body,
 * unfolding it into fields and looking fields up by name.
 */

import { decodeText } from "../codec/charset.js";
import { concatBytes, latin1Decode } from "../util/bytes.js";

/** One header field. */
export interface HeaderField {
  /** Field name as written. */
  name: string;
  /** Lowercased name, for lookups (field names are case-insensitive, RFC 5322 §1.2.2). */
  key: string;
  /**
   * Unfolded value, leading and trailing white space removed. Raw 8-bit bytes
   * are read as UTF-8 when valid (RFC 6532) else as windows-1252. RFC 2047
   * encoded-words are NOT decoded here.
   */
  value: string;
}

const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;

/** A field line: a name of printable ASCII except ":", optional white space (obsolete syntax, §4.5), ":". */
const FIELD_START = /^([\x21-\x39\x3b-\x7e]+)[ \t]*:/;

/** Index just after the line break of the line starting at `start` (or the input length). */
function nextLine(bytes: Uint8Array, start: number): number {
  const lf = bytes.indexOf(LF, start);
  return lf < 0 ? bytes.length : lf + 1;
}

/** True when the line starting at `start` is empty (just CRLF or LF). */
function isEmptyLine(bytes: Uint8Array, start: number): boolean {
  return bytes[start] === LF || (bytes[start] === CR && bytes[start + 1] === LF);
}

/** True for an mbox envelope line ("From sender date"), which unlike a "From:" field has no colon after the name. */
function isMboxFromLine(bytes: Uint8Array): boolean {
  if (latin1Decode(bytes.subarray(0, 5)) !== "From ") return false;
  let i = 5;
  while (bytes[i] === SPACE || bytes[i] === TAB) i++;
  return bytes[i] !== 0x3a;
}

/**
 * Splits a raw message at the first empty line (CRLF CRLF, LF LF, CRLF LF or
 * LF CRLF). Without an empty line the whole input is header and the body is
 * empty. A leading mbox "From " envelope line is skipped. The header keeps
 * the line break of its last line; the body starts after the empty line.
 */
export function splitHeaderBody(bytes: Uint8Array): { header: Uint8Array; body: Uint8Array } {
  const start = isMboxFromLine(bytes) ? nextLine(bytes, 0) : 0;
  for (let line = start; line < bytes.length; line = nextLine(bytes, line)) {
    if (isEmptyLine(bytes, line)) {
      return { header: bytes.subarray(start, line), body: bytes.subarray(nextLine(bytes, line)) };
    }
  }
  return { header: bytes.subarray(start), body: bytes.subarray(bytes.length) };
}

/**
 * Parses a header section into fields. Folded lines are unfolded by removing
 * the CRLF or LF before white space (§2.2.3). Lines that neither start a
 * field nor continue one are skipped, and so are their continuations.
 */
export function parseHeaderFields(header: Uint8Array): HeaderField[] {
  const fields: HeaderField[] = [];
  let pending: Uint8Array[] | null = null;
  const finish = (): void => {
    if (pending !== null) {
      const unfolded = decodeText(concatBytes(pending), null);
      const match = FIELD_START.exec(unfolded);
      if (match !== null) {
        const name = match[1]!;
        const value = unfolded.slice(match[0].length).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
        fields.push({ name, key: name.toLowerCase(), value });
      }
    }
    pending = null;
  };
  for (let start = 0; start < header.length; ) {
    const next = nextLine(header, start);
    let end = next;
    if (end > start && header[end - 1] === LF) end--;
    if (end > start && header[end - 1] === CR) end--;
    const line = header.subarray(start, end);
    start = next;
    if (line[0] === SPACE || line[0] === TAB) {
      pending?.push(line);
      continue;
    }
    finish();
    // The name is ASCII; test it on the bytes up to the first colon, whatever the value's charset.
    const colon = line.indexOf(0x3a);
    if (colon > 0 && FIELD_START.test(latin1Decode(line.subarray(0, colon + 1)))) pending = [line];
  }
  finish();
  return fields;
}

/** The value of the first field with this name (case-insensitive), or null. */
export function getHeader(fields: readonly HeaderField[], name: string): string | null {
  const key = name.toLowerCase();
  for (const field of fields) if (field.key === key) return field.value;
  return null;
}

/** The values of every field with this name (case-insensitive), in order. */
export function getHeaders(fields: readonly HeaderField[], name: string): string[] {
  const key = name.toLowerCase();
  return fields.filter((field) => field.key === key).map((field) => field.value);
}
