import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { groupByParticipants } from "../src/chats.js";
import { threadMessages } from "../src/threading/thread.js";
import type { Chat, EsMessage } from "../src/types.js";
import { mid, msg, t } from "./helpers/messages.js";
import { mulberry32, shuffle } from "./helpers/prng.js";

const ME = "alice@example.com";
const ALICE = "Alice Example <alice@example.com>";
const BOB = "Bob Svoboda <bob@example.org>";
const JANA = "Jana Nováková <jana@example.net>";
const KAREL = "Karel Holub <karel@example.org>";

/** Expected chat id, computed independently with node:crypto. */
const chatId = (...addresses: string[]): string =>
  "chat-" + createHash("sha256").update([...addresses].sort().join("\n"), "utf8").digest("hex").slice(0, 32);

/** Runs groupByParticipants on the input and on 5 seeded shuffles, checks they agree, returns the result. */
function group(messages: EsMessage[], self: string | string[] = ME): Chat[] {
  const result = groupByParticipants(messages, { self });
  const random = mulberry32(0xc4a7);
  for (let i = 0; i < 5; i++) expect(groupByParticipants(shuffle(messages, random), { self })).toEqual(result);
  return result;
}

describe("groupByParticipants: one chat per set of people", () => {
  it("puts everything exchanged with one person into one chat, whatever the subjects, with each message's base subject", () => {
    const messages = [
      msg({ id: mid("k1"), from: KAREL, to: ALICE, date: t(0), subject: "Kdy dorazíš?" }),
      msg({ id: mid("k2"), from: ALICE, to: KAREL, date: t(5), subject: "Re: Kdy dorazíš?", inReplyTo: mid("k1") }),
      msg({ id: mid("k3"), from: KAREL, to: ALICE, date: t(60), subject: "Fotky z výletu" }),
      msg({ id: mid("k4"), from: ALICE, to: KAREL, date: t(90), subject: "AW: Fotky z výletu" }),
      msg({ id: mid("k5"), from: KAREL, to: ALICE, date: t(120), subject: "[klub] Schůze" }),
      msg({ id: mid("k6"), from: KAREL, to: ALICE, date: t(180), subject: "" }),
    ];
    expect(threadMessages(messages).length).toBeGreaterThan(1);
    const chats = group(messages);
    expect(chats).toEqual([
      {
        id: chatId("karel@example.org"),
        participants: [{ name: "Karel Holub", address: "karel@example.org" }],
        messages: [
          { id: mid("k1"), subject: "Kdy dorazíš?" },
          { id: mid("k2"), subject: "Kdy dorazíš?" },
          { id: mid("k3"), subject: "Fotky z výletu" },
          { id: mid("k4"), subject: "Fotky z výletu" },
          { id: mid("k5"), subject: "Schůze" },
          { id: mid("k6"), subject: "" },
        ],
        firstDate: t(0),
        lastDate: t(180),
      },
    ]);
  });

  it("derives the id from the sorted canonical addresses of the others: 'chat-' + 32 hex digits of SHA-256", () => {
    const a = msg({ id: mid("a"), from: "Bob <bob@EXAMPLE.org>", to: [ALICE, JANA], date: t(0), subject: "Oběd" });
    const b = msg({ id: mid("b"), from: JANA, to: [ALICE], cc: ["bob@example.org"], date: t(1), subject: "Re: Oběd" });
    const [chat, ...rest] = group([a, b]);
    expect(rest).toEqual([]);
    expect(chat!.id).toBe(chatId("jana@example.net", "bob@example.org"));
    expect(chat!.id).toMatch(/^chat-[0-9a-f]{32}$/);
    expect(chat!.participants.map((p) => p.address)).toEqual(["bob@example.org", "jana@example.net"]);
  });

  it("keeps a group apart from the chats with each of its members", () => {
    const messages = [
      msg({ id: mid("b1"), from: BOB, to: ALICE, date: t(0), subject: "Smlouva" }),
      msg({ id: mid("g1"), from: ALICE, to: BOB, cc: JANA, date: t(10), subject: "Oběd" }),
      msg({ id: mid("g2"), from: JANA, to: BOB, cc: ALICE, date: t(20), subject: "Re: Oběd" }),
      msg({ id: mid("j1"), from: JANA, to: ALICE, date: t(30), subject: "Oběd" }),
      // Alice got this one as Bcc: the people in it are still Bob and Jana.
      msg({ id: mid("g3"), from: BOB, to: JANA, date: t(40), subject: "Re: Oběd" }),
    ];
    const chats = group(messages);
    expect(chats.map((c) => [c.participants.map((p) => p.address), c.messages.map((m) => m.id)])).toEqual([
      [["bob@example.org", "jana@example.net"], [mid("g1"), mid("g2"), mid("g3")]],
      [["jana@example.net"], [mid("j1")]],
      [["bob@example.org"], [mid("b1")]],
    ]);
  });

  it("removes the account owner wherever it appears, under any of its addresses", () => {
    const messages = [
      msg({ id: mid("1"), from: "Alice <alice@EXAMPLE.COM>", to: BOB, cc: "alice@work.example.net", date: t(0), subject: "a" }),
      msg({ id: mid("2"), from: BOB, to: ["alice@work.example.net"], date: t(1), subject: "b" }),
    ];
    const [chat, ...rest] = group(messages, [ME, "alice@work.example.net"]);
    expect(rest).toEqual([]);
    expect(chat!.participants).toEqual([{ name: "Bob Svoboda", address: "bob@example.org" }]);
    // With only one of the addresses as self, the other one is a participant.
    expect(group(messages, ME).map((c) => c.participants.map((p) => p.address))).toEqual([["alice@work.example.net", "bob@example.org"]]);
  });

  it("collects messages to oneself in a chat without participants", () => {
    const note = msg({ id: mid("n"), from: ALICE, to: ALICE, date: t(0), subject: "Nákup" });
    const noFrom = msg({ id: mid("m"), from: null, to: ALICE, date: t(1), subject: "" });
    expect(group([note, noFrom])).toEqual([
      { id: chatId(), participants: [], messages: [{ id: mid("n"), subject: "Nákup" }, { id: mid("m"), subject: "" }], firstDate: t(0), lastDate: t(1) },
    ]);
  });

  it("orders chats newest first and messages oldest first, undated last, each message once", () => {
    const bob1 = msg({ id: mid("b1"), from: BOB, to: ALICE, date: t(0), subject: "a" });
    const bobUndated = msg({ id: mid("b0"), from: BOB, to: ALICE, date: null, subject: "b" });
    const jana1 = msg({ id: mid("j1"), from: JANA, to: ALICE, date: t(5), subject: "c" });
    const undatedOnly = msg({ id: mid("k1"), from: KAREL, to: ALICE, date: null, subject: "d" });
    const chats = group([bob1, bobUndated, jana1, undatedOnly, { ...bob1 }]);
    expect(chats.map((c) => c.messages.map((m) => m.id))).toEqual([[mid("j1")], [mid("b1"), mid("b0")], [mid("k1")]]);
    expect(chats.map((c) => [c.firstDate, c.lastDate])).toEqual([
      [t(5), t(5)],
      [t(0), t(0)],
      [null, null],
    ]);
  });

  it("names participants as contacts do: the most recent name they sent under", () => {
    const messages = [
      msg({ id: mid("1"), from: "Bob <bob@example.org>", to: ALICE, date: t(0), subject: "a" }),
      msg({ id: mid("2"), from: ALICE, to: "Bobík <bob@example.org>", date: t(5), subject: "b" }),
      msg({ id: mid("3"), from: "Bob Svoboda <bob@example.org>", to: ALICE, date: t(10), subject: "c" }),
    ];
    expect(group(messages)[0]!.participants).toEqual([{ name: "Bob Svoboda", address: "bob@example.org" }]);
  });

  it("returns nothing for no messages", () => {
    expect(groupByParticipants([], { self: ME })).toEqual([]);
  });
});
