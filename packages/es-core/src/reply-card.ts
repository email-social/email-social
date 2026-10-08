/**
 * Which message a message deliberately answers, for the quote card a
 * messenger shows above it.
 *
 * Every mail client quotes the whole message it answers by default, so a
 * quote alone says nothing about intent. A sender who wanted to answer one
 * point either uses Email Social (which records the target in its ES part)
 * or cuts the quote down to that point; `quotedFragmentOf` recognises the
 * second.
 */

import { isInterleaved, splitQuoted, unquotedLines } from "./quotes.js";
import type { EsMessage } from "./types.js";
import { collapse, excerpt } from "./util/text.js";

/** A quoted line, as in quotes.ts: ">" after at most three spaces or the U+FEFF iOS Mail writes. */
const QUOTE = /^[ \t﻿]{0,3}>/;

const nonBlank = (lines: readonly string[]): number => lines.filter((line) => line.trim() !== "").length;

/**
 * The fragment of `parent` that `message` quotes, when the sender singled one
 * out; null otherwise. With `s` the lines of the message's quote
 * (`unquotedLines`), `q` those lines collapsed into one, and `p` the parent's
 * fresh text without its own ">" lines, collapsed, the quote is a fragment
 * when all of these hold:
 *
 * - `q` is a part of `p` and not all of it (a default reply quotes it all);
 * - it is at most 3 non-empty lines;
 * - it is neither the start nor the end of `p` (a client that cuts a long
 *   quote keeps its start), unless the parent wrote at most 3 non-empty lines;
 * - the parent's text is not HTML reduced to text (the quote would have been
 *   made from a rendering we do not have);
 * - the reply is not interleaved (a point-by-point answer has a quote per
 *   point, none of them the target).
 *
 * Returns `q` cut to 140 characters at a word boundary. A pure function of
 * the two messages: dates and the order of messages play no part.
 */
export function quotedFragmentOf(message: Pick<EsMessage, "text" | "es" | "textSource">, parent: Pick<EsMessage, "text" | "es" | "textSource">): string | null {
  if (parent.textSource === "html" || isInterleaved(message)) return null;
  const s = unquotedLines(splitQuoted(message).quoted);
  const q = collapse(s.join(" "));
  if (q === "" || nonBlank(s) > 3) return null;
  const own = splitQuoted(parent)
    .fresh.split("\n")
    .filter((line) => !QUOTE.test(line));
  const p = collapse(own.join(" "));
  if (q === p || !p.includes(q)) return null;
  if ((p.startsWith(q) || p.endsWith(q)) && nonBlank(own) > 3) return null;
  return excerpt(q);
}
