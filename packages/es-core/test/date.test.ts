import { describe, expect, it } from "vitest";
import { formatDate, parseDate } from "../src/headers/date.js";

describe("parsing Date headers (RFC 5322 §3.3, §4.3)", () => {
  it("parses the standard form and converts to UTC", () => {
    expect(parseDate("Mon, 15 Jan 2024 09:30:00 +0100")).toBe("2024-01-15T08:30:00.000Z");
    expect(parseDate("Fri, 21 Nov 1997 09:55:06 -0600")).toBe("1997-11-21T15:55:06.000Z");
    expect(parseDate("Tue, 1 Jul 2003 10:52:37 +0200")).toBe("2003-07-01T08:52:37.000Z");
    expect(parseDate("Sat, 31 Dec 2022 23:30:00 -0130")).toBe("2023-01-01T01:00:00.000Z");
  });

  it("accepts a missing day of week, a day of week without comma, and missing seconds", () => {
    expect(parseDate("15 Jan 2024 09:30:00 +0000")).toBe("2024-01-15T09:30:00.000Z");
    expect(parseDate("Mon 15 Jan 2024 09:30 +0000")).toBe("2024-01-15T09:30:00.000Z");
    expect(parseDate("Monday, 15 January 2024 09:30:00 +0000")).toBe("2024-01-15T09:30:00.000Z");
    // A wrong or localised day of week is ignored; the date itself decides.
    expect(parseDate("Út, 16 Jan 2024 09:30:00 +0100")).toBe("2024-01-16T08:30:00.000Z");
    expect(parseDate("Fri, 15 Jan 2024 09:30:00 +0000")).toBe("2024-01-15T09:30:00.000Z");
  });

  it("ignores the case of month names, extra whitespace and single-digit fields", () => {
    expect(parseDate("  mon,  5   FEB   2024   7:05:09   +0000  ")).toBe("2024-02-05T07:05:09.000Z");
    expect(parseDate("Thu,\r\n 29 Feb 2024 23:59:59 +0000")).toBe("2024-02-29T23:59:59.000Z");
  });

  it("interprets 2-digit and 3-digit years (§4.3)", () => {
    expect(parseDate("Mon, 15 Jan 24 09:30:00 +0000")).toBe("2024-01-15T09:30:00.000Z");
    expect(parseDate("Wed, 15 Jan 49 09:30:00 +0000")).toBe("2049-01-15T09:30:00.000Z");
    expect(parseDate("Sun, 15 Jan 50 09:30:00 +0000")).toBe("1950-01-15T09:30:00.000Z");
    expect(parseDate("Fri, 15 Jan 99 09:30:00 +0000")).toBe("1999-01-15T09:30:00.000Z");
    expect(parseDate("Sat, 15 Jan 101 09:30:00 +0000")).toBe("2001-01-15T09:30:00.000Z");
  });

  it("understands the obsolete zone names (§4.3)", () => {
    const at = (zone: string): string | null => parseDate(`Mon, 15 Jan 2024 12:00:00 ${zone}`);
    expect(at("GMT")).toBe("2024-01-15T12:00:00.000Z");
    expect(at("UT")).toBe("2024-01-15T12:00:00.000Z");
    expect(at("Z")).toBe("2024-01-15T12:00:00.000Z");
    expect(at("EST")).toBe("2024-01-15T17:00:00.000Z");
    expect(at("EDT")).toBe("2024-01-15T16:00:00.000Z");
    expect(at("CST")).toBe("2024-01-15T18:00:00.000Z");
    expect(at("CDT")).toBe("2024-01-15T17:00:00.000Z");
    expect(at("MST")).toBe("2024-01-15T19:00:00.000Z");
    expect(at("MDT")).toBe("2024-01-15T18:00:00.000Z");
    expect(at("PST")).toBe("2024-01-15T20:00:00.000Z");
    expect(at("pdt")).toBe("2024-01-15T19:00:00.000Z");
  });

  it("treats single-letter and unknown zone names as -0000 (UTC)", () => {
    expect(parseDate("Mon, 15 Jan 2024 12:00:00 A")).toBe("2024-01-15T12:00:00.000Z");
    expect(parseDate("Mon, 15 Jan 2024 12:00:00 CET")).toBe("2024-01-15T12:00:00.000Z");
    expect(parseDate("Mon, 15 Jan 2024 12:00:00")).toBe("2024-01-15T12:00:00.000Z");
  });

  it("ignores comments such as '(CET)' after the zone", () => {
    expect(parseDate("Mon, 15 Jan 2024 09:30:00 +0100 (CET)")).toBe("2024-01-15T08:30:00.000Z");
    expect(parseDate("Mon, 15 Jan 2024 09:30:00 -0800 (Pacific Standard Time)")).toBe("2024-01-15T17:30:00.000Z");
    expect(parseDate("(sent) Mon, 15 Jan 2024 (really) 09:30:00 +0000")).toBe("2024-01-15T09:30:00.000Z");
    // Some generators write the zone name after the offset without parentheses; the offset wins.
    expect(parseDate("Mon, 15 Jan 2024 09:30:00 -0500 EST")).toBe("2024-01-15T14:30:00.000Z");
    expect(parseDate("Mon, 15 Jan 2024 09:30:00 GMT+0100")).toBe("2024-01-15T08:30:00.000Z");
  });

  it("falls back to ISO 8601 as written by some broken senders", () => {
    expect(parseDate("2024-01-15T09:30:00Z")).toBe("2024-01-15T09:30:00.000Z");
    expect(parseDate("2024-01-15T09:30:00+01:00")).toBe("2024-01-15T08:30:00.000Z");
    expect(parseDate("2024-01-15 09:30:00.250-0200")).toBe("2024-01-15T11:30:00.250Z");
    expect(parseDate("2024-01-15T09:30")).toBe("2024-01-15T09:30:00.000Z");
  });

  it("returns null for invalid or out-of-range dates", () => {
    for (const bad of [
      "",
      "yesterday",
      "Mon, 32 Jan 2024 09:30:00 +0000",
      "Thu, 29 Feb 2023 09:30:00 +0000",
      "Mon, 15 Foo 2024 09:30:00 +0000",
      "Mon, 15 Jan 2024 24:00:00 +0000",
      "Mon, 15 Jan 2024 09:60:00 +0000",
      "Mon, 15 Jan 2024 09:30:61 +0000",
      "Mon, 15 Jan 2024 09:30:00 +0199",
      "Mon, 15 Jan 1850 09:30:00 +0000",
      "Mon, 15 Jan 2024",
      "2024-13-01T00:00:00Z",
      "2024-02-30T00:00:00Z",
    ]) {
      expect(parseDate(bad), bad).toBeNull();
    }
  });
});

describe("formatting Date headers", () => {
  it("writes RFC 5322 date-time in UTC", () => {
    expect(formatDate("2024-01-15T08:30:00.000Z")).toBe("Mon, 15 Jan 2024 08:30:00 +0000");
    expect(formatDate(new Date(Date.UTC(2024, 1, 5, 7, 5, 9)))).toBe("Mon, 5 Feb 2024 07:05:09 +0000");
    expect(formatDate("2024-01-15T09:30:00+01:00")).toBe("Mon, 15 Jan 2024 08:30:00 +0000");
  });

  it("round trips through parseDate at second precision", () => {
    for (const iso of ["2000-02-29T00:00:00.000Z", "1999-12-31T23:59:59.000Z", "2038-01-19T03:14:08.000Z", "2024-07-04T12:00:00.000Z"]) {
      expect(parseDate(formatDate(iso))).toBe(iso);
    }
  });

  it("throws RangeError on an invalid date", () => {
    expect(() => formatDate("not a date")).toThrow(RangeError);
    expect(() => formatDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});
