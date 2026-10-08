import { describe, expect, it } from "vitest";
import { classifyMessage } from "../src/classify.js";
import { parseMessage } from "../src/parse.js";
import { serializeMessage, serializeReceipt } from "../src/serialize.js";
import { listFixtures, readFixture } from "./helpers/fixtures.js";

/** A small raw message with extra header lines. */
function raw(extra: string[], from = "Bob Svoboda <bob@example.org>"): string {
  return [`From: ${from}`, "To: alice@example.com", "Subject: Hi", "Date: Mon, 2 Mar 2026 10:00:00 +0100", "Message-ID: <c1@example.org>", ...extra, "", "Text", ""].join(
    "\r\n",
  );
}

const kind = (extra: string[], from?: string): string => classifyMessage(parseMessage(raw(extra, from)));

describe("delivery headers in EsMessage", () => {
  it("records the list header fields, the List-Id, Auto-Submitted, Precedence and Return-Path", () => {
    const m = parseMessage(readFixture("mailing-list-footer.eml"));
    expect(m.delivery).toEqual({
      listHeaders: ["list-archive", "list-help", "list-id", "list-post", "list-subscribe", "list-unsubscribe"],
      listId: "dev-list.lists.example.org",
      autoSubmitted: null,
      precedence: "list",
      returnPath: "dev-list-bounces@lists.example.org",
    });
    expect(parseMessage(raw(["Return-Path: <>", "Auto-Submitted: Auto-Replied (vacation); owner-email=\"bob@example.org\""])).delivery).toEqual({
      listHeaders: [],
      listId: null,
      autoSubmitted: "auto-replied",
      precedence: null,
      returnPath: "",
    });
    expect(parseMessage(raw([])).delivery).toEqual({ listHeaders: [], listId: null, autoSubmitted: null, precedence: null, returnPath: null });
  });
});

describe("classifyMessage: person, list or automated, from headers only", () => {
  it("classifies the fixture corpus: the Mailman post and the newsletter are lists, everything else is a person", () => {
    const lists = ["html-only-newsletter.eml", "mailing-list-footer.eml"];
    for (const name of listFixtures()) {
      expect(classifyMessage(parseMessage(readFixture(name))), name).toBe(lists.includes(name) ? "list" : "person");
    }
  });

  it("any RFC 2369 / RFC 2919 List-* field, or Precedence: list, makes a list message", () => {
    for (const field of ["List-Id: <x.example.org>", "List-Post: <mailto:x@example.org>", "List-Unsubscribe: <https://example.org/u>", "List-Help: <mailto:x-request@example.org>", "List-Subscribe: <mailto:x-join@example.org>", "List-Owner: <mailto:x-owner@example.org>", "List-Archive: <https://example.org/a>", "Precedence: LIST"]) {
      expect(kind([field]), field).toBe("list");
    }
    expect(kind(["List-Unsubscribe: <https://example.org/u>", "Precedence: bulk"], "noreply@example.org")).toBe("list");
  });

  it("Auto-Submitted other than 'no' (RFC 3834 §5) makes an automated message", () => {
    expect(kind(["Auto-Submitted: auto-generated"])).toBe("automated");
    expect(kind(["Auto-Submitted: auto-replied; owner-email=bob@example.org"])).toBe("automated");
    expect(kind(["Auto-Submitted: auto-notified"])).toBe("automated");
    expect(kind(["Auto-Submitted: no"])).toBe("person");
    expect(kind(["Auto-Submitted: No (written by a person)"])).toBe("person");
  });

  it("Precedence: bulk or junk and the null Return-Path <> make an automated message", () => {
    expect(kind(["Precedence: bulk"])).toBe("automated");
    expect(kind(["Precedence: junk"])).toBe("automated");
    expect(kind(["Precedence: first-class"])).toBe("person");
    expect(kind(["Return-Path: <>"])).toBe("automated");
    expect(kind(["Return-Path: < >"])).toBe("automated");
    expect(kind(["Return-Path: <bob@example.org>"])).toBe("person");
  });

  it("sender local parts no-reply, noreply, do-not-reply, mailer-daemon and postmaster make an automated message", () => {
    for (const from of ["no-reply@example.org", "NoReply <noreply@example.org>", "do-not-reply@example.org", "donotreply@example.org", "no_reply@example.org", "MAILER-DAEMON@mx.example.net", "Mail Delivery System <mailer-daemon@example.net>", "postmaster@example.net", "noreply+invoices@example.org", "no-reply-billing@example.org"]) {
      expect(kind([], from), from).toBe("automated");
    }
    for (const from of ["reply@example.org", "noreplyguy@example.org", "Postmaster General <karel@example.org>", "info@example.org"]) {
      expect(kind([], from), from).toBe("person");
    }
  });

  it("Email Social receipts are automated, Email Social messages are written by a person", () => {
    const post = serializeMessage(
      { from: { name: "Bob", address: "bob@example.org" }, to: [{ name: "", address: "alice@example.com" }], subject: "Hi", text: "Ahoj", es: { requestReceipts: ["read"] } },
      { date: "2026-03-02T10:00:00Z", messageId: "<p1@example.org>" },
    );
    const receipt = serializeReceipt(
      { kind: "read", from: { name: "Alice", address: "alice@example.com" }, to: { name: "Bob", address: "bob@example.org" }, original: { messageId: "<p1@example.org>" } },
      { date: "2026-03-02T10:05:00Z", messageId: "<r1@example.com>" },
    );
    expect(classifyMessage(parseMessage(post))).toBe("person");
    expect(classifyMessage(parseMessage(receipt))).toBe("automated");
  });
});
