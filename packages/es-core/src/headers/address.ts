/**
 * Address lists (RFC 5322 §3.4, obsolete forms §4.4): reading them liberally
 * from any mailer and writing them so that every reader gets the same names
 * and addresses back.
 */

import { decodeEncodedWords, encodeHeaderValue } from "../codec/encoded-word.js";
import type { EsAddress } from "../types.js";
import { canonicalAddress, splitAddress } from "./canonical.js";

type TokenKind = "word" | "quoted" | "comment" | "angle" | "separator";

interface Token {
  kind: TokenKind;
  /** Decoded content: quotes, parentheses and quoted-pairs removed. */
  text: string;
  /** Source text, used to rebuild an addr-spec such as "john doe"@example.com. */
  raw: string;
  /** Preceded by white space. */
  space: boolean;
}

const WHITESPACE = /[ \t\r\n]/;
/** Characters that end an atom-like word. "@", ".", "[" and "]" stay inside so addr-specs remain one word. */
const WORD_END = /[ \t\r\n"()<>,;:]/;
/** An RFC 2047 encoded-word, read as one word even when it contains ":" or "," (broken Q encoders). */
const ENCODED_WORD = /=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=/y;

/** Reads a quoted-string or comment body starting after its opening character; returns [content, end]. */
function readDelimited(value: string, start: number, close: string, nests: boolean): [string, number] {
  let content = "";
  let depth = 0;
  let i = start;
  for (; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && i + 1 < value.length) {
      content += value[++i];
      continue;
    }
    if (nests && ch === "(") depth++;
    if (ch === close) {
      if (depth === 0) return [content, i + 1];
      depth--;
    }
    content += ch;
  }
  return [content, i];
}

function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  let space = false;
  let i = 0;
  const push = (kind: TokenKind, text: string, end: number): void => {
    tokens.push({ kind, text, raw: value.slice(i, end), space });
    space = false;
    i = end;
  };
  while (i < value.length) {
    const ch = value[i]!;
    if (WHITESPACE.test(ch)) {
      space = true;
      i++;
    } else if (ch === '"') {
      const [text, end] = readDelimited(value, i + 1, '"', false);
      push("quoted", text, end);
    } else if (ch === "(") {
      const [text, end] = readDelimited(value, i + 1, ")", true);
      push("comment", text, end);
    } else if (ch === "<") {
      const close = value.indexOf(">", i + 1);
      const end = close < 0 ? value.length : close + 1;
      push("angle", value.slice(i + 1, close < 0 ? value.length : close), end);
    } else if (ch === "," || ch === ";" || ch === ":") {
      push("separator", ch, i + 1);
    } else if (ch === ">" || ch === ")") {
      i++; // stray closing bracket
    } else {
      let end = i;
      ENCODED_WORD.lastIndex = i;
      if (ENCODED_WORD.test(value)) end = ENCODED_WORD.lastIndex;
      while (end < value.length && !WORD_END.test(value[end]!)) end++;
      push("word", value.slice(i, end), end);
    }
  }
  return tokens;
}

/** Collapses white space runs to one space and trims. */
function collapse(text: string): string {
  return text.replace(/[ \t\r\n]+/g, " ").trim();
}

/**
 * Display name from phrase tokens: quotes removed, encoded-words decoded
 * (also inside quotes, as mailers write them). Comments separate words like
 * white space (RFC 5322 §3.2.2) and are otherwise dropped.
 */
function phraseText(tokens: readonly Token[]): string {
  let joined = "";
  let gap = false;
  for (const token of tokens) {
    if (token.kind === "comment") {
      gap = true;
      continue;
    }
    if (token.kind !== "word" && token.kind !== "quoted") continue;
    if (joined !== "" && (gap || token.space)) joined += " ";
    joined += token.text;
    gap = false;
  }
  return collapse(decodeEncodedWords(joined));
}

/** An addr-spec from angle brackets: source route (§4.4 obs-route), comments and folding white space removed. */
function cleanAddrSpec(raw: string): string {
  const withoutRoute = raw.replace(/^[ \t\r\n]*@[^:"<>]*:/, "");
  let out = "";
  for (let i = 0; i < withoutRoute.length; i++) {
    const ch = withoutRoute[i]!;
    if (ch === '"') {
      const [, end] = readDelimited(withoutRoute, i + 1, '"', false);
      out += withoutRoute.slice(i, end);
      i = end - 1;
    } else if (ch === "(") {
      i = readDelimited(withoutRoute, i + 1, ")", true)[1] - 1;
    } else if (!WHITESPACE.test(ch)) {
      out += ch;
    }
  }
  return out;
}

function toAddress(name: string, rawAddress: string): EsAddress | null {
  const address = canonicalAddress(rawAddress);
  return splitAddress(address) === null ? null : { name, address };
}

/** One mailbox from the tokens between separators. */
function readMailbox(tokens: readonly Token[], out: EsAddress[]): void {
  const comments = tokens.filter((t) => t.kind === "comment");
  const commentName = comments.length > 0 ? collapse(decodeEncodedWords(comments[0]!.text)) : "";
  const angle = tokens.findIndex((t) => t.kind === "angle");
  if (angle >= 0) {
    const name = phraseText(tokens.slice(0, angle)) || commentName;
    const mailbox = toAddress(name, cleanAddrSpec(tokens[angle]!.text));
    if (mailbox !== null) out.push(mailbox);
    return;
  }
  // addr-spec without angle brackets: words not separated by white space form one address.
  const chunks: Token[][] = [];
  for (const token of tokens) {
    if (token.kind === "comment") continue;
    const last = chunks[chunks.length - 1];
    if (last === undefined || token.space) chunks.push([token]);
    else last.push(token);
  }
  const isAddress = (chunk: Token[]): boolean => chunk.some((t) => t.kind === "word" && t.text.includes("@"));
  const addresses = chunks.filter(isAddress);
  if (addresses.length === 1) {
    // "addr (Name)" (§3.4 comment convention), or a name someone forgot to bracket.
    const name = commentName || phraseText(chunks.filter((c) => !isAddress(c)).flat());
    const mailbox = toAddress(name, addresses[0]!.map((t) => t.raw).join(""));
    if (mailbox !== null) out.push(mailbox);
    return;
  }
  // Several bare addresses separated only by spaces.
  for (const chunk of addresses) {
    const mailbox = toAddress("", chunk.map((t) => t.raw).join(""));
    if (mailbox !== null) out.push(mailbox);
  }
}

/**
 * Parses a mailbox-list or address-list. Group members are flattened and
 * group names dropped; ";" also separates entries outside a group (a common
 * typing habit); entries without a usable address are dropped. Names are
 * RFC 2047-decoded (also inside quoted strings), unquoted, with white space
 * collapsed; addresses are canonical (domain lowercased). Never throws.
 */
export function parseAddressList(value: string): EsAddress[] {
  const out: EsAddress[] = [];
  let current: Token[] = [];
  let inGroup = false;
  let afterAngle = false;
  const finish = (): void => {
    if (current.length > 0) readMailbox(current, out);
    current = [];
    afterAngle = false;
  };
  for (const token of tokenize(value)) {
    if (token.kind === "separator") {
      if (token.text === ":") {
        // display-name ":" starts a group (§3.4); its name is not an address.
        if (!inGroup && !afterAngle) {
          inGroup = true;
          current = [];
        }
        continue;
      }
      finish();
      if (token.text === ";") inGroup = false;
      continue;
    }
    // A word after "<addr>" starts the next mailbox when a comma is missing.
    if (afterAngle && token.kind !== "comment") finish();
    current.push(token);
    if (token.kind === "angle") afterAngle = true;
  }
  finish();
  return out;
}

const MAX_LINE = 78;
const ATOM_CHARS = "[^\\s\"(),:;<>@\\[\\]\\\\]+";
/** An addr-spec that reads back unchanged without angle brackets: dot-atom-ish or quoted local part, simple domain. */
const BARE_ADDRESS = new RegExp(`^(?:${ATOM_CHARS}|"(?:[^"\\\\\\r\\n]|\\\\.)*")@${ATOM_CHARS}$`);

function lastLineEnd(text: string, column: number): number {
  const lf = text.lastIndexOf("\n");
  return lf < 0 ? column + text.length : text.length - lf - 1;
}

/** One mailbox written starting at `column`, leaving `reserve` characters (a following comma) on its last line. */
function formatAt(mailbox: EsAddress, column: number, reserve = 0): string {
  const name = collapse(mailbox.name);
  if (name === "") return BARE_ADDRESS.test(mailbox.address) ? mailbox.address : "<" + mailbox.address + ">";
  const phrase = encodeHeaderValue(name, { phrase: true, offset: column });
  const angle = "<" + mailbox.address + ">";
  // The white space before "<" may be folded (RFC 5322 §3.4 name-addr allows CFWS there).
  const fits = lastLineEnd(phrase, column) + 1 + angle.length + reserve <= MAX_LINE;
  return fits ? phrase + " " + angle : phrase + "\r\n " + angle;
}

/**
 * Writes one mailbox: `Name <local@domain>` with the name as an RFC 5322
 * phrase (atoms, a quoted-string, or RFC 2047 encoded-words), or just the
 * address when there is no name.
 */
export function formatAddress(mailbox: EsAddress): string {
  return formatAt(mailbox, 0);
}

/**
 * Writes an address list for a header whose first line already holds
 * `offset` characters ("To: ".length). Items share a line while they fit and
 * are folded after the comma otherwise, so lines stay within 78 characters
 * (RFC 5322 §2.1.1) unless a single address is longer. parseAddressList reads
 * the result back as the same names and addresses, for names without leading,
 * trailing or repeated white space.
 */
export function formatAddressList(list: readonly EsAddress[], offset: number): string {
  let out = "";
  let column = offset;
  list.forEach((mailbox, i) => {
    const reserve = i < list.length - 1 ? 1 : 0;
    if (i === 0) {
      const item = formatAt(mailbox, column, reserve);
      out += item;
      column = lastLineEnd(item, column);
      return;
    }
    const inline = formatAt(mailbox, column + 2, reserve);
    if (!inline.includes("\n") && column + 2 + inline.length + reserve <= MAX_LINE) {
      out += ", " + inline;
      column += 2 + inline.length;
      return;
    }
    const item = formatAt(mailbox, 1, reserve);
    out += ",\r\n " + item;
    column = lastLineEnd(item, 1);
  });
  return out;
}
