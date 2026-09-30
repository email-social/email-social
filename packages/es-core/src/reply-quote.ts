/**
 * The quote Email Social puts below a reply to someone who does not use
 * Email Social, so they can see what is being answered (their client shows
 * no chat history). Email Social users get no quote: their client shows the
 * conversation.
 */

import { splitAddress } from "./headers/canonical.js";
import { splitQuoted } from "./quotes.js";
import type { EsMessage } from "./types.js";

/** Options of `quoteForReply`. */
export interface QuoteOptions {
  /** At most this many quoted lines; the rest is replaced by "> [...]". Default 40. */
  maxLines?: number;
  /** IANA time zone of the date in the attribution line. Default "UTC". */
  timeZone?: string;
}

const WEEKDAYS: Record<string, string> = { Sun: "Sun", Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat" };

/** "Tue, 3 Mar 2026 at 10:15" in the given time zone, or null for no or an invalid date. */
function attributionDate(iso: string | null, timeZone: string): string | null {
  if (iso === null) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${WEEKDAYS[part("weekday")] ?? part("weekday")}, ${part("day")} ${part("month")} ${part("year")} at ${part("hour")}:${part("minute")}`;
}

/**
 * The quote to put below a reply to someone who does not use Email Social:
 * an attribution line ("On Tue, 3 Mar 2026 at 10:15, Name <address> wrote:")
 * and the parent's fresh text (its own quotes and signature left out), each
 * line prefixed with "> " (an empty line with ">"). Returns "" when the
 * parent has no text.
 */
export function quoteForReply(parent: Pick<EsMessage, "from" | "date" | "text" | "es">, options: QuoteOptions = {}): string {
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? 40));
  const split = splitQuoted(parent);
  const body = split.fresh !== "" ? split.fresh : parent.text.replace(/\r\n?/g, "\n").trim();
  if (body === "") return "";
  const from = parent.from;
  const who =
    from === null
      ? "an unknown sender"
      : from.name.trim() === "" || splitAddress(from.name.trim()) !== null
        ? from.address
        : `${from.name.trim()} <${from.address}>`;
  const date = attributionDate(parent.date, options.timeZone ?? "UTC");
  const attribution = date === null ? `${who} wrote:` : `On ${date}, ${who} wrote:`;
  const lines = body.split("\n");
  const shown = lines.length > maxLines ? [...lines.slice(0, maxLines), "[...]"] : lines;
  return [attribution, ...shown.map((line) => (line.trim() === "" ? ">" : `> ${line}`))].join("\n");
}
