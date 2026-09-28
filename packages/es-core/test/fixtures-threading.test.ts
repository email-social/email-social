/**
 * threadMessages over the whole real-world fixture corpus (fixtures/*.eml):
 * reference threading, the subject fallback with localized prefixes,
 * phantom roots, conversation ids and independence from input order.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { threadMessages } from "../src/threading/thread.js";
import type { Conversation, EsMessage } from "../src/types.js";
import { listFixtures, readFixture } from "./helpers/fixtures.js";
import { mulberry32, shuffle } from "./helpers/prng.js";

const ROOT = {
  thunderbird: "<3f2a9c1e-6b4d-4e8a-9f1c-2d7e5b8a0c34@example.com>",
  outlookDe: "<AM0PR07MB62114F2E8A1C3B5D7E9F0A2B4C6D8E0FA@AM0PR07MB6211.eurprd07.prod.outlook.example.com>",
  csPhantom: "<DB9PR08MB6921A0B1C2D3E4F5A6B7C8D9E0F1A2B3C@DB9PR08MB6921.eurprd08.prod.outlook.example.com>",
  appleFr: "<4E7A9C2B-1D3F-4B6A-8E5C-9F0A1B2C3D4E@example.org>",
  appleFrForward: "<9B3D5F7A-2C4E-4F6A-8B0C-1D3E5F7A9B2C@example.org>",
  muttPhantom: "<20260301174512.GB4411@example.org>",
  seznamPhantom: "<5Mz.Vjx1.2aQwE4tYuIo.1fWb3C@example.net>",
  listPhantom: "<6f1d2c3b-4a5e-4f6d-9c8b-7a6e5d4c3b2a@example.org>",
  esOriginalPhantom: "<es.7f3a9c2e41b8d605@example.com>",
} as const;

const byName = new Map<string, EsMessage>(listFixtures().map((name) => [name, parseMessage(readFixture(name))]));
const all: EsMessage[] = [...byName.values()];
const conversations: Conversation[] = threadMessages(all);

const idOf = (name: string): string => byName.get(name)!.id;
const conversationOf = (name: string, list: readonly Conversation[] = conversations): Conversation => {
  const found = list.find((c) => c.messageIds.includes(idOf(name)));
  if (found === undefined) throw new Error(`no conversation holds ${name}`);
  return found;
};
const expectedConversationId = (rootMessageId: string): string =>
  "conv-" + createHash("sha256").update(rootMessageId, "utf8").digest("hex").slice(0, 32);
const without = (...names: string[]): EsMessage[] => all.filter((m) => !names.some((n) => idOf(n) === m.id));

describe("threading the fixture corpus", () => {
  it("groups the corpus into the expected conversations, most recent first", () => {
    const names = new Map([...byName].map(([name, m]) => [m.id, name]));
    expect(conversations.map((c) => c.messageIds.map((id) => names.get(id)))).toEqual([
      ["undisclosed-recipients.eml"],
      ["gmail-forward-carrying-es-part.eml"],
      ["mailing-list-footer.eml"],
      ["html-only-newsletter.eml"],
      ["mutt-attachment-patch.eml"],
      ["seznam-webmail.eml"],
      ["thunderbird-attachment-rfc2231.eml"],
      ["gmail-web-attachment.eml"],
      ["apple-mail-inline-image.eml"],
      ["outlook-fr-forward.eml"],
      ["apple-mail-fr-forward.eml"],
      ["apple-mail-fr-original.eml", "outlook-fr-reply-no-thread-headers.eml"],
      ["outlook-cs-1250.eml"],
      ["outlook-de-original.eml", "outlook-de-reply-in-reply-to-only.eml"],
      ["mbox-lf-obsolete-date.eml"],
      ["thunderbird-flowed.eml", "gmail-web-reply.eml", "ios-mail-reply.eml"],
      ["mutt-iso-8859-2.eml"],
      ["es-draft-layout.eml"],
    ]);
  });

  it("threads Thunderbird → Gmail → iOS Mail by References into one conversation, in date order", () => {
    const c = conversationOf("thunderbird-flowed.eml");
    expect(c).toEqual({
      id: expectedConversationId(ROOT.thunderbird),
      rootMessageId: ROOT.thunderbird,
      subject: "Oběd v pátek",
      participants: [
        { name: "Alice Dvořáková", address: "alice@example.com" },
        { name: "Bob Svoboda", address: "bob@example.org" },
        { name: "Jana Nováková", address: "jana@example.net" },
      ],
      messageIds: [idOf("thunderbird-flowed.eml"), idOf("gmail-web-reply.eml"), idOf("ios-mail-reply.eml")],
      firstDate: "2026-03-02T09:15:42.000Z",
      lastDate: "2026-03-02T10:20:05.000Z",
    } satisfies Conversation);
  });

  it("threads an Outlook reply that has In-Reply-To but no References", () => {
    const c = conversationOf("outlook-de-reply-in-reply-to-only.eml");
    expect(c.messageIds).toEqual([idOf("outlook-de-original.eml"), idOf("outlook-de-reply-in-reply-to-only.eml")]);
    expect(c.rootMessageId).toBe(ROOT.outlookDe);
    expect(c.id).toBe(expectedConversationId(ROOT.outlookDe));
    expect(c.subject).toBe("Projektübersicht Q2");
    // "Anna.Becker@Example.NET" in the reply is the same participant as the sender of the original.
    expect(c.participants).toEqual([
      { name: "Anna Becker", address: "Anna.Becker@example.net" },
      { name: "Lukas Weber", address: "Lukas.Weber@example.net" },
    ]);
  });

  it("joins a French 'RE :' reply without any threading headers by subject and participants", () => {
    const c = conversationOf("outlook-fr-reply-no-thread-headers.eml");
    expect(c.messageIds).toEqual([idOf("apple-mail-fr-original.eml"), idOf("outlook-fr-reply-no-thread-headers.eml")]);
    expect(c.rootMessageId).toBe(ROOT.appleFr);
    expect(c.id).toBe(expectedConversationId(ROOT.appleFr));
    expect(c.subject).toBe("Réunion de lundi");
    expect(c.participants).toEqual([
      { name: "Amélie Rousseau", address: "amelie@example.org" },
      { name: "Camille Lefèvre", address: "camille@example.org" },
      { name: "Julien Moreau", address: "julien@example.org" },
    ]);
    expect(c.firstDate).toBe("2026-03-04T16:42:09.000Z");
    expect(c.lastDate).toBe("2026-03-05T07:15:27.000Z");
  });

  it("keeps forwards of the same subject to new people ('Fwd:' and 'TR :') in their own conversations", () => {
    const original = conversationOf("apple-mail-fr-original.eml");
    const appleForward = conversationOf("apple-mail-fr-forward.eml");
    const outlookForward = conversationOf("outlook-fr-forward.eml");
    expect(appleForward.messageIds).toEqual([idOf("apple-mail-fr-forward.eml")]);
    expect(outlookForward.messageIds).toEqual([idOf("outlook-fr-forward.eml")]);
    expect(new Set([original.id, appleForward.id, outlookForward.id]).size).toBe(3);
    expect(appleForward.rootMessageId).toBe(ROOT.appleFrForward);
    // Same base subject, different participant sets.
    expect(appleForward.subject).toBe("Réunion de lundi");
    expect(outlookForward.subject).toBe("Réunion de lundi");
  });

  it("roots a reply whose original is not in the mailbox at the first id of its References (phantom root)", () => {
    const c = conversationOf("outlook-cs-1250.eml");
    expect(c.messageIds).toEqual([idOf("outlook-cs-1250.eml")]);
    expect(c.rootMessageId).toBe(ROOT.csPhantom);
    expect(c.id).toBe(expectedConversationId(ROOT.csPhantom));
    expect(c.subject).toBe("Faktura za únor");
    expect(conversationOf("mutt-iso-8859-2.eml").rootMessageId).toBe(ROOT.muttPhantom);
    expect(conversationOf("seznam-webmail.eml").rootMessageId).toBe(ROOT.seznamPhantom);
    expect(conversationOf("mailing-list-footer.eml").rootMessageId).toBe(ROOT.listPhantom);
    expect(conversationOf("gmail-forward-carrying-es-part.eml").rootMessageId).toBe(ROOT.esOriginalPhantom);
  });

  it("strips localized prefixes and list tags from conversation subjects", () => {
    expect(conversationOf("seznam-webmail.eml").subject).toBe("Vyúčtování za březen"); // "Re: Odp: "
    expect(conversationOf("mailing-list-footer.eml").subject).toBe("Release plan"); // "[dev-list] Re: "
    expect(conversationOf("mutt-iso-8859-2.eml").subject).toBe("Zálohování serveru"); // "Re: "
    expect(conversationOf("gmail-forward-carrying-es-part.eml").subject).toBe("Kdy dorazíš?"); // "Fwd: "
  });

  it("gives every conversation an id of the form conv-<32 hex> derived from its root Message-ID", () => {
    for (const c of conversations) {
      expect(c.id).toMatch(/^conv-[0-9a-f]{32}$/);
      expect(c.id).toBe(expectedConversationId(c.rootMessageId));
    }
    expect(new Set(conversations.map((c) => c.id)).size).toBe(conversations.length);
  });

  it("puts every message in exactly one conversation", () => {
    const ids = conversations.flatMap((c) => c.messageIds);
    expect(ids.slice().sort()).toEqual(all.map((m) => m.id).sort());
  });

  it("gives the same conversations for any order of the input (seeded shuffles)", () => {
    for (const seed of [1, 2, 3, 42, 2026]) {
      expect(threadMessages(shuffle(all, mulberry32(seed))), `seed ${seed}`).toEqual(conversations);
    }
  });

  it("ignores messages that appear twice", () => {
    expect(threadMessages([...all, ...shuffle(all, mulberry32(7))])).toEqual(conversations);
  });

  it("keeps the conversation id when the root message is missing from the mailbox", () => {
    const withoutRoot = threadMessages(without("thunderbird-flowed.eml"));
    const c = conversationOf("gmail-web-reply.eml", withoutRoot);
    expect(c.messageIds).toEqual([idOf("gmail-web-reply.eml"), idOf("ios-mail-reply.eml")]);
    expect(c.rootMessageId).toBe(ROOT.thunderbird);
    expect(c.id).toBe(conversationOf("thunderbird-flowed.eml").id);

    const withoutOriginal = threadMessages(without("outlook-de-original.eml"));
    expect(conversationOf("outlook-de-reply-in-reply-to-only.eml", withoutOriginal).id).toBe(
      expectedConversationId(ROOT.outlookDe),
    );
  });

  it("does not merge a subject-fallback reply with same-subject forwards to other people when its original is missing", () => {
    const c = conversationOf("outlook-fr-reply-no-thread-headers.eml", threadMessages(without("apple-mail-fr-original.eml")));
    expect(c.messageIds).toEqual([idOf("outlook-fr-reply-no-thread-headers.eml")]);
    expect(c.subject).toBe("Réunion de lundi");
  });
});
