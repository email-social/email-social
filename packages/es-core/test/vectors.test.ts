/**
 * Test vectors: packages/es-core/vectors/*.json, the conformance suite for
 * other implementations (format in vectors/README.md).
 *
 *   npm run vectors:check    parse every vector's raw message and compare
 *   npm run vectors:update   rewrite the files from the current code
 *                            (ES_UPDATE_VECTORS=1), then check them
 *
 * A fixture vector's `expected` equals the hand-written expectation of that
 * fixture in test/fixtures.test.ts (which checks every field), so updating
 * cannot freeze a parser bug without that test failing too.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";
import { serializeMessage, serializeReceipt } from "../src/serialize.js";
import type { EsMessage, EsOutgoing, EsOutgoingReceipt, SerializeOptions } from "../src/types.js";
import { FIXTURES_DIR, listFixtures, readFixture } from "./helpers/fixtures.js";

const VECTORS_DIR = fileURLToPath(new URL("../vectors/", import.meta.url));
const UPDATE = process.env.ES_UPDATE_VECTORS === "1";

type GeneratedInput =
  | { kind: "message"; outgoing: EsOutgoing; options: SerializeOptions }
  | { kind: "receipt"; receipt: EsOutgoingReceipt; options: SerializeOptions };

interface Vector {
  description: string;
  /** "fixtures/<file>.eml" or "generated" (written by es-core from `input`). */
  source: string;
  /** For generated vectors: what was serialised; serialising it again must give `raw` byte for byte. */
  input?: GeneratedInput;
  /** The raw message when its bytes are valid UTF-8 ... */
  raw?: string;
  /** ... otherwise its bytes in base64. */
  rawBase64?: string;
  expected: EsMessage;
}

const GENERATED: Record<string, { description: string; input: GeneratedInput }> = {
  "generated-message.json": {
    description: "A new message written by es-core: text/plain first, then the ES part (es.social.post) in multipart/mixed.",
    input: {
      kind: "message",
      outgoing: {
        from: { name: "Alice Example", address: "alice@example.com" },
        to: [{ name: "Bob", address: "bob@example.org" }],
        subject: "Lunch on Friday?",
        text: "Hi Bob,\n\nlunch on Friday at noon?\n\nAlice\n",
        es: { requestReceipts: ["delivered", "read"] },
      },
      options: { date: "2026-03-02T09:00:00Z", messageId: "<es-vector-1@mail.example.com>" },
    },
  },
  "generated-reply-czech.json": {
    description:
      "A reply written by es-core: RFC 2047 names and subject, quoted-printable UTF-8 text, In-Reply-To/References, an author DID.",
    input: {
      kind: "message",
      outgoing: {
        from: { name: "Jana Nováková", address: "jana@example.net" },
        to: [{ name: "Alice Example", address: "alice@example.com" }],
        cc: [{ name: "Bob", address: "bob@example.org" }],
        text: "Ahoj Alice,\n\nv pátek ve 12 mi to vyhovuje. Příliš žluťoučký kůň úpěl ďábelské ódy. 👍\n\nJana\n",
        inReplyTo: {
          messageId: "<es-vector-1@mail.example.com>",
          references: ["<root-0@mail.example.com>"],
          subject: "Oběd v pátek?",
        },
        es: { author: "did:es:example.net:0123456789abcdef0123456789abcdef" },
      },
      options: { date: "2026-03-02T10:30:00Z", messageId: "<es-vector-2@mail.example.net>" },
    },
  },
  "generated-receipt-delivered.json": {
    description: "A Delivered receipt (es.social.receipt, kind delivered) answering the first generated message.",
    input: {
      kind: "receipt",
      receipt: {
        kind: "delivered",
        from: { name: "Bob", address: "bob@example.org" },
        to: { name: "Alice Example", address: "alice@example.com" },
        original: { messageId: "<es-vector-1@mail.example.com>", references: [], subject: "Lunch on Friday?" },
      },
      options: { date: "2026-03-02T09:00:05Z", messageId: "<es-vector-3@mail.example.org>" },
    },
  },
  "generated-receipt-read.json": {
    description: "A Read receipt (es.social.receipt, kind read) answering the first generated message.",
    input: {
      kind: "receipt",
      receipt: {
        kind: "read",
        from: { name: "Bob", address: "bob@example.org" },
        to: { name: "Alice Example", address: "alice@example.com" },
        original: { messageId: "<es-vector-1@mail.example.com>", references: [], subject: "Lunch on Friday?" },
      },
      options: { date: "2026-03-02T09:12:00Z", messageId: "<es-vector-4@mail.example.org>" },
    },
  },
};

function serialize(input: GeneratedInput): string {
  return input.kind === "message"
    ? serializeMessage(input.outgoing, input.options)
    : serializeReceipt(input.receipt, input.options);
}

function vectorName(fixture: string): string {
  return fixture.replace(/\.eml$/, ".json");
}

/** One-line descriptions from the table in fixtures/README.md ("client: what it exercises"). */
function fixtureDescriptions(): Map<string, string> {
  const plain = (cell: string): string => cell.replace(/`/g, "").replace(/\*\*/g, "").trim();
  const map = new Map<string, string>();
  for (const line of readFileSync(FIXTURES_DIR + "README.md", "utf8").split("\n")) {
    const cells = line.split(" | ");
    const file = /^\| `([^`]+\.eml)`$/.exec(cells[0] ?? "")?.[1];
    if (file !== undefined && cells.length >= 3) map.set(file, `${plain(cells[1]!)}: ${plain(cells[2]!)}`);
  }
  return map;
}

function encodeRaw(bytes: Uint8Array): { raw: string } | { rawBase64: string } {
  try {
    return { raw: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { rawBase64: Buffer.from(bytes).toString("base64") };
  }
}

function rawBytes(vector: Vector): Uint8Array {
  if (vector.raw !== undefined) return new TextEncoder().encode(vector.raw);
  return new Uint8Array(Buffer.from(vector.rawBase64 ?? "", "base64"));
}

function write(name: string, vector: Vector): void {
  writeFileSync(VECTORS_DIR + name, JSON.stringify(vector, null, 2) + "\n");
}

if (UPDATE) {
  const descriptions = fixtureDescriptions();
  for (const fixture of listFixtures()) {
    const bytes = readFixture(fixture);
    write(vectorName(fixture), {
      description: descriptions.get(fixture) ?? fixture,
      source: "fixtures/" + fixture,
      ...encodeRaw(bytes),
      expected: parseMessage(bytes),
    });
  }
  for (const [name, { description, input }] of Object.entries(GENERATED)) {
    const raw = serialize(input);
    write(name, { description, source: "generated", input, raw, expected: parseMessage(raw) });
  }
}

const files = readdirSync(VECTORS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const vectors = files.map((f) => [f, JSON.parse(readFileSync(VECTORS_DIR + f, "utf8")) as Vector] as const);

describe("test vectors (vectors/*.json)", () => {
  it("has one vector per fixture plus the generated ones, and nothing else", () => {
    expect(files).toEqual([...listFixtures().map(vectorName), ...Object.keys(GENERATED)].sort());
  });

  it("stores each fixture byte for byte", () => {
    for (const fixture of listFixtures()) {
      const vector = vectors.find(([f]) => f === vectorName(fixture))?.[1];
      expect(vector?.source, fixture).toBe("fixtures/" + fixture);
      expect(rawBytes(vector!), fixture).toEqual(readFixture(fixture));
      expect(vector!.description.length, fixture).toBeGreaterThan(20);
    }
  });

  it.each(vectors)("%s: parseMessage(raw) equals expected", (_, vector) => {
    expect(vector.raw === undefined).not.toBe(vector.rawBase64 === undefined);
    expect(parseMessage(rawBytes(vector))).toEqual(vector.expected);
  });

  it.each(Object.keys(GENERATED))("%s: serialising the input gives the raw message byte for byte", (name) => {
    const vector = vectors.find(([f]) => f === name)![1];
    expect(vector.input).toEqual(GENERATED[name]!.input);
    expect(serialize(vector.input!)).toBe(vector.raw);
  });
});
