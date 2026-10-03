/** Access to the raw-message fixtures in packages/es-core/fixtures (see fixtures/README.md). */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path of the fixtures directory, with a trailing separator. */
export const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures/", import.meta.url));

/** File names of every fixture (*.eml), in code-unit order. */
export function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".eml"))
    .sort();
}

/** Names of the reply-format fixtures (fixtures/replies/*.eml) as "replies/<file>", in code-unit order. */
export function listReplyFixtures(): string[] {
  return readdirSync(FIXTURES_DIR + "replies")
    .filter((name) => name.endsWith(".eml"))
    .sort()
    .map((name) => "replies/" + name);
}

/** Every fixture: the corpus and the reply formats. */
export function listAllFixtures(): string[] {
  return [...listFixtures(), ...listReplyFixtures()];
}

/**
 * The exact bytes of a fixture ("name.eml" or "replies/name.eml"). Returned
 * as a plain Uint8Array, not a Node Buffer, so tests exercise the same input
 * type a browser would pass.
 */
export function readFixture(name: string): Uint8Array {
  if (!/^(?:replies\/)?[^/\\]+$/.test(name) || name.includes("..")) throw new Error(`not a fixture name: ${name}`);
  const buffer = readFileSync(FIXTURES_DIR + name);
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}
