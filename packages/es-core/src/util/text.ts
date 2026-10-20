/** Short text helpers shared by the quote, card and topic code. */

/** Any run of white space: `\s` (which in JavaScript includes NBSP U+00A0 and U+FEFF) and, spelled out, NBSP and narrow NBSP U+202F. */
const WHITESPACE = /[\s  ]+/gu;

/** Every run of white space (NBSP and narrow NBSP included) replaced by one space, trimmed. */
export function collapse(text: string): string {
  return text.replace(WHITESPACE, " ").trim();
}

/** The longest excerpt of a quote card, in characters (UTF-16 code units), "…" included. */
export const EXCERPT_MAX = 140;

/**
 * `text` with white space collapsed, cut at the last word boundary that
 * leaves room for "…" so the result is at most `max` characters. A single
 * word longer than that is cut hard, never inside a surrogate pair.
 */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const flat = collapse(text);
  if (flat.length <= max) return flat;
  let room = flat.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  if (space > 0) room = room.slice(0, space);
  else if (/[\ud800-\udbff]$/.test(room)) room = room.slice(0, -1);
  return room.trimEnd() + "…";
}
