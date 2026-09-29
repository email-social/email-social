import { describe, expect, it } from "vitest";
import { formatFull, formatSize, formatWhen, statusLabel, unreadLabel, withToken } from "../src/format.js";

describe("formatting", () => {
  it("formats sizes", () => {
    expect(formatSize(830)).toBe("830 B");
    expect(formatSize(12_300)).toBe("12 KB");
    expect(formatSize(1_468_006)).toBe("1.4 MB");
  });

  it("shows the time for today and the date otherwise", () => {
    const now = new Date("2026-03-20T18:30:00Z");
    expect(formatWhen("2026-03-20T17:00:00Z", now, "en-GB", "UTC")).toBe("17:00");
    expect(formatWhen("2026-03-18T08:00:00Z", now, "en-GB", "UTC")).toBe("18 Mar");
    expect(formatWhen("2025-12-24T08:00:00Z", now, "en-GB", "UTC")).toBe("24 Dec 2025");
    expect(formatWhen(null, now)).toBe("");
    expect(formatWhen("not a date", now)).toBe("");
    expect(formatFull("2026-03-20T17:00:00Z", "en-GB", "UTC")).toBe("20 March 2026 at 17:00");
  });

  it("describes unread counts and message status in words", () => {
    expect(unreadLabel(1)).toBe("1 unread message");
    expect(unreadLabel(3)).toBe("3 unread messages");
    expect([statusLabel("sent"), statusLabel("delivered"), statusLabel("read"), statusLabel(null)]).toEqual(["Sent", "Delivered", "Read", ""]);
  });

  it("adds the session token to download paths", () => {
    expect(withToken("/api/messages/a/original", "t+k")).toBe("/api/messages/a/original?token=t%2Bk");
    expect(withToken("/x?y=1", "t")).toBe("/x?y=1&token=t");
  });
});
