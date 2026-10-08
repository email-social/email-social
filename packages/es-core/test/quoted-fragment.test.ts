/**
 * quotedFragmentOf: the part of the parent a sender singled out by quoting
 * it, as opposed to the whole message every client quotes by default.
 */
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { quotedFragmentOf } from "../src/reply-card.js";
import type { EsMessage } from "../src/types.js";
import { listReplyFixtures, readFixture } from "./helpers/fixtures.js";
import { mid, msg, t } from "./helpers/messages.js";

const parsed = (name: string): EsMessage => parseMessage(readFixture(name));

/** The message every reply fixture answers, in the language of the fixture (see fixtures/README.md). */
const ORIGINAL = {
  en: "Hi Bob,\n\ncould you send me the contract draft by Friday?\n\nThanks,\nAlice",
  enJulien: "Hi Julien,\n\ncan we move the meeting notes review to Thursday?\n\nAlice",
  cs: "Ahoj Karle,\n\npošleš mi prosím fotky z výletu? Chci je dát do alba.\n\nDíky,\nAlice",
  de: "Hallo Anna,\n\nkannst du mir die Projektübersicht bis Freitag schicken?\n\nViele Grüße\nAlice",
  fr: "Bonjour Camille,\n\npeux-tu m'envoyer le compte rendu de la réunion ?\n\nMerci,\nAlice",
};

function originalFor(name: string): string {
  if (/outlook-(web|ios)/.test(name)) return ORIGINAL.enJulien;
  if (/-cs\.eml$/.test(name)) return ORIGINAL.cs;
  if (/-de\.eml$/.test(name)) return ORIGINAL.de;
  if (/-fr\.eml$/.test(name)) return ORIGINAL.fr;
  return ORIGINAL.en;
}

const parent = (text: string, id = "p"): EsMessage => msg({ id: mid(id), from: "Alice <alice@example.com>", date: t(0), subject: "Plan", text });
const reply = (text: string): EsMessage => msg({ id: mid("r"), from: "Bob <bob@example.org>", date: t(5), subject: "Re: Plan", inReplyTo: mid("p"), text });

const PLAN = "Hi Bob,\n\nthe hall is booked for Saturday. Could you bring the projector? The talk starts at 10.\nLunch is at the café next door.\n\nThanks,\nAlice";

describe("quotedFragmentOf: the whole message quoted is no fragment", () => {
  it.each(listReplyFixtures().filter((name) => !["replies/plain-no-quote.eml", "replies/mutt-interleaved.eml", "replies/gmail-long-quote.eml"].includes(name)))(
    "%s quoting the original in full → null",
    (name) => {
      expect(quotedFragmentOf(parsed(name), parent(originalFor(name)))).toBeNull();
    },
  );

  it("the corpus replies quoting their parents in full → null", () => {
    expect(quotedFragmentOf(parsed("gmail-web-reply.eml"), parsed("thunderbird-flowed.eml"))).toBeNull();
    expect(quotedFragmentOf(parsed("ios-mail-reply.eml"), parsed("gmail-web-reply.eml"))).toBeNull();
  });

  it("a quote of the parent together with what the parent itself quoted → null", () => {
    const withQuote = parent("Agreed, see below.\n\nOn 2/3/26 9:00, Bob wrote:\n> Shall we meet on Saturday?");
    expect(quotedFragmentOf(reply("> Agreed, see below.\n> > Shall we meet on Saturday?\n\nGreat."), withQuote)).toBeNull();
    expect(quotedFragmentOf(reply("> Shall we meet on Saturday?\n\nGreat."), withQuote)).toBeNull();
  });

  it("a tail-trimmed quote (the first 30 of 50 lines) → null", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1} of the long plan.`);
    const quoted = lines.slice(0, 30).map((line) => "> " + line).join("\n");
    expect(quotedFragmentOf(reply(`OK.\n\nOn 2/3/26 9:00, Alice wrote:\n${quoted}`), parent(lines.join("\n")))).toBeNull();
  });
});

describe("quotedFragmentOf: a fragment the sender singled out", () => {
  it("one interior sentence → that sentence, quote below the answer or above it", () => {
    expect(quotedFragmentOf(reply("Yes, I'll bring it.\n\nOn 2/3/26 9:00, Alice <alice@example.com> wrote:\n> Could you bring the projector?"), parent(PLAN))).toBe(
      "Could you bring the projector?",
    );
    expect(quotedFragmentOf(reply("> Could you bring the projector?\n\nYes, I'll bring it."), parent(PLAN))).toBe("Could you bring the projector?");
  });

  it("two lines → the two lines joined by one space", () => {
    expect(quotedFragmentOf(reply("> The talk starts at 10.\n> Lunch is at the café next door.\n\nSee you there."), parent(PLAN))).toBe(
      "The talk starts at 10. Lunch is at the café next door.",
    );
  });

  it("a fragment wrapped differently from the parent still matches (white space, NBSP and line breaks collapse)", () => {
    expect(quotedFragmentOf(reply(">  the hall is booked\n> for Saturday.\n\nGreat!"), parent(PLAN))).toBe("the hall is booked for Saturday.");
  });

  it("four quoted lines → null, even inside the parent", () => {
    const four = "> the hall is booked for Saturday.\n> Could you bring the projector?\n> The talk starts at 10.\n> Lunch is at the café next door.\n\nOK";
    expect(quotedFragmentOf(reply(four), parent(PLAN))).toBeNull();
  });

  it("the start of a 2-line parent → the fragment; the start of a 10-line parent → null", () => {
    expect(quotedFragmentOf(reply("> Lunch on Friday?\n\nYes!"), parent("Lunch on Friday?\nOr Saturday?"))).toBe("Lunch on Friday?");
    expect(quotedFragmentOf(reply("> Or Saturday?\n\nNo."), parent("Lunch on Friday?\nOr Saturday?"))).toBe("Or Saturday?");
    const ten = Array.from({ length: 10 }, (_, i) => `Point ${i + 1}.`).join("\n");
    expect(quotedFragmentOf(reply("> Point 1.\n\nOK"), parent(ten))).toBeNull();
    expect(quotedFragmentOf(reply("> Point 10.\n\nOK"), parent(ten))).toBeNull();
    expect(quotedFragmentOf(reply("> Point 5.\n\nOK"), parent(ten))).toBe("Point 5.");
  });

  it("text that is not in the parent → null", () => {
    expect(quotedFragmentOf(reply("> Could you bring the speakers?\n\nNo."), parent(PLAN))).toBeNull();
    expect(quotedFragmentOf(reply("No quote at all."), parent(PLAN))).toBeNull();
  });

  it("an HTML-only parent → null, whatever is quoted", () => {
    const news = parsed("html-only-newsletter.eml");
    expect(news.textSource).toBe("html");
    const line = news.text.split("\n").find((l) => l.trim().length > 20)!;
    expect(quotedFragmentOf(reply(`> ${line.trim()}\n\nNice.`), news)).toBeNull();
    expect(quotedFragmentOf(reply("> Could you bring the projector?\n\nYes."), { ...parent(PLAN), textSource: "html" })).toBeNull();
  });

  it("an interleaved reply → null, even when each quoted point is a fragment", () => {
    const interleaved = reply("> Could you bring the projector?\n\nYes.\n\n> The talk starts at 10.\n\nI'll be there at 9.");
    expect(quotedFragmentOf(interleaved, parent(PLAN))).toBeNull();
    expect(quotedFragmentOf(parsed("replies/mutt-interleaved.eml"), parent("Hi Ondřej,\n\ntwo questions:\n1. Does the rotation keep 14 snapshots now?\n2. Can we move the backups to the new disk this week?\n\nThanks,\nAlice"))).toBeNull();
  });

  it("a parent that is itself interleaved: its '>' lines are not part of what it said", () => {
    const mutt = parsed("replies/mutt-interleaved.eml");
    expect(quotedFragmentOf(reply("> Yes, since last night.\n\nGreat, thanks."), mutt)).toBe("Yes, since last night.");
    expect(quotedFragmentOf(reply("> 2. Can we move the backups to the new disk this week?\n\nThursday?"), mutt)).toBeNull();
  });

  it("an Email Social post never quotes, so it has no fragment", () => {
    const post: EsMessage = { ...reply("> Could you bring the projector?\n\nYes."), es: { $type: "es.social.post", author: null, text: "x", via: "bob@example.org", createdAt: t(5), email: { messageId: null, subject: null, inReplyTo: null, references: [], textSha256: null }, requestReceipts: [] } };
    expect(quotedFragmentOf(post, parent(PLAN))).toBeNull();
  });

  it("cuts a long fragment to 140 characters at a word boundary", () => {
    const long = "word ".repeat(60).trim();
    const fragment = quotedFragmentOf(reply(`> ${long}\n\nOK`), parent(`Start.\n${long} and more.\nEnd.`));
    expect(fragment!.length).toBeLessThanOrEqual(140);
    expect(fragment).toMatch(/^word( word)*…$/);
  });

  it("depends only on the two messages: dates and ids play no part", () => {
    const a = reply("> Could you bring the projector?\n\nYes.");
    const later = { ...a, date: t(-500), id: mid("other") };
    expect(quotedFragmentOf(later, parent(PLAN, "zzz"))).toBe(quotedFragmentOf(a, parent(PLAN)));
  });
});
