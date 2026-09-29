/**
 * `did:es` identifiers (spec chapter 1.1), handled as metadata only: format,
 * parse, validate and derive. Nothing here resolves a DID or touches the
 * network.
 *
 *   did:es:<domain>:<local-identifier>
 *
 * - <domain> is a DNS name in canonical form: lowercase LDH labels, IDN
 *   labels in their ASCII "xn--" form (RFC 3492), at most 253 characters.
 * - <local-identifier> is one or more DID Core idchar characters
 *   (ALPHA / DIGIT / "." / "-" / "_" / pct-encoded), no ":".
 *
 * The syntax follows W3C DID Core §3.1 (lowercase method name, idchar in
 * the method-specific id). Only the canonical form is valid, so DIDs can be
 * compared as plain strings: an upper-case domain makes a DID invalid
 * instead of being a second spelling of the same identifier.
 */

import { canonicalAddress, splitAddress } from "./headers/canonical.js";
import { sha256Hex } from "./util/sha256.js";

export const DID_ES_PREFIX = "did:es:";

/** The parts of a did:es identifier. */
export interface EsDid {
  method: "es";
  domain: string;
  localId: string;
}

const LABEL = /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/;
const LOCAL_ID = /^(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})+$/;

function isDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 253) return false;
  return domain.split(".").every((label) => LABEL.test(label));
}

/** Splits and checks a DID; null when it is not a canonical did:es identifier. */
export function parseDid(did: string): EsDid | null {
  if (!did.startsWith(DID_ES_PREFIX)) return null;
  const rest = did.slice(DID_ES_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon < 0) return null;
  const domain = rest.slice(0, colon);
  const localId = rest.slice(colon + 1);
  if (!isDomain(domain) || !LOCAL_ID.test(localId)) return null;
  return { method: "es", domain, localId };
}

/** True when `did` is a canonical did:es identifier. */
export function isValidDid(did: string): boolean {
  return parseDid(did) !== null;
}

/** Builds a DID from a domain (converted to canonical ASCII form) and a local identifier; throws on invalid input. */
export function formatDid(domain: string, localId: string): string {
  const did = DID_ES_PREFIX + toAsciiDomain(domain) + ":" + localId;
  if (!isValidDid(did)) throw new TypeError(`Not a valid did:es identifier: ${JSON.stringify(did)}`);
  return did;
}

/**
 * Derives the default DID of an e-mail address. The domain is the address's
 * domain; the local identifier is the first 32 hex digits (128 bits) of
 * SHA-256 over "<local part>@<ASCII domain>", following the draft's "UUID /
 * hash" wording. The same address always gives the same DID; addresses that
 * differ only in the case of the local part give different DIDs, like
 * contacts do. Throws when the address has no usable DNS domain.
 */
export function deriveDid(address: string): string {
  const parts = splitAddress(canonicalAddress(address));
  if (parts === null) throw new TypeError(`Not an e-mail address: ${JSON.stringify(address)}`);
  const domain = toAsciiDomain(parts.domain);
  return formatDid(domain, sha256Hex(parts.local + "@" + domain).slice(0, 32));
}

/**
 * Lowercases a domain and converts each non-ASCII label to its "xn--" form
 * (RFC 3492 Punycode after NFC normalisation). This is not full UTS #46
 * processing: characters that UTS #46 would map or reject are encoded as
 * they are.
 */
export function toAsciiDomain(domain: string): string {
  return domain
    .normalize("NFC")
    .toLowerCase()
    .split(".")
    .map((label) => (/^[\x00-\x7f]*$/.test(label) ? label : "xn--" + punycodeEncode(label)))
    .join(".");
}

// RFC 3492 §5 parameters.
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digit(d: number): string {
  return String.fromCharCode(d < 26 ? 97 + d : 22 + d);
}

/** RFC 3492 §6.3 encoding of one label (without the "xn--" prefix). */
export function punycodeEncode(label: string): string {
  const input = Array.from(label, (ch) => ch.codePointAt(0)!);
  let output = input.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join("");
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength > 0) output += "-";
  let n = 0x80;
  let delta = 0;
  let bias = 72;
  while (handled < input.length) {
    let m = Number.MAX_SAFE_INTEGER;
    for (const c of input) if (c >= n && c < m) m = c;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of input) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          output += digit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digit(q);
        bias = adapt(delta, handled + 1, handled === basicLength);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}
