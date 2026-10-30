/**
 * Threading cost in practice: each shape of mailbox is threaded with
 * N = 2 000 and N = 20 000 synthetic messages and the times are printed.
 * O(N log N) makes the larger run about 13 times slower; O(N²) makes it 100
 * times slower. The test allows a factor of 50.
 */
import { describe, expect, it } from "vitest";
import { deriveContacts, groupByParticipants, threadMessages, topicsOf } from "../../src/index.js";
import type { EsMessage } from "../../src/types.js";

const BASE = Date.UTC(2026, 0, 1);

function message(i: number, over: Partial<EsMessage> & { inReplyTo?: string[]; references?: string[] } = {}): EsMessage {
  const id = `<m${i}@example.com>`;
  const { inReplyTo = [], references = [], ...rest } = over;
  return {
    id,
    from: { name: "", address: `u${i % 50}@example.com` },
    to: [{ name: "", address: "me@example.org" }],
    cc: [],
    replyTo: [],
    date: new Date(BASE + i * 60_000).toISOString(),
    subject: `Topic ${Math.floor(i / 10)}`,
    text: "",
    textSource: "plain",
    es: null,
    attachments: [],
    refs: { messageId: id, inReplyTo, references },
    delivery: { listHeaders: [], listId: null, autoSubmitted: null, precedence: null, returnPath: null, listUnsubscribe: null },
    ...rest,
  };
}

const mid = (i: number): string => `<m${i}@example.com>`;

/** Mailbox shapes, each a function of N. */
const SHAPES: Record<string, (n: number) => EsMessage[]> = {
  "threads of 10 (In-Reply-To and References)": (n) =>
    Array.from({ length: n }, (_, i) => {
      const root = i - (i % 10);
      return i === root ? message(i) : message(i, { subject: `Re: Topic ${root / 10}`, inReplyTo: [mid(i - 1)], references: [mid(root), mid(i - 1)] });
    }),
  "one reply chain, In-Reply-To only": (n) => Array.from({ length: n }, (_, i) => message(i, { subject: "Chain", inReplyTo: i > 0 ? [mid(i - 1)] : [] })),
  "one reply chain, dates reversed": (n) =>
    Array.from({ length: n }, (_, i) => message(i, { subject: "Chain", date: new Date(BASE - i * 60_000).toISOString(), inReplyTo: i > 0 ? [mid(i - 1)] : [] })),
  "no subject, distinct participants": (n) => Array.from({ length: n }, (_, i) => message(i, { subject: "", from: { name: "", address: `s${i}@example.com` } })),
  "References to 20 phantom ids each, overlapping": (n) =>
    Array.from({ length: n }, (_, i) => message(i, { subject: "", references: Array.from({ length: 20 }, (_, k) => `<p${(i + k * 7) % (n / 2)}@example.com>`) })),
};

function timeOf(f: () => unknown): number {
  const started = performance.now();
  f();
  return performance.now() - started;
}

/** Best of `runs` timings, so one garbage collection does not decide the result. */
function best(runs: number, f: () => unknown): number {
  return Math.min(...Array.from({ length: runs }, () => timeOf(f)));
}

describe("threading scales as O(N log N) in practice", () => {
  const results: string[] = [];

  it.each(Object.entries(SHAPES))("%s", { timeout: 120_000 }, (label, make) => {
    const small = make(2_000);
    const large = make(20_000);
    const tSmall = best(3, () => threadMessages(small));
    const tLarge = best(2, () => threadMessages(large));
    results.push(`${label}: N=2000 ${tSmall.toFixed(0)} ms, N=20000 ${tLarge.toFixed(0)} ms, ratio ${(tLarge / tSmall).toFixed(1)}`);
    console.log(`[threading] ${results[results.length - 1]}`);
    expect(tLarge).toBeLessThan(10_000);
    expect(tLarge / Math.max(tSmall, 5)).toBeLessThan(50);
  });

  // Same subject from thousands of distinct senders is quadratic: see the it.fails in test/hostile-input.test.ts.
});

describe("chats, topics and contacts scale as O(N log N) in practice", () => {
  const ONE_CHAT = (n: number): EsMessage[] =>
    Array.from({ length: n }, (_, i) => message(i, { from: { name: `N${i % 7}`, address: "news@example.com" }, subject: i % 3 ? `Issue ${i}` : `Re: Issue ${i - 1}`, inReplyTo: i % 5 ? [] : [mid(i - 1)] }));
  const MANY_CC = (n: number): EsMessage[] => Array.from({ length: n }, (_, i) => message(i, { cc: Array.from({ length: 20 }, (_, k) => ({ name: "", address: `c${(i + k) % 500}@example.com` })) }));
  const cases: [string, (m: EsMessage[]) => unknown, (n: number) => EsMessage[]][] = [
    ["topicsOf, one chat with distinct subjects", topicsOf, ONE_CHAT],
    ["groupByParticipants, 20 cc each", (m) => groupByParticipants(m, { self: "me@example.org" }), MANY_CC],
    ["deriveContacts, 20 cc each", (m) => deriveContacts(m, { exclude: ["me@example.org"] }), MANY_CC],
  ];
  it.each(cases)("%s", { timeout: 120_000 }, (label, run, make) => {
    const small = make(2_000);
    const large = make(20_000);
    const tSmall = best(3, () => run(small));
    const tLarge = best(2, () => run(large));
    console.log(`[scale] ${label}: N=2000 ${tSmall.toFixed(0)} ms, N=20000 ${tLarge.toFixed(0)} ms, ratio ${(tLarge / tSmall).toFixed(1)}`);
    expect(tLarge).toBeLessThan(10_000);
    expect(tLarge / Math.max(tSmall, 5)).toBeLessThan(50);
  });
});
