/**
 * replyCardOf: the quote card a messenger shows above a message that
 * deliberately answers another, and only there. A default reply (every
 * client quotes the whole message) or an Email Social message typed without
 * choosing a target is a continuation and gets no card.
 */
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { quoteForReply } from "../src/reply-quote.js";
import { replyCardOf } from "../src/reply-card.js";
import { topicsOf } from "../src/topics.js";
import { replyTargetOf, serializeMessage } from "../src/serialize.js";
import type { EsMessage, EsReplyToCard } from "../src/types.js";
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
/** The chat being shown holds these messages. */
const chatOf = (...messages: EsMessage[]): ReadonlySet<string> => new Set(messages.map((m) => m.id));

const ALICE = { name: "Alice Dvořáková", address: "alice@example.com" };
const BOB = { name: "Bob Svoboda", address: "bob@example.org" };

/** A reply from Bob to `parent` written by es-core with the parent's threading headers and no quote. */
function replyTo(parent: EsMessage, text = "Díky!"): EsMessage {
  return parseMessage(
    serializeMessage({ from: BOB, to: [ALICE], text, inReplyTo: replyTargetOf(parent) }, { date: "2026-03-20T10:00:00Z", messageId: "<reply-card@example.org>", includeEsPart: false }),
  );
}

/** `message` as an Email Social post, its ES part carrying `replyTo` when given. */
function es(message: EsMessage, replyTo?: EsReplyToCard): EsMessage {
  const email = { messageId: message.refs.messageId, subject: message.subject, inReplyTo: message.refs.inReplyTo[0] ?? null, references: message.refs.references, textSha256: null, topicRoot: null, topicLabel: null, replyTo: replyTo ?? null };
  return { ...message, es: { $type: "es.social.post", author: null, text: message.text, via: message.from!.address, createdAt: message.date!, email, requestReceipts: [] } };
}

describe("replyCardOf: the two fixtures that quote one sentence of their parent", () => {
  it("Gmail web, one interior sentence of the Thunderbird original → a card with that sentence and the sender", () => {
    const original = parsed("thunderbird-flowed.eml");
    const reply = parsed("replies/gmail-web-fragment.eml");
    expect(reply.refs.inReplyTo).toEqual([original.id]);
    expect(replyCardOf(reply, holding(original), { inChat: chatOf(original, reply), self: "alice@example.com" })).toEqual({
      messageId: original.id,
      from: "Alice Dvořáková",
      excerpt: "Jana už říkala, že by šla taky.",
      attachment: null,
      clickable: true,
    });
  });

  it("Outlook desktop, one interior sentence under a Czech header block → a card naming the parent's attachment", () => {
    const original = parsed("gmail-web-attachment.eml");
    const reply = parsed("replies/outlook-desktop-fragment.eml");
    expect(replyCardOf(reply, holding(original), { inChat: chatOf(original, reply), self: "bob@example.org" })).toEqual({
      messageId: original.id,
      from: "Bob Svoboda",
      excerpt: "Podívej se prosím hlavně na článek 4 (termíny plnění).",
      attachment: "Návrh smlouvy 2026.pdf",
      clickable: true,
    });
  });

  it("the same reply quoting one sentence of an HTML-only parent → no card", () => {
    const html = parsed("replies/gmail-quote-html-only.eml");
    expect(html.textSource).toBe("html");
    const reply = { ...parsed("replies/gmail-web-fragment.eml"), refs: { messageId: "<x@example.org>", inReplyTo: [html.id], references: [html.id] } };
    const quoting = { ...reply, text: "OK\n\n> Thanks, the draft is ready.\n" };
    expect(replyCardOf(quoting, holding(html), { inChat: chatOf(html, quoting), self: "alice@example.com" })).toBeNull();
  });
});

describe("replyCardOf: default replies from other clients are continuations (no card)", () => {
  const self = "alice@example.com";

  it("Gmail reply quoting the whole Thunderbird original → null", () => {
    const original = parsed("thunderbird-flowed.eml");
    const reply = parsed("gmail-web-reply.eml");
    expect(replyCardOf(reply, holding(original), { inChat: chatOf(original, reply), self })).toBeNull();
  });

  it("iOS Mail reply quoting the whole Gmail reply (and what it quoted) → null", () => {
    const reply = parsed("ios-mail-reply.eml");
    const held = [parsed("gmail-web-reply.eml"), parsed("thunderbird-flowed.eml")];
    expect(replyCardOf(reply, holding(...held), { inChat: chatOf(...held, reply), self: "bob@example.org" })).toBeNull();
  });

  it("Outlook reply with In-Reply-To only, quoting the whole original → null", () => {
    const original = parsed("outlook-de-original.eml");
    const reply = parsed("outlook-de-reply-in-reply-to-only.eml");
    expect(replyCardOf(reply, holding(original), { inChat: chatOf(original, reply), self: "anna.becker@example.net" })).toBeNull();
  });

  it("a reply with References only (no In-Reply-To), quoting the whole original → null", () => {
    const raw = latin1(readFixture("gmail-web-reply.eml")).replace(/^In-Reply-To: .*\r\n/m, "");
    const reply = parseMessage(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
    const original = parsed("thunderbird-flowed.eml");
    expect(reply.refs.inReplyTo).toEqual([]);
    expect(replyCardOf(reply, holding(original), { inChat: chatOf(original, reply), self })).toBeNull();
  });

  it("replies without any quote → null, whoever the parent is (attachment, HTML-only, own message)", () => {
    for (const parent of [parsed("gmail-web-attachment.eml"), parsed("html-only-newsletter.eml"), parsed("replies/gmail-quote-html-only.eml")]) {
      const reply = replyTo(parent);
      expect(replyCardOf(reply, holding(parent), { inChat: chatOf(parent, reply), self }), parent.id).toBeNull();
    }
    const mine = msg({ id: mid("own"), from: ALICE, to: BOB, date: t(0), subject: "Oběd", text: "Půjdeme na oběd?" });
    const answer = msg({ id: mid("ans"), from: BOB, to: ALICE, date: t(5), subject: "Re: Oběd", inReplyTo: mid("own"), text: "Jo." });
    expect(replyCardOf(answer, holding(mine), { inChat: chatOf(mine, answer), self })).toBeNull();
  });

  it("an interleaved (point by point) reply → null", () => {
    const parent = msg({ id: mid("p"), from: ALICE, to: BOB, date: t(0), subject: "Plan", text: "Hi Bob,\n\nCould you bring the projector?\nThe talk starts at 10.\nLunch is next door.\n\nAlice" });
    const reply = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(5), subject: "Re: Plan", inReplyTo: mid("p"), text: "> Could you bring the projector?\n\nYes.\n\n> The talk starts at 10.\n\nI'll be early." });
    expect(replyCardOf(reply, holding(parent), { inChat: chatOf(parent, reply), self })).toBeNull();
  });
});

describe("replyCardOf: plain messages that quote one point", () => {
  const self = "alice@example.com";
  const parent = msg({ id: mid("p"), from: ALICE, to: BOB, date: t(0), subject: "Plan", text: "Hi Bob,\n\nthe hall is booked for Saturday. Could you bring the projector? The talk starts at 10.\n\nThanks,\nAlice" });
  const fragmentReply = msg({ id: mid("r"), from: BOB, to: ALICE, date: t(5), subject: "Re: Plan", inReplyTo: mid("p"), text: "Yes, I'll bring it.\n\nOn 2/3/26 9:00, Alice <alice@example.com> wrote:\n> Could you bring the projector?" });

  it("someone else's fragment quote → a card from the parent's sender with the fragment", () => {
    expect(replyCardOf(fragmentReply, holding(parent), { inChat: chatOf(parent, fragmentReply), self })).toEqual({
      messageId: mid("p"),
      from: "Alice Dvořáková",
      excerpt: "Could you bring the projector?",
      attachment: null,
      clickable: true,
    });
  });

  it("a parent outside the chat being shown, or not held at all → null", () => {
    expect(replyCardOf(fragmentReply, holding(parent), { inChat: chatOf(fragmentReply), self })).toBeNull();
    expect(replyCardOf(fragmentReply, none, { inChat: chatOf(parent, fragmentReply), self })).toBeNull();
  });

  it("names the parent's sender by display name, else address, else nothing", () => {
    const card = (from: EsMessage["from"]) => replyCardOf(fragmentReply, holding({ ...parent, from }), { inChat: chatOf(parent, fragmentReply), self });
    expect(card({ name: "", address: "alice@example.com" })).toMatchObject({ from: "alice@example.com" });
    expect(card({ name: "  Alice  ", address: "alice@example.com" })).toMatchObject({ from: "Alice" });
    expect(card(null)).toMatchObject({ from: "" });
  });

  it("prefers In-Reply-To over References when they differ (Outlook writes the root in References)", () => {
    const cs = { ...parsed("outlook-cs-1250.eml"), text: "Potvrzuji.\n\n> v příloze posílám opravenou „fakturu“ za únor\n" };
    const answered = msg({ id: cs.refs.inReplyTo[0]!, from: "Petr Novák <petr.novak@example.org>", date: t(0), subject: "RE: Faktura za únor", text: "Dobrý den,\nv příloze posílám opravenou „fakturu“ za únor, doplnil jsem IČO.\nPetr Novák" });
    const root = msg({ id: cs.refs.references[0]!, from: "Marie Svobodová <marie.svobodova@example.com>", date: t(-60), subject: "Faktura za únor", text: "Kořen." });
    expect(replyCardOf(cs, holding(answered, root), { inChat: chatOf(answered, root, cs), self: "petr.novak@example.org" })).toMatchObject({ messageId: answered.id, from: "Petr Novák" });
    expect(replyCardOf(cs, holding(root), { inChat: chatOf(root, cs), self: "petr.novak@example.org" })).toBeNull();
  });

  it("ignores a reference to the message itself", () => {
    const loop = { ...fragmentReply, refs: { messageId: mid("r"), inReplyTo: [mid("r")], references: [] } };
    expect(replyCardOf(loop, holding(loop, parent), { inChat: chatOf(loop, parent), self })).toBeNull();
  });
});

describe("replyCardOf: the owner's own messages without an ES part (their Sent copies)", () => {
  const self = ["alice@example.com", "alice.d@example.net"];
  const parent = msg({ id: mid("p"), from: BOB, to: ALICE, date: t(0), subject: "Agenda", text: Array.from({ length: 12 }, (_, i) => `${i + 1}. Point ${i + 1} of the agenda.`).join("\n") });

  it("with a 5-line quote (Email Social's deliberate reply) → a card with the start of the quote", () => {
    const text = `Point 3 works for me.\n\n${quoteForReply(parent, { maxLines: 5 })}`;
    const mine = msg({ id: mid("m"), from: ALICE, to: BOB, date: t(5), subject: "Re: Agenda", inReplyTo: mid("p"), text });
    const card = replyCardOf(mine, holding(parent), { inChat: chatOf(parent, mine), self });
    expect(card).toEqual({ messageId: mid("p"), from: "Bob Svoboda", excerpt: "1. Point 1 of the agenda. 2. Point 2 of the agenda. 3. Point 3 of the agenda. 4. Point 4 of the agenda. 5. Point 5 of the agenda. [...]", attachment: null, clickable: true });
    expect(card!.excerpt.length).toBeLessThanOrEqual(140);
  });

  it("a fragment of the parent in the quote → the fragment", () => {
    const mine = msg({ id: mid("m"), from: ALICE, to: BOB, date: t(5), subject: "Re: Agenda", inReplyTo: mid("p"), text: "Yes.\n\n> 7. Point 7 of the agenda." });
    expect(replyCardOf(mine, holding(parent), { inChat: chatOf(parent, mine), self })).toMatchObject({ excerpt: "7. Point 7 of the agenda." });
  });

  it("the whole of a short parent quoted: a card for the owner (an alias too), none for anyone else", () => {
    const short = msg({ id: mid("s"), from: BOB, to: ALICE, date: t(0), subject: "Lunch", text: "Lunch at noon?" });
    const text = `Yes!\n\n${quoteForReply(short, { maxLines: 5 })}`;
    const mine = msg({ id: mid("m"), from: "Alice <alice.d@EXAMPLE.net>", to: BOB, date: t(5), subject: "Re: Lunch", inReplyTo: mid("s"), text });
    const carols = msg({ id: mid("c"), from: "Carol <carol@example.net>", to: BOB, date: t(5), subject: "Re: Lunch", inReplyTo: mid("s"), text });
    expect(replyCardOf(mine, holding(short), { inChat: chatOf(short, mine), self })).toEqual({ messageId: mid("s"), from: "Bob Svoboda", excerpt: "Lunch at noon?", attachment: null, clickable: true });
    expect(replyCardOf(carols, holding(short), { inChat: chatOf(short, carols), self })).toBeNull();
  });

  it("without a quote (a continuation) → null", () => {
    const mine = msg({ id: mid("m"), from: ALICE, to: BOB, date: t(5), subject: "Re: Agenda", inReplyTo: mid("p"), text: "See you there.\n\n-- \nSent with Email Social." });
    expect(replyCardOf(mine, holding(parent), { inChat: chatOf(parent, mine), self })).toBeNull();
  });

  it("a parent outside the chat → null", () => {
    const mine = msg({ id: mid("m"), from: ALICE, to: BOB, date: t(5), subject: "Re: Agenda", inReplyTo: mid("p"), text: `OK\n\n${quoteForReply(parent, { maxLines: 5 })}` });
    expect(replyCardOf(mine, holding(parent), { inChat: chatOf(mine), self })).toBeNull();
  });
});

describe("replyCardOf: Email Social messages", () => {
  const self = "alice@example.com";
  const target = { ...msg({ id: mid("t"), from: ALICE, to: BOB, date: t(0), subject: "Contract", text: "The draft is attached." }), attachments: [{ filename: "draft.pdf", contentType: "application/pdf", disposition: "attachment" as const, size: 10, contentId: null, partId: "2" }] };
  const carried: EsReplyToCard = { messageId: mid("t"), from: { name: "Alice Dvořáková", address: "alice@example.com" }, excerpt: "The draft is attached." };

  it("with replyTo whose target is not in the mailbox → a card from the carried data, not clickable", () => {
    const reply = es(msg({ id: mid("r"), from: BOB, to: ALICE, date: t(5), subject: "Re: Contract", inReplyTo: mid("t"), text: "Signed." }), carried);
    expect(replyCardOf(reply, none, { inChat: chatOf(reply), self })).toEqual({ messageId: null, from: "Alice Dvořáková", excerpt: "The draft is attached.", attachment: null, clickable: false });
  });

  it("with replyTo whose target is held: clickable only in the chat being shown; the attachment comes from the held target", () => {
    const reply = es(msg({ id: mid("r"), from: BOB, to: ALICE, date: t(5), subject: "Re: Contract", text: "Signed." }), carried);
    expect(replyCardOf(reply, holding(target), { inChat: chatOf(target, reply), self })).toEqual({ messageId: mid("t"), from: "Alice Dvořáková", excerpt: "The draft is attached.", attachment: "draft.pdf", clickable: true });
    expect(replyCardOf(reply, holding(target), { inChat: chatOf(reply), self })).toMatchObject({ messageId: mid("t"), clickable: false });
  });

  it("with replyTo naming the sender by address only, or with no Message-ID → still a card", () => {
    const reply = es(msg({ id: mid("r"), from: BOB, to: ALICE, date: t(5), subject: "Re: x", text: "OK" }), { messageId: null, from: { name: "", address: "carol@example.net" }, excerpt: "Hi" });
    expect(replyCardOf(reply, holding(target), { inChat: chatOf(target, reply), self })).toEqual({ messageId: null, from: "carol@example.net", excerpt: "Hi", attachment: null, clickable: false });
  });

  it("without replyTo but with In-Reply-To (a continuation) → null, even with a held parent and a fragment quote", () => {
    const reply = es(msg({ id: mid("r"), from: BOB, to: ALICE, date: t(5), subject: "Re: Contract", inReplyTo: mid("t"), text: "OK\n\n> The draft" }));
    expect(replyCardOf(reply, holding(target), { inChat: chatOf(target, reply), self })).toBeNull();
  });

  it("our own ES message with replyTo → a card too", () => {
    const mine = es(msg({ id: mid("m"), from: ALICE, to: BOB, date: t(5), subject: "Re: Contract", text: "See article 4." }), carried);
    expect(replyCardOf(mine, holding(target), { inChat: chatOf(target, mine), self })).toMatchObject({ messageId: mid("t"), clickable: true });
  });
});

describe("replyCardOf and topicsOf on records written by serializeMessage", () => {
  it("a named root and a deliberate reply in it, parsed back: one named topic and a clickable card", () => {
    const root = parseMessage(
      serializeMessage({ from: ALICE, to: [BOB], subject: "Trip", text: "Shall we take the 7:40 train?", es: { topicRoot: "self", topicLabel: "Trip" } }, { date: "2026-03-03T08:00:00Z", messageId: "<root-2d@example.com>" }),
    );
    const card: EsReplyToCard = { messageId: root.id, from: ALICE, excerpt: "Shall we take the 7:40 train?" };
    const reply = parseMessage(
      serializeMessage(
        { from: BOB, to: [ALICE], subject: "Re: Trip", text: "Yes.", inReplyTo: replyTargetOf(root), es: { topicRoot: root.id, topicLabel: "Trip", replyTo: card } },
        { date: "2026-03-03T08:20:00Z", messageId: "<reply-2d@example.org>" },
      ),
    );
    const continuation = parseMessage(
      serializeMessage({ from: ALICE, to: [BOB], subject: "Re: Trip", text: "Great.", inReplyTo: replyTargetOf(reply), es: { topicRoot: root.id, topicLabel: "Trip" } }, { date: "2026-03-03T08:30:00Z", messageId: "<cont-2d@example.com>" }),
    );
    expect(topicsOf([root, reply, continuation])).toEqual({
      topics: [{ rootId: root.id, label: "Trip", base: "Trip", kind: "named", count: 3 }],
      of: { [root.id]: { rootId: root.id, topicStart: true }, [reply.id]: { rootId: root.id, topicStart: false }, [continuation.id]: { rootId: root.id, topicStart: false } },
    });
    const options = { inChat: chatOf(root, reply, continuation), self: "alice@example.com" };
    expect(replyCardOf(reply, holding(root), options)).toEqual({ messageId: root.id, from: "Alice Dvořáková", excerpt: "Shall we take the 7:40 train?", attachment: null, clickable: true });
    expect(replyCardOf(continuation, holding(root, reply), options)).toBeNull();
    expect(replyCardOf(root, holding(root), options)).toBeNull();
  });
});

describe("replyCardOf: what it leaves out", () => {
  it("an Auto-Submitted message gets no card, whatever it quotes or carries", () => {
    const parent = msg({ id: mid("p"), from: "Alice <alice@example.com>", date: t(0), subject: "Plan", text: "Hi.\nCould you bring the projector?\nThanks." });
    const auto = { ...msg({ id: mid("a"), from: "Bob <bob@example.org>", date: t(1), subject: "Re: Plan", inReplyTo: mid("p"), text: "Away.\n\n> Could you bring the projector?" }), delivery: { listHeaders: [], listId: null, autoSubmitted: "auto-replied", precedence: null, returnPath: null } };
    expect(replyCardOf(auto, holding(parent), { inChat: chatOf(parent, auto), self: "alice@example.com" })).toBeNull();
  });

  it("is deterministic and asks the lookup only for the answered id", () => {
    const asked: string[] = [];
    const original = parsed("thunderbird-flowed.eml");
    const lookup = (id: string): EsMessage | null => {
      asked.push(id);
      return id === original.id ? original : null;
    };
    const reply = parsed("replies/gmail-web-fragment.eml");
    const options = { inChat: chatOf(original, reply), self: "alice@example.com" };
    expect(replyCardOf(reply, lookup, options)).toEqual(replyCardOf(reply, lookup, options));
    expect(new Set(asked)).toEqual(new Set([original.id]));
  });
});
