import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { replyTargetOf, serializeMessage, serializeReceipt } from "../src/serialize.js";
import type { EsPostPart, EsReceiptPart } from "../src/types.js";
import { ROUND_TRIP_SEED, expectedAddress, expectedSubject, expectedText, generateCases } from "./helpers/generate.js";

const cases = generateCases(ROUND_TRIP_SEED, 20);

/** The Date header has whole seconds; createdAt is the same instant. */
function wholeSeconds(date: string | Date): string {
  const d = new Date(date);
  d.setUTCMilliseconds(0);
  return d.toISOString();
}

describe(`round trip: serialise → parse (20 cases, seed ${ROUND_TRIP_SEED})`, () => {
  it("generates the same cases on every run", () => {
    expect(generateCases(ROUND_TRIP_SEED, 20)).toEqual(cases);
    expect(new Set(cases.map((c) => c.out.text)).size).toBeGreaterThan(15);
  });

  it.each(cases.map((c, i) => [i, c] as const))("case %i gives back text, participants and ES fields", (_, { out, options }) => {
    const raw = serializeMessage(out, options);
    const parsed = parseMessage(raw);

    expect(parsed.text).toBe(expectedText(out));
    expect(parsed.textSource).toBe(parsed.text === "" ? "none" : "plain");
    expect(parsed.subject).toBe(expectedSubject(out));
    expect(parsed.from).toEqual(expectedAddress(out.from));
    expect(parsed.to).toEqual(out.to.map(expectedAddress));
    expect(parsed.cc).toEqual((out.cc ?? []).map(expectedAddress));
    expect(parsed.id).toBe(options.messageId);
    expect(parsed.date).toBe(wholeSeconds(options.date));
    expect(parsed.attachments).toEqual([]);

    const parent = out.inReplyTo;
    const references = parent === undefined ? [] : [...(parent.references ?? []), parent.messageId];
    expect(parsed.refs).toEqual({
      messageId: options.messageId,
      inReplyTo: parent === undefined ? [] : [parent.messageId],
      references,
    });

    const es: EsPostPart = {
      $type: "es.social.post",
      author: out.es?.author ?? null,
      text: expectedText(out),
      via: expectedAddress(out.from).address,
      createdAt: wholeSeconds(options.date),
      email: {
        messageId: options.messageId,
        subject: expectedSubject(out),
        inReplyTo: parent?.messageId ?? null,
        references,
        textSha256: null,
        topicRoot: null,
        topicLabel: null,
        replyTo: null,
      },
      requestReceipts: (["delivered", "read"] as const).filter((k) => out.es?.requestReceipts?.includes(k)),
    };
    expect(parsed.es).toEqual(es);
  });

  it("threads a reply built from a parsed message under its parent", () => {
    const first = parseMessage(serializeMessage(cases[0]!.out, cases[0]!.options));
    const reply = parseMessage(
      serializeMessage(
        { from: first.to[0]!, to: [first.from!], text: "ok", inReplyTo: replyTargetOf(first) },
        { date: "2026-03-29T10:00:00Z", messageId: "<reply-1@mail.example.com>" },
      ),
    );
    expect(reply.refs.inReplyTo).toEqual([first.id]);
    expect(reply.refs.references[reply.refs.references.length - 1]).toBe(first.id);
    expect(reply.subject).toBe(/^re:/i.test(first.subject) ? first.subject : ("Re: " + first.subject).trim());
  });
});

describe("round trip: long and plain messages", () => {
  const long = ("Dlouhá zpráva: řádek s textem, který se opakuje. 👋\n").repeat(400); // about 21 kB

  it("a 20 kB message comes back whole; the ES record carries its SHA-256 instead of the text", () => {
    expect(new TextEncoder().encode(long).length).toBeGreaterThan(20_000);
    const parsed = parseMessage(
      serializeMessage(
        { from: { name: "Jana", address: "jana@example.net" }, to: [{ name: "", address: "bob@example.org" }], text: long },
        { date: "2026-03-02T09:00:00Z", messageId: "<long-1@mail.example.net>" },
      ),
    );
    expect(parsed.text).toBe(long);
    expect(parsed.es).toMatchObject({
      $type: "es.social.post",
      text: null,
      via: "jana@example.net",
      email: { messageId: "<long-1@mail.example.net>", textSha256: createHash("sha256").update(long, "utf8").digest("hex") },
    });
  });

  it.each(cases.slice(0, 5).map((c, i) => [i, c] as const))(
    "case %i without the ES part gives back text, participants and subject, and es is null",
    (_, { out, options }) => {
      const parsed = parseMessage(serializeMessage(out, { ...options, includeEsPart: false }));
      expect(parsed.text).toBe(expectedText(out));
      expect(parsed.subject).toBe(expectedSubject(out));
      expect(parsed.from).toEqual(expectedAddress(out.from));
      expect(parsed.to).toEqual(out.to.map(expectedAddress));
      expect(parsed.es).toBeNull();
      expect(parsed.attachments).toEqual([]);
    },
  );
});

describe("round trip: receipts", () => {
  it.each(["delivered", "read"] as const)("a %s receipt gives back its ES record and threading headers", (kind) => {
    const original = { messageId: "<orig-1@mail.example.com>", references: ["<root@mail.example.com>"], subject: "Oběd v pátek" };
    const raw = serializeReceipt(
      { kind, from: { name: "Bob", address: "bob@Example.ORG" }, to: { name: "Alice", address: "alice@example.com" }, original },
      { date: "2026-03-02T10:15:30Z", messageId: `<receipt-${kind}@mail.example.org>` },
    );
    const parsed = parseMessage(raw);
    const es: EsReceiptPart = {
      $type: "es.social.receipt",
      author: null,
      kind,
      messageId: "<orig-1@mail.example.com>",
      via: "bob@example.org",
      createdAt: "2026-03-02T10:15:30.000Z",
    };
    expect(parsed.es).toEqual(es);
    expect(parsed.subject).toBe((kind === "read" ? "Read: " : "Delivered: ") + "Oběd v pátek");
    expect(parsed.refs.inReplyTo).toEqual(["<orig-1@mail.example.com>"]);
    expect(parsed.refs.references).toEqual(["<root@mail.example.com>", "<orig-1@mail.example.com>"]);
    expect(parsed.from).toEqual({ name: "Bob", address: "bob@example.org" });
    expect(parsed.text).toContain("Oběd v pátek");
  });
});
