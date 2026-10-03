import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { splitQuoted } from "../src/quotes.js";
import { quoteForReply } from "../src/reply-quote.js";
import { serializeMessage } from "../src/serialize.js";
import type { EsMessage } from "../src/types.js";
import { msg } from "./helpers/messages.js";

const lines = (...parts: string[]): string => parts.join("\n");

describe("quoteForReply", () => {
  const parent: EsMessage = {
    ...msg({
      id: "<k1@example.org>",
      from: "Karel Holub <karel@example.org>",
      to: "alice@example.com",
      date: "2026-03-03T09:15:00.000Z",
      subject: "Fotky",
      text: lines("Ahoj Alice,", "", "pošleš fotky?", "", "Karel", "", "-- ", "Karel Holub", "", "On Mon, 2 Mar 2026 at 08:00, Alice <alice@example.com> wrote:", "> older"),
    }),
  };

  it("writes an English attribution line and the parent's fresh text quoted with '> '", () => {
    expect(quoteForReply(parent)).toBe(
      lines("On Tue, 3 Mar 2026 at 09:15, Karel Holub <karel@example.org> wrote:", "> Ahoj Alice,", ">", "> pošleš fotky?", ">", "> Karel"),
    );
  });

  it("writes the date in the given time zone", () => {
    expect(quoteForReply(parent, { timeZone: "Europe/Prague" }).split("\n")[0]).toBe("On Tue, 3 Mar 2026 at 10:15, Karel Holub <karel@example.org> wrote:");
  });

  it("keeps at most maxLines lines and marks the cut", () => {
    const long = { ...parent, text: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") };
    expect(quoteForReply(long, { maxLines: 3 }).split("\n")).toEqual([
      "On Tue, 3 Mar 2026 at 09:15, Karel Holub <karel@example.org> wrote:",
      "> line 1",
      "> line 2",
      "> line 3",
      "> [...]",
    ]);
  });

  it("names the sender by address when there is no name or date, and quotes nothing for an empty parent", () => {
    expect(quoteForReply({ ...parent, from: { name: "", address: "karel@example.org" }, date: null }).split("\n")[0]).toBe("karel@example.org wrote:");
    expect(quoteForReply({ ...parent, from: { name: "karel@example.org", address: "karel@example.org" } }).split("\n")[0]).toBe(
      "On Tue, 3 Mar 2026 at 09:15, karel@example.org wrote:",
    );
    expect(quoteForReply({ ...parent, text: "\n\n" })).toBe("");
  });

  it("is recognised by splitQuoted: a plain reply with the quote below shows only the new text", () => {
    const text = `Ano, pošlu je večer.\n\n${quoteForReply(parent)}`;
    const raw = serializeMessage(
      { from: { name: "Alice", address: "alice@example.com" }, to: [{ name: "Karel Holub", address: "karel@example.org" }], subject: "Re: Fotky", text },
      { date: "2026-03-03T10:00:00Z", messageId: "<re-k1@example.com>", includeEsPart: false },
    );
    const reply = parseMessage(raw);
    expect(reply.es).toBeNull();
    expect(splitQuoted(reply)).toEqual({ fresh: "Ano, pošlu je večer.", quoted: quoteForReply(parent), signature: "" });
  });
});
