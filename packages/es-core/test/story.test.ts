/**
 * Stories (tasks/04, spec section "Stories"): which messages are
 * newsletters shown as stories, and what a client needs to show and
 * unsubscribe from them. storyOf reads only the parsed message.
 */
import { describe, expect, it } from "vitest";
import { classifyMessage } from "../src/classify.js";
import { parseMessage } from "../src/parse.js";
import { STORY_LIFETIME_DAYS, storyOf } from "../src/story.js";
import { writeStory } from "../src/serialize.js";
import type { EsMessage } from "../src/types.js";
import { readFixture } from "./helpers/fixtures.js";

const OWNER = "alice@example.com";

/** A raw message from header lines and a text, CRLF line endings. */
function message(headers: string[], text = "This week: new shoes and a spring sale.\r\n"): EsMessage {
  return parseMessage([...headers, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", text].join("\r\n"));
}

/** A newsletter with the given extra header lines (List-Unsubscribe by default). */
function newsletter(extra: string[] = ["List-Unsubscribe: <https://news.example.org/u/7f3a>"], date = "Tue, 17 Mar 2026 08:00:00 +0000"): EsMessage {
  return message([
    `Date: ${date}`,
    "From: Shoe Shop <news@shop.example.org>",
    `To: Alice <${OWNER}>`,
    "Subject: Spring sale",
    "Message-ID: <n1@shop.example.org>",
    ...extra,
  ]);
}

const week = STORY_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

describe("storyOf: which messages are stories", () => {
  it("a newsletter with List-Unsubscribe is a story: sender, title, received and expiry times", () => {
    expect(storyOf(newsletter(), { self: OWNER })).toEqual({
      sender: { name: "Shoe Shop", address: "news@shop.example.org" },
      title: "Spring sale",
      receivedAt: "2026-03-17T08:00:00.000Z",
      expiresAt: "2026-03-24T08:00:00.000Z",
      unsubscribe: { link: "https://news.example.org/u/7f3a" },
      explicit: false,
    });
  });

  it("is not a story without List-Unsubscribe, even with Precedence: bulk", () => {
    expect(storyOf(newsletter(["Precedence: bulk"]))).toBeNull();
    expect(storyOf(newsletter([]))).toBeNull();
  });

  it("is a story with Precedence: bulk and List-Unsubscribe together", () => {
    expect(storyOf(newsletter(["Precedence: bulk", "List-Unsubscribe: <mailto:leave@shop.example.org>"]))?.unsubscribe).toEqual({
      mailto: "leave@shop.example.org",
      subject: "unsubscribe",
    });
  });

  it("a discussion list (List-Post) is not a story, whatever else it carries", () => {
    const list = newsletter([
      "List-Id: Developers <dev.lists.example.org>",
      "List-Post: <mailto:dev@lists.example.org>",
      "List-Unsubscribe: <mailto:dev-leave@lists.example.org>",
    ]);
    expect(storyOf(list)).toBeNull();
    expect(classifyMessage(list)).toBe("list");
  });

  it("Auto-Submitted other than no is an automated message, not a story, even with List-Unsubscribe", () => {
    for (const keyword of ["auto-generated", "auto-replied", "auto-notified"]) {
      expect(storyOf(newsletter([`Auto-Submitted: ${keyword}`, "List-Unsubscribe: <https://shop.example.org/prefs>"])), keyword).toBeNull();
    }
    expect(storyOf(newsletter(["Auto-Submitted: no", "List-Unsubscribe: <https://shop.example.org/prefs>"]))).not.toBeNull();
  });

  it("a bounce (Return-Path: <>) is never a story", () => {
    expect(storyOf(newsletter(["Return-Path: <>", "List-Unsubscribe: <https://shop.example.org/prefs>"]))).toBeNull();
    expect(storyOf(newsletter(["Return-Path: <bounces@shop.example.org>", "List-Unsubscribe: <https://shop.example.org/prefs>"]))).not.toBeNull();
  });

  it("the account owner's own message is never a story, under any of their addresses", () => {
    const own = message([
      "Date: Tue, 17 Mar 2026 08:00:00 +0000",
      `From: Alice <${OWNER}>`,
      "To: bob@example.org",
      "Subject: My list",
      "List-Unsubscribe: <mailto:leave@example.com>",
    ]);
    expect(storyOf(own, { self: OWNER })).toBeNull();
    expect(storyOf(own, { self: ["alice.work@example.net", "Alice@Example.COM".toLowerCase()] })).toBeNull();
    expect(storyOf(own)).not.toBeNull();
  });

  it("needs a sender and a date: without From or Date there is nothing to show or expire", () => {
    expect(storyOf(message(["Date: Tue, 17 Mar 2026 08:00:00 +0000", "Subject: x", "List-Unsubscribe: <mailto:a@example.org>"]))).toBeNull();
    expect(storyOf(message(["From: news@shop.example.org", "Subject: x", "List-Unsubscribe: <mailto:a@example.org>"]))).toBeNull();
  });

  it("a List-Unsubscribe field without a usable URI still makes a story, without a way to unsubscribe", () => {
    expect(storyOf(newsletter(["List-Unsubscribe: please write to us"]))?.unsubscribe).toBeNull();
    expect(storyOf(newsletter(["List-Unsubscribe: <ftp://shop.example.org/leave>"]))?.unsubscribe).toBeNull();
  });

  it("Email Social receipts and messages from people are not stories", () => {
    expect(storyOf(message(["Date: Tue, 17 Mar 2026 08:00:00 +0000", "From: bob@example.org", "Subject: Lunch"]))).toBeNull();
  });
});

describe("storyOf: title, received and expiry times", () => {
  it("takes the title from the subject without reply and forward prefixes", () => {
    const fwd = message([
      "Date: Tue, 17 Mar 2026 08:00:00 +0000",
      "From: news@shop.example.org",
      "Subject: Fwd: Re: Spring   sale",
      "List-Unsubscribe: <mailto:leave@shop.example.org>",
    ]);
    expect(storyOf(fwd)?.title).toBe("Spring sale");
  });

  it("takes the first non-blank line of the text when the subject is empty", () => {
    const empty = message(
      ["Date: Tue, 17 Mar 2026 08:00:00 +0000", "From: news@shop.example.org", "Subject:", "List-Unsubscribe: <mailto:leave@shop.example.org>"],
      "\r\n   \r\nOur   spring collection is here\r\nSecond line\r\n",
    );
    expect(storyOf(empty)?.title).toBe("Our spring collection is here");
  });

  it("cuts a long first line to 140 characters at a word boundary", () => {
    const long = message(
      ["Date: Tue, 17 Mar 2026 08:00:00 +0000", "From: news@shop.example.org", "List-Unsubscribe: <mailto:leave@shop.example.org>"],
      "word ".repeat(60) + "\r\n",
    );
    const title = storyOf(long)!.title;
    expect(title.length).toBeLessThanOrEqual(140);
    expect(title.endsWith("…")).toBe(true);
  });

  it("expires exactly seven days after the Date, as an instant in UTC", () => {
    const story = storyOf(newsletter(undefined, "Tue, 17 Mar 2026 09:30:15 +0100"))!;
    expect(story.receivedAt).toBe("2026-03-17T08:30:15.000Z");
    expect(Date.parse(story.expiresAt) - Date.parse(story.receivedAt)).toBe(week);
    expect(story.expiresAt).toBe("2026-03-24T08:30:15.000Z");
  });

  it("counts seven days of 24 hours across a daylight saving change", () => {
    const story = storyOf(newsletter(undefined, "Fri, 27 Mar 2026 12:00:00 +0100"))!;
    expect(story.expiresAt).toBe("2026-04-03T11:00:00.000Z");
  });

  it("is deterministic: the same message gives the same story, and nothing else is read", () => {
    const a = newsletter();
    expect(storyOf(a, { self: OWNER })).toEqual(storyOf(structuredClone(a), { self: [OWNER] }));
    expect(storyOf(a)).toEqual(storyOf(a));
  });
});

describe("storyOf: how to unsubscribe (RFC 2369, RFC 8058)", () => {
  const both = "List-Unsubscribe: <mailto:leave@shop.example.org?subject=Stop>, <https://shop.example.org/u/1>";

  it("one-click: List-Unsubscribe-Post: List-Unsubscribe=One-Click with an https URI", () => {
    expect(storyOf(newsletter([both, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"]))?.unsubscribe).toEqual({ oneClick: "https://shop.example.org/u/1" });
  });

  it("with both mailto and https and no List-Unsubscribe-Post, the message is the way (nothing opens a page)", () => {
    expect(storyOf(newsletter([both]))?.unsubscribe).toEqual({ mailto: "leave@shop.example.org", subject: "Stop" });
  });

  it("RFC 8058 needs https: a one-click request for an http URI is not made, the page is offered instead", () => {
    const http = newsletter(["List-Unsubscribe: <http://shop.example.org/u/1>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click"]);
    expect(storyOf(http)?.unsubscribe).toEqual({ link: "http://shop.example.org/u/1" });
    const mailtoOnly = newsletter(["List-Unsubscribe: <mailto:leave@shop.example.org>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click"]);
    expect(storyOf(mailtoOnly)?.unsubscribe).toEqual({ mailto: "leave@shop.example.org", subject: "unsubscribe" });
  });

  it("reads the mailto subject percent-decoded, ignores the body, and never lets a line break through", () => {
    const encoded = newsletter(["List-Unsubscribe: <mailto:leave@Shop.Example.org?body=hello&subject=Unsubscribe%20me%0D%0ABcc:%20eve@example.net>"]);
    expect(storyOf(encoded)?.unsubscribe).toEqual({ mailto: "leave@shop.example.org", subject: "Unsubscribe me Bcc: eve@example.net" });
  });

  it("skips a mailto without a usable address", () => {
    expect(storyOf(newsletter(["List-Unsubscribe: <mailto:?subject=x>, <https://shop.example.org/prefs>"]))?.unsubscribe).toEqual({ link: "https://shop.example.org/prefs" });
  });

  it("reads a folded List-Unsubscribe and a one-click value in any letter case", () => {
    const folded = newsletter(["List-Unsubscribe: <https://shop.example.org/u/", " 2?x=1>, <mailto:leave@shop.example.org>", "List-Unsubscribe-Post: list-unsubscribe=one-click"]);
    expect(folded.delivery.listUnsubscribe).toEqual({ uris: ["https://shop.example.org/u/2?x=1", "mailto:leave@shop.example.org"], oneClick: true });
    expect(storyOf(folded)?.unsubscribe).toEqual({ oneClick: "https://shop.example.org/u/2?x=1" });
  });

  it("records no List-Unsubscribe as null and a missing List-Unsubscribe-Post as no one-click", () => {
    expect(newsletter([]).delivery.listUnsubscribe).toBeNull();
    expect(newsletter().delivery.listUnsubscribe).toEqual({ uris: ["https://news.example.org/u/7f3a"], oneClick: false });
  });
});

describe("storyOf: explicit es.social.story records", () => {
  const base = {
    from: { name: "Shoe Shop", address: "news@shop.example.org" },
    to: [{ name: "Alice", address: OWNER }],
    title: "Spring sale",
    text: "Spring sale: shoes from 20 EUR.\n",
  };
  const options = { date: "2026-03-17T08:00:00Z", messageId: "<story-1@shop.example.org>" };

  it("is a story with explicit: true, the record's title and its unsubscribe address", () => {
    const parsed = parseMessage(writeStory({ ...base, title: "Spring  sale!", unsubscribe: { mailto: "leave@shop.example.org" } }, options));
    expect(parsed.es?.$type).toBe("es.social.story");
    expect(storyOf(parsed, { self: OWNER })).toEqual({
      sender: { name: "Shoe Shop", address: "news@shop.example.org" },
      title: "Spring sale!",
      receivedAt: "2026-03-17T08:00:00.000Z",
      expiresAt: "2026-03-24T08:00:00.000Z",
      unsubscribe: { mailto: "leave@shop.example.org", subject: "unsubscribe" },
      explicit: true,
    });
  });

  it("uses the record's expiresAt when it is earlier than seven days, never later", () => {
    const earlier = parseMessage(writeStory({ ...base, expiresAt: "2026-03-19T12:00:00+01:00" }, options));
    expect(storyOf(earlier)?.expiresAt).toBe("2026-03-19T11:00:00.000Z");
    const later = parseMessage(writeStory({ ...base, expiresAt: "2026-05-01T00:00:00Z" }, options));
    expect(storyOf(later)?.expiresAt).toBe("2026-03-24T08:00:00.000Z");
  });

  it("offers a record's url as a page to open, never as a one-click request", () => {
    const url = parseMessage(writeStory({ ...base, unsubscribe: { url: "https://shop.example.org/prefs" } }, options));
    expect(storyOf(url)?.unsubscribe).toEqual({ link: "https://shop.example.org/prefs" });
  });

  it("is a story without List-Unsubscribe, and Other mail lists it as a list message", () => {
    const plain = parseMessage(writeStory(base, options));
    expect(plain.delivery.listUnsubscribe).toBeNull();
    expect(storyOf(plain)?.explicit).toBe(true);
    expect(classifyMessage(plain)).toBe("list");
  });

  it("is not taken from a record whose via is not the From address (a forward carrying it)", () => {
    const raw = writeStory(base, options).replace("From: Shoe Shop <news@shop.example.org>", "From: Bob <bob@example.org>");
    const forwarded = parseMessage(raw);
    expect(forwarded.es).toBeNull();
    expect(storyOf(forwarded)).toBeNull();
  });

  it("is never the owner's own story", () => {
    const own = parseMessage(writeStory({ ...base, from: { name: "Alice", address: OWNER }, to: [{ name: "", address: "bob@example.org" }] }, options));
    expect(storyOf(own, { self: OWNER })).toBeNull();
  });
});

describe("storyOf on the story fixtures (fixtures/stories/)", () => {
  const story = (name: string) => storyOf(parseMessage(readFixture(`stories/${name}.eml`)), { self: OWNER });

  it("the one-click newsletter: a story with one-click unsubscribe, title from the encoded subject", () => {
    expect(story("newsletter-one-click")).toEqual({
      sender: { name: "Shoe Shop", address: "news@shop.example.org" },
      title: "Spring sale: shoes from 20 €",
      receivedAt: "2026-03-19T07:30:00.000Z",
      expiresAt: "2026-03-26T07:30:00.000Z",
      unsubscribe: { oneClick: "https://shop.example.org/u/7f3a2c?l=spring" },
      explicit: false,
    });
  });

  it("the club newsletter with Precedence: bulk: a story unsubscribed by e-mail with the subject it gives", () => {
    expect(story("newsletter-mailto-bulk")).toEqual({
      sender: { name: "Hiking Club", address: "news@club.example.net" },
      title: "Weekend walks, 21-22 March",
      receivedAt: "2026-03-20T17:05:00.000Z",
      expiresAt: "2026-03-27T17:05:00.000Z",
      unsubscribe: { mailto: "leave@club.example.net", subject: "unsubscribe weekly" },
      explicit: false,
    });
  });

  it("the discussion list, the order confirmation, the password reset and the bounce are not stories", () => {
    for (const name of ["discussion-list", "order-confirmation", "password-reset", "bounce"]) expect(story(name), name).toBeNull();
  });

  it("the eight-day-old newsletter is still a story, which expired on 2026-03-20", () => {
    expect(story("expired-newsletter")?.expiresAt).toBe("2026-03-20T06:00:00.000Z");
  });
});
