/**
 * What the sender wrote now, as opposed to the earlier messages their mail
 * client quoted below or above it, and their signature.
 *
 * Recognised (text/plain, and HTML reduced to text by parseMessage, where
 * <blockquote> lines start with "> "):
 * - lines starting with ">" and the attribution line in front of them,
 *   also wrapped over up to three lines ("On … wrote:", "Dne … napsal(a):",
 *   "Am … schrieb …:", "Le … a écrit :", Gmail's "… odesílatel … napsal:");
 * - Outlook header blocks (From:/Sent:/To:/Subject: and their Czech, German
 *   and French forms), with or without "-----Original Message-----" or a
 *   line of underscores above them; after one, everything is quoted, since
 *   Outlook does not prefix the original;
 * - forwarded-message separators (Gmail, Thunderbird, Apple Mail);
 * - the signature delimiter "-- " (RFC 3676 §4.3; also "--", as webmail
 *   strips the space), a long line of underscores before a list footer, and
 *   a lone mobile signature line ("Sent from my iPhone", "Odesláno z
 *   iPhonu", "Von meinem iPhone gesendet", "Get Outlook for iOS", …).
 *
 * A quote between two things the sender wrote (an interleaved reply) stays
 * in `fresh`, because the answers do not make sense without it. Nothing is
 * dropped: every line of the text ends up in exactly one of the three parts.
 */

import type { EsPart, QuotedSplit } from "./types.js";

// ---------------------------------------------------------------- patterns

/** A quoted line: ">" after at most three spaces (or the U+FEFF iOS Mail writes). */
const QUOTE = /^[ \t﻿]{0,3}>/;

/** Verbs that end an attribution line: en, cs, de, fr, es, it, nl, pt, sv/da/no, pl. */
const ATTRIBUTION_END =
  /(?:\bwrote|\bnapsal(?:a|\(a\)|\/a)?|\bschrieb|\ba écrit|\bescribió|\bha scritto|\bschreef|\bescreveu|\bskrev|\bnapisał(?:a|\(a\))?)\s?:$/iu;

/** "Am … schrieb …:" (German Gmail puts the name after the verb). */
const GERMAN_ATTRIBUTION = /^Am\s.*\bschrieb\b.*:$/u;

/** mutt's other common attribution: "* Name <address> [2026-03-03 10:15]:". */
const MUTT_ATTRIBUTION = /^\* .+ \[\d{4}-\d{2}-\d{2}[^\]]*\]:$/u;

/** How an attribution starts: a lead word, a Czech weekday (Gmail), or a date. */
const ATTRIBUTION_START = /^(?:On|Am|Le|Dne|El|Il|Op|Em|Den|Dnia|po|út|st|čt|pá|so|ne|\d)[\s.,]/iu;

const ORIGINAL_SEPARATOR =
  /^\s*-{2,}\s*(?:original message|původní zpráva|původní e-mail|ursprüngliche nachricht|message d'origine|mensaje original|messaggio originale|oorspronkelijk bericht)\s*-{2,}\s*$/iu;

const FORWARD_SEPARATOR =
  /^\s*-{2,}\s*(?:forwarded message|přeposlaná zpráva|weitergeleitete nachricht|message transféré|mensaje reenviado|messaggio inoltrato|doorgestuurd bericht)\s*-{2,}\s*$/iu;

/** Apple Mail's forward header, in en, cs, de and fr. */
const APPLE_FORWARD = /^\s*(?:begin forwarded message|začátek přeposlané zprávy|anfang der weitergeleiteten nachricht|début du message réexpédié)\s?:\s*$/iu;

/** "From:", "*From:*" (bold, as Gmail renders Outlook's HTML), "De :" (French space before the colon). */
const HEADER_LABEL = /^\s*\*?([^\s:*][^:*]{0,24}?)\s?\*?\s?:\*?(?:\s|$)/u;
const FROM_LABELS = new Set(["from", "od", "von", "de", "van", "da", "från", "fra"]);
const OTHER_LABELS = new Set([
  "sent", "date", "to", "cc", "bcc", "subject", "reply-to",
  "odesláno", "datum", "komu", "kopie", "předmět",
  "gesendet", "an", "betreff",
  "envoyé", "à", "objet",
]);

/** A divider line above an Outlook header block (Outlook on the web, Outlook for iOS). */
const DIVIDER = /^\s*(?:_{8,}|-{8,})\s*$/;

/** A long line of underscores that starts a list footer (Mailman) when no header block follows. */
const FOOTER_DIVIDER = /^\s*_{20,}\s*$/;

/** RFC 3676 §4.3 "-- ", and "--" as written when trailing spaces are stripped. */
const SIGNATURE_DELIMITER = /^--[ \t]?$/;

/** One-line signatures of mobile clients. */
const MOBILE_SIGNATURE =
  /^(?:sent from my \S.*|sent from (?:outlook|mail|yahoo mail|samsung).*|get outlook for (?:ios|android).*|odesláno z (?:iphonu|ipadu|mobilu|mého .*)|odesláno ze .*|von meinem \S+ gesendet.*|gesendet von meinem .*|envoyé de mon .*|envoyé depuis .*)$/iu;

// ---------------------------------------------------------------- line tests

const isBlank = (line: string): boolean => line.trim() === "";
const isQuote = (line: string): boolean => QUOTE.test(line);

function labelOf(line: string): string | null {
  const match = HEADER_LABEL.exec(line);
  return match === null ? null : match[1]!.trim().toLowerCase();
}

/**
 * The number of lines (1–3) of an attribution that ends at line `end`, or 0.
 * The attribution must name a date or an address (a digit or "@"); a wrapped
 * one, or any one when `strict`, must also start like an attribution.
 */
function attributionEndingAt(lines: readonly string[], end: number, strict: boolean): number {
  const last = lines[end]!;
  if (isBlank(last) || isQuote(last)) return 0;
  for (let count = 3; count >= 1; count--) {
    const start = end - count + 1;
    if (start < 0) continue;
    const window = lines.slice(start, end + 1);
    if (window.some((line) => isBlank(line) || isQuote(line))) continue;
    const joined = window.map((line) => line.trim()).join(" ");
    if (joined.length > 300 || !/[\d@]/u.test(joined)) continue;
    const shaped = ATTRIBUTION_END.test(joined) || GERMAN_ATTRIBUTION.test(joined) || MUTT_ATTRIBUTION.test(joined);
    if (!shaped) continue;
    if ((count === 1 && !strict) || ATTRIBUTION_START.test(joined)) return count;
  }
  return 0;
}

/** Line index where an attribution ending at `end` starts, or -1. */
function attributionStart(lines: readonly string[], end: number, strict = false): number {
  const count = attributionEndingAt(lines, end, strict);
  return count === 0 ? -1 : end - count + 1;
}

/** Whether an Outlook-style header block (a From label and two more labels) starts at line `i`. */
function headerBlockAt(lines: readonly string[], i: number): boolean {
  const first = labelOf(lines[i]!);
  if (first === null || !FROM_LABELS.has(first)) return false;
  const seen = new Set<string>();
  for (let j = i + 1; j < lines.length && j <= i + 7; j++) {
    const line = lines[j]!;
    if (isBlank(line)) break;
    const label = labelOf(line);
    if (label !== null && OTHER_LABELS.has(label)) seen.add(label);
  }
  return seen.size >= 2;
}

function nextNonBlank(lines: readonly string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (!isBlank(lines[i]!)) return i;
  return -1;
}

/**
 * Where the rest of the message is quoted: a separator, a header block (with
 * a divider or "Original Message" line above it), or an attribution that is
 * not followed by ">" lines (the original is not prefixed). -1 when none.
 */
function tailStart(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isQuote(line) || isBlank(line)) continue;
    if (ORIGINAL_SEPARATOR.test(line) || FORWARD_SEPARATOR.test(line) || APPLE_FORWARD.test(line)) return i;
    if (headerBlockAt(lines, i)) {
      let start = i;
      let above = start - 1;
      while (above >= 0 && isBlank(lines[above]!)) above--;
      if (above >= 0 && DIVIDER.test(lines[above]!)) start = above;
      return start;
    }
    // Without ">" lines after it, only an attribution that starts like one (On/Dne/Am/Le …) ends the message.
    const begin = attributionStart(lines, i, true);
    if (begin >= 0) {
      const next = nextNonBlank(lines, i + 1);
      if (next === -1 || !isQuote(lines[next]!)) return begin;
    }
  }
  return -1;
}

interface Block {
  start: number;
  /** Index after the last quoted line. */
  end: number;
}

/** Runs of ">" lines (blank lines between them included), each with the attribution in front of it. */
function quoteBlocks(lines: readonly string[], limit: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < limit) {
    if (!isQuote(lines[i]!)) {
      i++;
      continue;
    }
    let end = i + 1;
    for (let j = i + 1; j < limit; j++) {
      if (isQuote(lines[j]!)) end = j + 1;
      else if (!isBlank(lines[j]!)) break;
    }
    let start = i;
    let above = i - 1;
    while (above >= 0 && isBlank(lines[above]!)) above--;
    const previousEnd = blocks.length > 0 ? blocks[blocks.length - 1]!.end : 0;
    if (above >= previousEnd) {
      const attribution = attributionStart(lines, above);
      if (attribution >= previousEnd) start = attribution;
    }
    blocks.push({ start, end });
    i = end;
  }
  return blocks;
}

type Role = "fresh" | "quoted" | "signature";

/** Text of each run of lines with `role`, blank lines at the edges of a run removed, runs separated by a blank line. */
function collect(lines: readonly string[], roles: readonly Role[], role: Role): string {
  const runs: string[][] = [];
  let current: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (roles[i] !== role) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [];
      runs.push(current);
    }
    current.push(lines[i]!);
  }
  const trimmed = runs
    .map((run) => {
      let a = 0;
      let b = run.length;
      while (a < b && isBlank(run[a]!)) a++;
      while (b > a && isBlank(run[b - 1]!)) b--;
      return run.slice(a, b).join("\n");
    })
    .filter((text) => text !== "");
  return trimmed.join("\n\n");
}

/**
 * Splits a message's text into what the sender wrote now (`fresh`), the
 * earlier messages their client quoted (`quoted`) and their signature. When
 * nothing is recognised, everything is `fresh`. An Email Social post is
 * always entirely `fresh`: its text is exactly what its author typed.
 */
export function splitQuoted(message: { text: string; es?: EsPart | null }): QuotedSplit {
  const lines = message.text.replace(/\r\n?/g, "\n").split("\n");
  const roles: Role[] = lines.map(() => "fresh");
  if (message.es?.$type !== "es.social.post") assignRoles(lines, roles);
  return { fresh: collect(lines, roles, "fresh"), quoted: collect(lines, roles, "quoted"), signature: collect(lines, roles, "signature") };
}

function assignRoles(lines: readonly string[], roles: Role[]): void {
  const tail = tailStart(lines);
  const limit = tail === -1 ? lines.length : tail;
  for (let i = limit; i < lines.length; i++) roles[i] = "quoted";

  const blocks = quoteBlocks(lines, limit);
  const inBlock = new Array<boolean>(limit).fill(false);
  for (const block of blocks) for (let i = block.start; i < block.end; i++) inBlock[i] = true;

  // The signature: the last delimiter outside quotes, else a footer divider, else a lone mobile line.
  let signature = -1;
  for (let i = 0; i < limit; i++) if (!inBlock[i] && SIGNATURE_DELIMITER.test(lines[i]!)) signature = i;
  if (signature === -1) {
    for (let i = 0; i < limit; i++) if (!inBlock[i] && FOOTER_DIVIDER.test(lines[i]!)) signature = i;
  }
  let signatureEnd = limit;
  if (signature === -1) {
    let last = -1;
    for (let i = 0; i < limit; i++) if (!inBlock[i] && !isBlank(lines[i]!)) last = i;
    if (last >= 0 && lines[last]!.trim().length <= 80 && MOBILE_SIGNATURE.test(lines[last]!.trim())) {
      signature = last;
      signatureEnd = last + 1;
    }
  }
  const body = signature === -1 ? limit : signature;
  if (signature !== -1) {
    for (let i = signature; i < signatureEnd; i++) if (!inBlock[i]) roles[i] = "signature";
  }

  // Quote blocks: trailing ones are quoted; leading ones too unless the reply is interleaved.
  const freshLine = (i: number): boolean => i < body && !inBlock[i] && !isBlank(lines[i]!);
  const hasFreshBetween = (from: number, to: number): boolean => {
    for (let i = from; i < to; i++) if (freshLine(i)) return true;
    return false;
  };
  const inBody = blocks.filter((block) => block.start < body);
  const interleaved = inBody.some((block) => hasFreshBetween(0, block.start) && hasFreshBetween(block.end, body));
  for (const block of blocks) {
    const quoted =
      block.start >= body ||
      !hasFreshBetween(block.end, body) ||
      (!interleaved && !hasFreshBetween(0, block.start));
    if (quoted) for (let i = block.start; i < block.end; i++) roles[i] = "quoted";
  }
}
