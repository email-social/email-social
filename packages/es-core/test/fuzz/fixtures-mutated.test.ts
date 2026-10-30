/**
 * Fuzz: every fixture in fixtures/ and fixtures/replies/, mutated by every
 * mutator in mutate.ts, must satisfy every property in properties.ts. The
 * messages of each mutator are then threaded together with the originals.
 *
 * A failure names the fixture, mutator, round and seed; `mutate.ts` with
 * that seed rebuilds the input.
 */
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../../src/index.js";
import type { EsMessage } from "../../src/types.js";
import { listAllFixtures, readFixture } from "../helpers/fixtures.js";
import { mulberry32 } from "../helpers/prng.js";
import { LONG, ROUNDS, seedFor, timeoutFor } from "./config.js";
import { boundaryTruncations, fromLatin1, MUTATORS, splitFields, toLatin1 } from "./mutate.js";
import { checkMessage, threadingProblems } from "./properties.js";

const corpus = listAllFixtures().map((name) => ({ name, raw: toLatin1(readFixture(name)) }));
const texts = corpus.map((f) => f.raw);
const originals = corpus.map((f) => parseMessage(readFixture(f.name)));

/** Report at most this many problems per test, so one systematic defect does not flood the output. */
const SHOWN = 15;

function run(cases: Iterable<{ raw: string; label: string }>, threadLabel: string): string[] {
  const problems: string[] = [];
  const messages: EsMessage[] = [...originals];
  for (const { raw, label } of cases) {
    const result = checkMessage(fromLatin1(raw), label);
    problems.push(...result.problems);
    if (result.message !== null) messages.push(result.message);
  }
  problems.push(...threadingProblems(messages, mulberry32(seedFor(threadLabel)), threadLabel));
  return problems;
}

describe(`fuzz: mutated fixtures (${corpus.length} fixtures, seed-based, ${ROUNDS} rounds)`, () => {
  for (const [name, mutate] of Object.entries(MUTATORS)) {
    // 1 MB header lines cost about 0.1 s each to parse; one per fixture unless ES_FUZZ_LONG is set.
    const rounds = name === "long-header" && !LONG ? 1 : ROUNDS;
    it(name, { timeout: timeoutFor(corpus.length * rounds, name === "long-header" ? 2 ** 21 : 64 * 1024) }, () => {
      function* cases(): Generator<{ raw: string; label: string }> {
        for (const f of corpus) {
          for (let round = 0; round < rounds; round++) {
            const seed = seedFor(f.name, name, round);
            yield { raw: mutate(f.raw, mulberry32(seed), texts), label: `${f.name} ${name} round=${round} seed=${seed}` };
          }
        }
      }
      expect(run(cases(), `thread ${name}`).slice(0, SHOWN)).toEqual([]);
    });
  }

  it("truncation before, inside and after every MIME delimiter line", { timeout: 120_000 }, () => {
    function* cases(): Generator<{ raw: string; label: string }> {
      for (const f of corpus) for (const cut of boundaryTruncations(f.raw)) yield { raw: f.raw.slice(0, cut), label: `${f.name} truncated at ${cut}` };
    }
    expect(run(cases(), "thread truncations").slice(0, SHOWN)).toEqual([]);
  });

  it("the LF and the CRLF form of every fixture parse to the same message", () => {
    // Only the hash id of a message without Message-ID and the size of 7bit/8bit parts may depend on the line ending.
    const comparable = (raw: string): unknown => {
      const m = parseMessage(fromLatin1(raw));
      return { ...m, id: m.refs.messageId === null ? null : m.id, attachments: m.attachments.map((a) => ({ ...a, size: null })) };
    };
    const differ = corpus.filter((f) => !isDeepStrictEqual(comparable(f.raw.replace(/\r?\n/g, "\n")), comparable(f.raw.replace(/\r?\n/g, "\r\n"))));
    expect(differ.map((f) => f.name)).toEqual([]);
  });

  it("each top-level header field missing, and each one duplicated", { timeout: 120_000 }, () => {
    function* cases(): Generator<{ raw: string; label: string }> {
      for (const f of corpus) {
        const { fields, rest } = splitFields(f.raw);
        for (let i = 0; i < fields.length; i++) {
          const without = fields.filter((_, j) => j !== i);
          yield { raw: without.join("") + "\r\n" + rest, label: `${f.name} without field ${i} (${fields[i]!.split(":")[0]})` };
          const twice = [...fields.slice(0, i + 1), fields[i]!.replace(/:/, ": x"), ...fields.slice(i + 1)];
          yield { raw: twice.join("") + "\r\n" + rest, label: `${f.name} field ${i} twice` };
        }
      }
    }
    expect(run(cases(), "thread headers").slice(0, SHOWN)).toEqual([]);
  });
});
