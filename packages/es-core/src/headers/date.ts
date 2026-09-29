/**
 * Date header values (RFC 5322 §3.3, obsolete forms §4.3). Arithmetic uses
 * Date.UTC only; nothing here reads the current clock.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Obsolete zone names with their offset in minutes (§4.3). */
const ZONES: Record<string, number> = {
  ut: 0,
  utc: 0,
  gmt: 0,
  z: 0,
  est: -5 * 60,
  edt: -4 * 60,
  cst: -6 * 60,
  cdt: -5 * 60,
  mst: -7 * 60,
  mdt: -6 * 60,
  pst: -8 * 60,
  pdt: -7 * 60,
};

/**
 * [day-of-week[,]] day month year hour:minute[:second] [zone], where zone is
 * "+hhmm", a name, or "GMT+hhmm"; a zone name after a numeric offset
 * ("-0500 EST") is ignored. The day of week is not checked against the date
 * and may be in any language (it carries no information the date lacks).
 */
const RFC5322_DATE =
  /^(?:\p{L}+\.?\s*,?\s*)?(\d{1,2})\s*[- ]?\s*([a-z]+)\.?\s*[- ]?\s*(\d{2,4})\s+(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?(?:\s*([+-]\d{2}:?\d{2}(?=\s+[a-z]+$|$)|[a-z]+(?:\s*[+-]\d{2}:?\d{2})?))?(?:\s+[a-z]+)?$/iu;

/** ISO 8601 / RFC 3339, as some broken senders write it. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/** Removes comments, including nested ones, as CFWS (§3.2.2). */
function stripComments(value: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && depth > 0) {
      i++;
    } else if (ch === "(") {
      depth++;
      out += " ";
    } else if (ch === ")" && depth > 0) {
      depth--;
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

function monthIndex(name: string): number {
  const lower = name.toLowerCase();
  const byAbbreviation = MONTHS.indexOf(lower);
  if (byAbbreviation >= 0) return byAbbreviation;
  if (lower === "sept") return 8;
  return MONTH_NAMES.indexOf(lower);
}

/** Offset in minutes of a numeric zone "+hhmm" or "+hh:mm", or null when out of range. */
function numericZone(zone: string): number | null {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (m === null) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 23 || minutes > 59) return null;
  return (m[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

/** Offset in minutes of any zone form; single-letter zones and unknown names ("CET", ...) mean -0000, i.e. UTC (§4.3). */
function zoneOffset(zone: string | undefined): number | null {
  if (zone === undefined) return 0;
  const compact = zone.replace(/\s+/g, "");
  const named = /^([a-z]+)([+-].*)?$/i.exec(compact);
  if (named === null) return numericZone(compact);
  // "GMT+0100" style: the numeric part is the real offset.
  if (named[2] !== undefined) return numericZone(named[2]);
  return ZONES[named[1]!.toLowerCase()] ?? 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function build(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  offsetMinutes: number,
): string | null {
  // RFC 5322 §3.3: "The year is any numeric year 1900 or later"; also keeps Date.UTC away from its 0–99 mapping.
  if (year < 1900 || year > 9999) return null;
  if (month < 0 || month > 11 || day < 1 || day > daysInMonth(year, month)) return null;
  // Second 60 is a leap second (§3.3); Date.UTC carries it into the next minute.
  if (hour > 23 || minute > 59 || second > 60) return null;
  const ms = Date.UTC(year, month, day, hour, minute, second, millisecond) - offsetMinutes * 60_000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRfc5322(value: string): string | null {
  const m = RFC5322_DATE.exec(value);
  if (m === null) return null;
  const month = monthIndex(m[2]!);
  if (month < 0) return null;
  const yearText = m[3]!;
  let year = Number(yearText);
  // §4.3: a 2-digit year is 20xx below 50 and 19xx from 50; a 3-digit year is added to 1900.
  if (yearText.length === 2) year += year < 50 ? 2000 : 1900;
  else if (yearText.length === 3) year += 1900;
  const offset = zoneOffset(m[7]);
  if (offset === null) return null;
  return build(year, month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), 0, offset);
}

function parseIso(value: string): string | null {
  const m = ISO_DATE.exec(value);
  if (m === null) return null;
  const zone = m[8];
  const offset = zone === undefined || zone.toUpperCase() === "Z" ? 0 : numericZone(zone);
  if (offset === null) return null;
  const millisecond = m[7] === undefined ? 0 : Number(m[7].slice(0, 3).padEnd(3, "0"));
  return build(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), millisecond, offset);
}

/**
 * Parses a Date header value into an ISO 8601 UTC string
 * ("2024-01-15T08:30:00.000Z"), or null when it cannot be read or a field is
 * out of range. Accepts the RFC 5322 form and its obsolete variants (§4.3):
 * optional day of week, 2- and 3-digit years, missing seconds, named zones,
 * comments such as "(CET)", and ISO 8601 as a fallback.
 */
export function parseDate(value: string): string | null {
  const text = stripComments(value).replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return parseRfc5322(text) ?? parseIso(text);
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Formats a date as an RFC 5322 date-time in UTC, e.g.
 * "Mon, 15 Jan 2024 08:30:00 +0000" (day without a leading zero, as in the
 * RFC's own examples, Appendix A). Throws RangeError on an invalid date or a
 * year the syntax cannot carry (before 1900 or after 9999).
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const time = d.getTime();
  if (Number.isNaN(time)) throw new RangeError("Invalid date");
  const year = d.getUTCFullYear();
  if (year < 1900 || year > 9999) throw new RangeError("Year out of range for an RFC 5322 date: " + year);
  return (
    `${DAYS[d.getUTCDay()]!}, ${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]!} ${year} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`
  );
}
