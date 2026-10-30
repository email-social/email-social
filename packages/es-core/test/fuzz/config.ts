/**
 * Settings of the fuzz harness (test/fuzz/README.md). Everything is seeded:
 * the same seed and settings give the same inputs on every run.
 *
 *   ES_FUZZ_SEED=<n>     base seed (default 20261030)
 *   ES_FUZZ_ROUNDS=<n>   mutations per fixture and mutator (default 3)
 *   ES_FUZZ_LONG=1       long run: 30 rounds, 100 MB quote flood, 1 MB runs in every header
 */

export const LONG = process.env.ES_FUZZ_LONG === "1";
export const SEED = Number(process.env.ES_FUZZ_SEED ?? 20261030) >>> 0;
export const ROUNDS = Number(process.env.ES_FUZZ_ROUNDS ?? (LONG ? 30 : 3));

/** Size of the ">" quote-prefix flood (the task asks for 100 MB; the default run uses 4 MB). */
export const QUOTE_FLOOD_BYTES = LONG ? 100 * 2 ** 20 : 4 * 2 ** 20;

/** Length of the character runs put into header fields (ReDoS sweep). */
export const HEADER_RUN = LONG ? 2 ** 20 : 64 * 1024;

/**
 * Time allowed for parsing and checking one message: 0.5 s plus 1 µs per
 * byte. Linear code runs at about 0.1 µs per byte; a quadratic step on a
 * 64 KB run already takes seconds.
 */
export function limitMs(bytes: number): number {
  return 500 + bytes / 1000;
}

/** Vitest timeout for a test that parses `count` messages of up to `bytes` each. */
export function timeoutFor(count: number, bytes = 64 * 1024): number {
  return Math.max(30_000, count * limitMs(bytes));
}

/** FNV-1a of a string: per-case seeds that do not depend on the order cases run in. */
export function seedFor(...parts: (string | number)[]): number {
  let h = 0x811c9dc5 ^ SEED;
  for (const ch of parts.join("\u0000")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
