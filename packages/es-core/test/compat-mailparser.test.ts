/**
 * Compatibility: every message es-core writes is read by an independent
 * parser (mailparser, the parser most Node mail software uses) with the same
 * plain text and subject. This is the "any client can read it" rule checked
 * against code we did not write.
 */
import { simpleParser, type ParsedMail } from "mailparser";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { serializeMessage, serializeReceipt } from "../src/serialize.js";
import type { EsOutgoing } from "../src/types.js";
import { ROUND_TRIP_SEED, expectedSubject, expectedText, generateCases } from "./helpers/generate.js";

/** mailparser options that keep its output raw: no link detection, no HTML generation from text. */
async function mailparser(raw: string): Promise<ParsedMail> {
  return simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true });
}

/** mailparser gives `undefined` for an empty Subject field. */
function subjectOf(mail: ParsedMail): string {
  return mail.subject ?? "";
}

/**
 * Asserts mailparser's text, with one documented exception: for an EMPTY
 * text/plain part mailparser returns "\n" (it counts the empty line that
 * ends the part's header). RFC 2046 §5.1.1 makes that line part of the
 * header, so the body is empty, which is what es-core returns. Every other
 * text must be exactly equal.
 */
function expectMailparserText(mail: ParsedMail, expected: string): void {
  const text = mail.text ?? "";
  if (expected === "") expect(["", "\n"]).toContain(text);
  else expect(text).toBe(expected);
}

const edgeCases: EsOutgoing[] = [
  { from: { name: "", address: "a@example.com" }, to: [{ name: "", address: "b@example.com" }], text: "" },
  { from: { name: "A", address: "a@example.com" }, to: [{ name: "B", address: "b@example.com" }], subject: "", text: "\n\n\n" },
  {
    from: { name: "Jana Nováková", address: "jana@example.com" },
    to: [{ name: "Élodie", address: "elodie@example.org" }],
    subject: "Příliš žluťoučký kůň úpěl ďábelské ódy — ".repeat(4),
    text: "x".repeat(3000) + "\n" + "ž".repeat(3000) + "\n" + "€ ".repeat(200),
  },
  {
    from: { name: "A", address: "a@example.com" },
    to: [{ name: "B", address: "b@example.com" }],
    subject: "=?utf-8?q?not_encoded?=",
    text: "=?utf-8?q?not_encoded?=\n=20 =3D literal equals signs ==\nFrom the start\n.\n..\n",
  },
  {
    // Over ES_TEXT_MAX_BYTES: the whole text still goes in text/plain.
    from: { name: "Jana", address: "jana@example.net" },
    to: [{ name: "Bob", address: "bob@example.org" }],
    subject: "Dlouhá zpráva",
    text: ("Dlouhá zpráva: řádek s textem, který se opakuje. 👋\n").repeat(400),
  },
];

describe("mailparser reads what es-core writes", () => {
  const cases = generateCases(ROUND_TRIP_SEED, 20);

  it.each(cases.map((c, i) => [i, c] as const))("generated case %i: same text and subject", async (_, { out, options }) => {
    const raw = serializeMessage(out, options);
    const mail = await mailparser(raw);
    expectMailparserText(mail, expectedText(out));
    expect(subjectOf(mail)).toBe(expectedSubject(out));
    // The ES part is an ordinary attachment to any other reader.
    expect(mail.attachments.map((a) => a.contentType)).toEqual(["application/vnd.email-social.message+json"]);
    expect(mail.attachments[0]!.filename).toBe("email-social.json");
    expect(mail.messageId).toBe(options.messageId);
  });

  it.each(edgeCases.map((out, i) => [i, out] as const))("edge case %i: same text and subject", async (i, out) => {
    const raw = serializeMessage(out, { date: "2026-03-02T09:00:00Z", messageId: `<edge-${i}@mail.example.com>` });
    const mail = await mailparser(raw);
    expectMailparserText(mail, expectedText(out));
    expect(subjectOf(mail)).toBe(expectedSubject(out));
    // And both parsers agree with each other.
    const ours = parseMessage(raw);
    expectMailparserText(mail, ours.text);
    expect(ours.subject).toBe(subjectOf(mail));
  });

  it.each(cases.map((c, i) => [i, c] as const))(
    "generated case %i without the ES part: same text and subject, no attachment",
    async (_, { out, options }) => {
      const mail = await mailparser(serializeMessage(out, { ...options, includeEsPart: false }));
      expectMailparserText(mail, expectedText(out));
      expect(subjectOf(mail)).toBe(expectedSubject(out));
      expect(mail.attachments).toEqual([]);
    },
  );

  it.each(["delivered", "read"] as const)("a %s receipt: same text and subject as es-core reads", async (kind) => {
    const raw = serializeReceipt(
      {
        kind,
        from: { name: "Bob", address: "bob@example.org" },
        to: { name: "Alice", address: "alice@example.com" },
        original: { messageId: "<orig@mail.example.com>", subject: "Réunion de lundi" },
      },
      { date: "2026-03-02T09:00:00Z", messageId: `<r-${kind}@mail.example.org>` },
    );
    const mail = await mailparser(raw);
    const ours = parseMessage(raw);
    expectMailparserText(mail, ours.text);
    expect(subjectOf(mail)).toBe(ours.subject);
    expect(mail.headers.get("auto-submitted")).toBe("auto-replied");
  });
});
