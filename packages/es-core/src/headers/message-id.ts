/**
 * Message identifiers (RFC 5322 §3.6.4): msg-id = "<" id-left "@" id-right ">".
 *
 * Extraction is liberal because real headers are not always well formed:
 * whitespace folded into the middle of an id, ids without angle brackets,
 * prose around the id in In-Reply-To ("Your message of ... <id>"), comments.
 * Every id is returned in angle brackets with all whitespace removed.
 */

/** Every msg-id in a header value, in order, duplicates removed. */
export function parseMessageIds(value: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string): void => {
    const id = normalizeMessageId(candidate);
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  if (value.includes("<")) {
    const re = /<([^<>]*)>/g;
    for (let m = re.exec(value); m !== null; m = re.exec(value)) add(m[1]!);
    return ids;
  }
  // No angle brackets at all: accept bare "left@right" tokens.
  const withoutComments = value.replace(/\([^()]*\)/g, " ");
  for (const token of withoutComments.split(/[\s,]+/)) {
    if (token.includes("@")) add(token);
  }
  return ids;
}

/** The first msg-id of a header value, or null. */
export function parseMessageId(value: string): string | null {
  return parseMessageIds(value)[0] ?? null;
}

/** Removes whitespace and ensures angle brackets; null when nothing is left. */
export function normalizeMessageId(value: string): string | null {
  let id = value.replace(/\s+/g, "");
  if (id.startsWith("<")) id = id.slice(1);
  if (id.endsWith(">")) id = id.slice(0, -1);
  if (id === "" || id.includes("<") || id.includes(">")) return null;
  return "<" + id + ">";
}

/** Strict check used before writing an id into a new message: "<left@right>", printable ASCII, no spaces. */
export function isValidMessageId(id: string): boolean {
  return /^<[\x21-\x3b\x3d\x3f-\x7e]+@[\x21-\x3b\x3d\x3f-\x7e]+>$/.test(id) && id.split("@").length === 2;
}
