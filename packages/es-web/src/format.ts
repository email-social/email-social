/** Small formatting helpers for the chat view (no DOM, easy to test). */

/** "12 KB", "1.4 MB", "830 B". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A short time for a message: the time of day for today, otherwise the date.
 * `now`, `locale` and `timeZone` are parameters so the output is testable.
 */
export function formatWhen(iso: string | null, now: Date, locale?: string, timeZone?: string): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const sameDay = day(date) === day(now);
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { timeZone, hour: "2-digit", minute: "2-digit" }
    : { timeZone, day: "numeric", month: "short", ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: "numeric" } : {}) };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** The full date and time, for the title attribute and screen readers. */
export function formatFull(iso: string | null, locale?: string, timeZone?: string): string {
  if (iso === null) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "long", timeStyle: "short" }).format(date);
}

/** "1 unread message", "3 unread messages". */
export function unreadLabel(count: number): string {
  return `${count} unread message${count === 1 ? "" : "s"}`;
}

/** Status of an own message as words (never shown by colour alone). */
export function statusLabel(status: "sent" | "delivered" | "read" | null): string {
  return status === "read" ? "Read" : status === "delivered" ? "Delivered" : status === "sent" ? "Sent" : "";
}

/** A download path with the session token, for links (they cannot send headers). */
export function withToken(path: string, token: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

/**
 * The address in what was typed into the recipient field: "Name <address>"
 * (as suggested from contacts) or a bare address; null when it is not one.
 */
export function parseRecipient(input: string): string | null {
  const text = input.trim();
  const bracketed = /<([^<>]+)>\s*$/.exec(text);
  const address = (bracketed === null ? text : bracketed[1]!).trim();
  return /^[^@\s<>(),;:"\\[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(address) ? address : null;
}

/**
 * The line Email Social adds, in the signature block, to every message it
 * sends as plain e-mail (es-bridge session.ts FOOTER; test/footer.test.ts
 * checks the two are the same).
 */
export const EMAIL_SOCIAL_FOOTER = "Sent with Email Social. Reply as you normally would; this is an ordinary e-mail.";

/** How a topic is named on chips and in menus: its name, else its subject, else "Ongoing chat" (the implicit topic). */
export function topicName(topic: { label: string | null; base: string; kind: "named" | "carrier" | "plain" }): string {
  if (topic.label !== null) return topic.label;
  return topic.kind === "carrier" || topic.base === "" ? "Ongoing chat" : topic.base;
}

/** The start of a message's text for the reply chip: white space collapsed, at most `max` characters. */
export function shortExcerpt(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const room = flat.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return (space > 0 ? room.slice(0, space) : room).trimEnd() + "…";
}
