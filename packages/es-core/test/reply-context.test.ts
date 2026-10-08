/**
 * replyContextOf: the context a messenger shows above a message, as a quote
 * card: the message it answers (sender, excerpt, attachment) when that is
 * held, else the subject when it starts something new or answers something
 * not held.
 */
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { replyContextOf } from "../src/reply-context.js";
import { replyTargetOf, serializeMessage } from "../src/serialize.js";
import type { EsMessage } from "../src/types.js";
import { readFixture } from "./helpers/fixtures.js";
import { mid, msg, t } from "./helpers/messages.js";

const parsed = (name: string): EsMessage => parseMessage(readFixture(name));
const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

/** A lookup over the given messages, by id. */
function holding(...messages: EsMessage[]): (id: string) => EsMessage | null {
  const byId = new Map(messages.map((m) => [m.id, m]));
  return (id) => byId.get(id) ?? null;
}

const none = (): null => null;

const ALICE = { name: "Alice Dvořáková", address: "alice@example.com" };
const BOB = { name: "Bob Svoboda", address: "bob@example.org" };

/** A reply from Bob to `parent`, written by es-core with the parent's threading headers. */
function replyTo(parent: EsMessage, text = "Díky!"): EsMessage {
  return parseMessage(
    serializeMessage({ from: BOB, to: [ALICE], text, inReplyTo: replyTargetOf(parent) }, { date: "2026-03-20T10:00:00Z", messageId: "<reply-ctx@example.org>", includeEsPart: false }),
  );
}

describe("replyContextOf: the parent card, from the Task 1 fixtures", () => {
  it("Gmail reply → the Thunderbird original: sender, the first two lines of what it said cut at 140 characters, no attachment", () => {
    const original = parsed("thunderbird-flowed.eml");
    const context = replyContextOf(parsed("gmail-web-reply.eml"), holding(original));
    expect(context).toEqual({
      kind: "parent",
      messageId: original.id,
      from: "Alice Dvořáková",
      excerpt: "Ahoj Bobe, nechceš v pátek zajít na oběd? Myslela jsem, že bychom mohli zkusit to nové bistro na rohu u nádraží, prý tam mají výborné…",
      attachment: null,
    });
    expect(context?.kind === "parent" && context.excerpt.length).toBeLessThanOrEqual(140);
  });

  it("iOS Mail reply → the Gmail reply: only the parent's fresh text, never what the parent quoted", () => {
    const context = replyContextOf(parsed("ios-mail-reply.eml"), holding(parsed("gmail-web-reply.eml"), parsed("thunderbird-flowed.eml")));
    expect(context).toMatchObject({ kind: "parent", from: "Bob Svoboda", excerpt: "Ahoj Alice, v pátek můžu, 12:30 je super. Zarezervuju stůl pro tři." });
  });

  it("Outlook reply with In-Reply-To only → the Outlook original", () => {
    const original = parsed("outlook-de-original.eml");
    const context = replyContextOf(parsed("outlook-de-reply-in-reply-to-only.eml"), holding(original));
    expect(context).toMatchObject({ kind: "parent", messageId: original.id, from: "Anna Becker" });
    expect(context?.kind === "parent" && context.excerpt).toMatch(/^Hallo Lukas, anbei die Projektübersicht für das zweite Quartal:/);
  });

  it("a reply with References only (no In-Reply-To) → the last References id", () => {
    const raw = latin1(readFixture("gmail-web-reply.eml")).replace(/^In-Reply-To: .*\r\n/m, "");
    const reply = parseMessage(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
    expect(reply.refs.inReplyTo).toEqual([]);
    expect(replyContextOf(reply, holding(parsed("thunderbird-flowed.eml")))).toMatchObject({ kind: "parent", from: "Alice Dvořáková" });
  });

  it("prefers In-Reply-To over References when they differ (Outlook writes the root in References)", () => {
    const cs = parsed("outlook-cs-1250.eml");
    const parent = msg({ id: cs.refs.inReplyTo[0]!, from: "Petr Novák <petr.novak@example.org>", date: t(0), subject: "RE: Faktura za únor", text: "Posílám opravenou fakturu." });
    const root = msg({ id: cs.refs.references[0]!, from: "Marie Svobodová <marie.svobodova@example.com>", date: t(-60), subject: "Faktura za únor", text: "Kořen." });
    expect(replyContextOf(cs, holding(parent, root))).toMatchObject({ kind: "parent", messageId: parent.id, from: "Petr Novák", excerpt: "Posílám opravenou fakturu." });
    expect(replyContextOf(cs, holding(root))).toEqual({ kind: "subject", subject: "Faktura za únor" });
  });

  it("names the parent's first attachment", () => {
    const original = parsed("gmail-web-attachment.eml");
    expect(replyContextOf(replyTo(original), holding(original))).toMatchObject({ kind: "parent", from: "Bob Svoboda", attachment: "Návrh smlouvy 2026.pdf" });
  });

  it("takes the excerpt of an HTML-only parent from its HTML reduced to text", () => {
    const news = parsed("html-only-newsletter.eml");
    expect(news.textSource).toBe("html");
    expect(replyContextOf(replyTo(news), holding(news))).toMatchObject({ kind: "parent", from: "Example Garden Club", excerpt: "March news Hello gardeners," });
    const gmailHtml = parsed("replies/gmail-quote-html-only.eml");
    expect(replyContextOf(replyTo(gmailHtml), holding(gmailHtml))).toMatchObject({ kind: "parent", excerpt: "Thanks, the draft is ready. Bob" });
  });

  it("works for a parent held in any folder: own messages are parents too", () => {
    const mine = msg({ id: mid("own"), from: ALICE, to: BOB, date: t(0), subject: "Oběd", text: "Půjdeme na oběd?" });
    const answer = msg({ id: mid("ans"), from: BOB, to: ALICE, date: t(5), subject: "Re: Oběd", inReplyTo: mid("own"), text: "Jo." });
    expect(replyContextOf(answer, holding(mine))).toEqual({ kind: "parent", messageId: mid("own"), from: "Alice Dvořáková", excerpt: "Půjdeme na oběd?", attachment: null });
  });
});

describe("replyContextOf: the subject card", () => {
  it("Seznam.cz reply whose parent is not held → its subject without Re:/Odp:", () => {
    expect(replyContextOf(parsed("seznam-webmail.eml"), none)).toEqual({ kind: "subject", subject: "Vyúčtování za březen" });
  });

  it("Outlook reply without any thread header → nothing when it continues the previous subject, the subject when it is the first", () => {
    const original = parsed("apple-mail-fr-original.eml");
    const reply = parsed("outlook-fr-reply-no-thread-headers.eml");
    expect(replyContextOf(reply, holding(original), { previous: original })).toBeNull();
    expect(replyContextOf(reply, holding(original))).toEqual({ kind: "subject", subject: "Réunion de lundi" });
  });

  it("Apple Mail forward → the subject without Fwd: when the subject changes", () => {
    const previous = msg({ id: mid("p"), from: BOB, date: t(0), subject: "Oběd v pátek" });
    expect(replyContextOf(parsed("apple-mail-fr-forward.eml"), none, { previous })).toEqual({ kind: "subject", subject: "Réunion de lundi" });
  });

  it("Thunderbird original, first message of its chat → its subject", () => {
    expect(replyContextOf(parsed("thunderbird-flowed.eml"), none)).toEqual({ kind: "subject", subject: "Oběd v pátek" });
  });

  it("a new subject in the middle of a chat → the subject; the same base subject again → nothing", () => {
    const first = msg({ id: mid("1"), from: BOB, date: t(0), subject: "Faktura za únor" });
    const same = msg({ id: mid("2"), from: ALICE, date: t(5), subject: "RE: Faktura za únor" });
    const next = msg({ id: mid("3"), from: BOB, date: t(10), subject: "Víkend na chatě" });
    expect(replyContextOf(same, none, { previous: first })).toBeNull();
    expect(replyContextOf(next, none, { previous: same })).toEqual({ kind: "subject", subject: "Víkend na chatě" });
  });

  it("a reply to a message that is not held shows the subject even when it did not change", () => {
    const previous = msg({ id: mid("1"), from: BOB, date: t(0), subject: "Oběd" });
    const reply = msg({ id: mid("2"), from: BOB, date: t(5), subject: "Re: Oběd", inReplyTo: mid("gone") });
    expect(replyContextOf(reply, none, { previous })).toEqual({ kind: "subject", subject: "Oběd" });
  });

  it("an empty subject gives no card, with or without a missing parent", () => {
    expect(replyContextOf(msg({ id: mid("1"), from: BOB, date: t(0), subject: "" }), none)).toBeNull();
    expect(replyContextOf(msg({ id: mid("2"), from: BOB, date: t(0), subject: "Re: ", inReplyTo: mid("gone") }), none)).toBeNull();
  });

  it("a held parent wins over a subject change", () => {
    const parent = msg({ id: mid("p"), from: BOB, date: t(0), subject: "Oběd", text: "Kdy?" });
    const reply = msg({ id: mid("r"), from: ALICE, date: t(5), subject: "Jiné téma", inReplyTo: mid("p") });
    expect(replyContextOf(reply, holding(parent), { previous: parent })).toMatchObject({ kind: "parent", messageId: mid("p") });
  });
});

describe("replyContextOf: excerpt and sender details", () => {
  const parentWith = (text: string, from: EsMessage["from"] = BOB): EsMessage => ({ ...msg({ id: mid("p"), date: t(0), subject: "S", text }), from });
  const childOf = (): EsMessage => msg({ id: mid("c"), from: ALICE, date: t(5), subject: "Re: S", inReplyTo: mid("p") });
  const excerptOf = (parent: EsMessage): string => {
    const context = replyContextOf(childOf(), holding(parent));
    if (context?.kind !== "parent") throw new Error("no parent card");
    return context.excerpt;
  };

  it("joins the first two non-blank lines and collapses white space", () => {
    expect(excerptOf(parentWith("\n\n  Ahoj   Alice,\n\n\tdorazím\tv deset.\nTřetí řádek.\n"))).toBe("Ahoj Alice, dorazím v deset.");
  });

  it("cuts at a word boundary with … and never exceeds 140 characters", () => {
    const words = "slovo ".repeat(40).trim();
    const excerpt = excerptOf(parentWith(words));
    expect(excerpt.length).toBeLessThanOrEqual(140);
    expect(excerpt.endsWith("slovo…")).toBe(true);
    expect(excerpt.slice(0, -1).split(" ").every((w) => w === "slovo")).toBe(true);
    const long = excerptOf(parentWith("x".repeat(200)));
    expect(long).toBe("x".repeat(139) + "…");
    expect(excerptOf(parentWith("a".repeat(140)))).toBe("a".repeat(140));
  });

  it("leaves out the parent's quotes and signature", () => {
    expect(excerptOf(parentWith("Jo, platí.\n\n-- \nBob\n\nOn Tue, 3 Mar 2026 at 10:15, Alice <alice@example.com> wrote:\n> Platí?"))).toBe("Jo, platí.");
    expect(excerptOf(parentWith("> only a quote"))).toBe("");
  });

  it("names the sender by display name, else address, else nothing", () => {
    const card = (from: EsMessage["from"]) => replyContextOf(childOf(), holding(parentWith("x", from)));
    expect(card({ name: "", address: "bob@example.org" })).toMatchObject({ from: "bob@example.org" });
    expect(card({ name: "  Bob  ", address: "bob@example.org" })).toMatchObject({ from: "Bob" });
    expect(card(null)).toMatchObject({ from: "" });
  });

  it("ignores a reference to the message itself", () => {
    const self = msg({ id: mid("s"), from: BOB, date: t(0), subject: "Ahoj", inReplyTo: mid("s"), text: "x" });
    expect(replyContextOf(self, holding(self))).toEqual({ kind: "subject", subject: "Ahoj" });
  });

  it("is deterministic and asks the lookup only for the answered id", () => {
    const asked: string[] = [];
    const original = parsed("thunderbird-flowed.eml");
    const lookup = (id: string): EsMessage | null => {
      asked.push(id);
      return id === original.id ? original : null;
    };
    const reply = parsed("gmail-web-reply.eml");
    expect(replyContextOf(reply, lookup)).toEqual(replyContextOf(reply, lookup));
    expect(new Set(asked)).toEqual(new Set([original.id]));
  });
});
