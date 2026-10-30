/**
 * spec/es-protocol.md (Task 3): every normative statement carries an
 * identifier such as [WR-1] and uses an RFC 2119 key word, and the table of
 * section 16 names, for each identifier, tests and vectors that exist.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SPEC = readFileSync(join(REPO, "spec/es-protocol.md"), "utf8");

const TABLE_HEADING = "## 16. Requirements and the tests that cover them";
const KEYWORD = /\b(?:MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|MAY|OPTIONAL)\b/;
const TAG = /\[([A-Z]{2,3}-\d+)\]/g;

/** The document without fenced code blocks; inline code spans are blanked so `[ID-1]` in backticks is no tag. */
function prose(markdown: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      lines.push("");
      continue;
    }
    lines.push(fenced ? "" : line.replace(/`[^`]*`/g, "``"));
  }
  return lines;
}

interface Block {
  text: string;
  /** Tags of the block itself, or of the paragraph that introduces the list it belongs to. */
  tags: string[];
  own: boolean;
}

/** Paragraphs and list items before section 16 (and the appendices after its table). */
function blocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let current: string[] = [];
  let owner: string[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.join(" ");
    current = [];
    const isItem = /^\s*(?:[-*]|\d+\.)\s/.test(text);
    const tags = [...text.matchAll(TAG)].map((m) => m[1]!);
    if (!isItem) owner = tags;
    out.push({ text, tags: tags.length > 0 ? tags : isItem ? owner : [], own: tags.length > 0 });
  };
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("## ")) inTable = line === TABLE_HEADING;
    if (inTable) {
      flush();
      continue;
    }
    if (line.trim() === "" || line.startsWith("#") || line.startsWith("|")) {
      flush();
      if (line.startsWith("#")) owner = [];
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s/.test(line)) flush();
    current.push(line);
  }
  flush();
  return out;
}

interface Row {
  id: string;
  cover: string;
}

function tableRows(markdown: string): Row[] {
  const start = markdown.indexOf(TABLE_HEADING);
  const end = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, end === -1 ? undefined : end);
  return section
    .split("\n")
    .filter((line) => /^\| [A-Z]{2,3}-\d+ \|/.test(line))
    .map((line) => {
      const [, id, cover] = /^\| ([A-Z]{2,3}-\d+) \| (.*) \|$/.exec(line) ?? [];
      return { id: id ?? "", cover: cover ?? "" };
    });
}

/** `path` › "title part", "title part"; `path`; … */
function coverage(cover: string): { path: string; titles: string[] }[] {
  return cover.split("; ").map((entry) => {
    const path = /^`([^`]+)`/.exec(entry)?.[1] ?? "";
    const titles = [...entry.slice(path.length + 2).matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    return { path, titles };
  });
}

/** The titles of the tests and groups in a test file: string literals followed by the test function. */
function testTitles(path: string): string[] {
  const source = readFileSync(join(REPO, path), "utf8");
  return [...source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1,\s*(?:async\s*)?\(/g)].map((m) => m[2]!);
}

const body = blocks(prose(SPEC));
const bodyIds = body.filter((b) => b.own).flatMap((b) => b.tags);
const rows = tableRows(SPEC);

describe("spec/es-protocol.md: normative statements", () => {
  it("has requirements, each identifier used once", () => {
    expect(bodyIds.length).toBeGreaterThan(50);
    expect(bodyIds.filter((id, i) => bodyIds.indexOf(id) !== i)).toEqual([]);
  });

  it("tags every paragraph or list that uses an RFC 2119 key word (the conventions paragraph aside)", () => {
    const untagged = body.filter((b) => KEYWORD.test(b.text) && b.tags.length === 0 && !b.text.includes("BCP 14"));
    expect(untagged.map((b) => b.text.slice(0, 100))).toEqual([]);
  });

  it("uses an RFC 2119 key word in every tagged statement", () => {
    expect(body.filter((b) => b.own && !KEYWORD.test(b.text)).map((b) => b.tags.join(" "))).toEqual([]);
  });
});

describe("spec/es-protocol.md: the table of section 16", () => {
  it("lists every requirement once, in the order of the text", () => {
    expect(rows.map((r) => r.id)).toEqual(bodyIds);
  });

  it.each(rows.map((r) => [r.id, r.cover] as const))("%s names tests and vectors that exist", (_, cover) => {
    const entries = coverage(cover);
    expect(entries.length).toBeGreaterThan(0);
    for (const { path, titles } of entries) {
      expect(path, cover).toMatch(/^packages\/es-(?:core|bridge|web)\/(?:test|test-e2e|vectors)\/[\w./-]+\.(?:tsx?|json)$/);
      expect(existsSync(join(REPO, path)), path).toBe(true);
      if (path.endsWith(".json")) {
        expect(titles, path).toEqual([]);
        continue;
      }
      expect(titles.length, `${path} names no test`).toBeGreaterThan(0);
      for (const title of titles) expect(testTitles(path).some((t) => t.includes(title)), `${path} › "${title}"`).toBe(true);
    }
  });
});
