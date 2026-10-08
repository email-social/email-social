import { describe, expect, it } from "vitest";
import * as esCore from "../src/index.js";
import {
  ES_MEDIA_TYPE,
  canonicalAddress,
  deriveContacts,
  deriveDid,
  parseMessage,
  replyTargetOf,
  serializeMessage,
  threadMessages,
  type EsMessage,
} from "../src/index.js";
import { readFixture } from "./helpers/fixtures.js";

describe("public API (src/index.ts)", () => {
  it("exports exactly the documented functions and constants", () => {
    expect(Object.keys(esCore).sort()).toEqual([
      "ES_DRAFT_MEDIA_TYPE",
      "ES_MEDIA_TYPE",
      "ES_TEXT_MAX_BYTES",
      "canonicalAddress",
      "carrierSubject",
      "classifyMessage",
      "collapse",
      "deriveContacts",
      "deriveDid",
      "extractPart",
      "formatDid",
      "groupByParticipants",
      "isInterleaved",
      "isValidDid",
      "normalizeSubject",
      "parseDid",
      "parseMessage",
      "quoteForReply",
      "quotedFragmentOf",
      "replyContextOf",
      "replyTargetOf",
      "serializeMessage",
      "serializeReceipt",
      "splitQuoted",
      "subjectKey",
      "threadMessages",
      "topicsOf",
      "unquote",
      "unquotedLines",
    ]);
    expect(ES_MEDIA_TYPE).toBe("application/vnd.email-social.message+json");
  });

  it("runs the README example: parse, thread, reply", () => {
    const messages: EsMessage[] = ["thunderbird-flowed.eml", "gmail-web-reply.eml"].map((name) =>
      parseMessage(readFixture(name)),
    );
    const [conversation] = threadMessages(messages);
    expect(conversation!.messageIds).toEqual(messages.map((m) => m.id));

    const last = messages[1]!;
    const raw = serializeMessage(
      { from: last.to[0]!, to: [last.from!], text: "Platí, v pátek ve 12.", inReplyTo: replyTargetOf(last) },
      { date: "2026-03-02T12:00:00Z", messageId: "<reply-1@mail.example.com>" },
    );
    const reply = parseMessage(raw);
    expect(threadMessages([...messages, reply])).toHaveLength(1);
    expect(reply.es?.$type).toBe("es.social.post");
    expect(deriveContacts([...messages, reply]).map((c) => c.address)).toContain(canonicalAddress(last.from!.address));
    expect(deriveDid(last.from!.address)).toMatch(/^did:es:example\.(com|org|net):[0-9a-f]{32}$/);
  });
});
