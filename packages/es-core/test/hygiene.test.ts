/**
 * Repository rules from CLAUDE.md that can be checked mechanically:
 * rule 3 (example domains only), rule 4 (no claims), and the library's
 * browser/determinism constraints (no Node built-ins, clock or randomness).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const REPO = join(PKG, "../../");

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

const read = (path: string): string => readFileSync(path, "latin1");
const rel = (path: string): string => relative(REPO, path);

describe("rule 3: only example.com, example.org and example.net", () => {
  const files = [
    ...filesUnder(join(PKG, "fixtures"), [".eml", ".md"]),
    ...filesUnder(join(PKG, "vectors"), [".json", ".md"]),
    ...filesUnder(join(PKG, "src"), [".ts"]),
    ...filesUnder(join(PKG, "test"), [".ts"]),
    ...filesUnder(join(PKG, "test-browser"), [".ts"]),
    join(PKG, "README.md"),
  ];
  const allowed = /(^|\.)example\.(com|org|net)$/i;

  it.each(files.map((f) => [rel(f), f]))("%s", (_, file) => {
    const text = read(file)
      .replace(/\\u[0-9a-f]{4}/gi, " ")
      // Undo quoted-printable soft line breaks (also JSON-escaped) so a domain split across lines is seen whole.
      .replace(/=(\r?\n|\\r\\n|\\n)/g, "")
      .replace(/=2E/g, ".");
    const domains = new Set<string>();
    for (const m of text.matchAll(/@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g)) domains.add(m[1]!);
    for (const m of text.matchAll(/:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) domains.add(m[1]!);
    expect([...domains].filter((d) => !allowed.test(d))).toEqual([]);
  });
});

describe("rule 4: no claims in documentation, comments or text", () => {
  const FORBIDDEN = [
    "secure",
    "unhackable",
    "military-grade",
    "zero-knowledge",
    "quantum",
    "end-to-end encrypted",
    "verified",
    "private by design",
  ];
  const files = [
    ...filesUnder(join(PKG, "src"), [".ts"]),
    join(PKG, "README.md"),
    join(PKG, "fixtures/README.md"),
    join(PKG, "vectors/README.md"),
    join(REPO, "README.md"),
    join(REPO, "spec/DEVIATIONS.md"),
  ];

  it.each(files.map((f) => [rel(f), f]))("%s", (_, file) => {
    const text = readFileSync(file, "utf8").toLowerCase();
    expect(FORBIDDEN.filter((word) => text.includes(word))).toEqual([]);
  });
});

describe("library code runs in browsers and is deterministic", () => {
  const PATTERNS: [string, RegExp][] = [
    ["Node Buffer", /\bBuffer\b/],
    ["node: import", /from\s+["']node:/],
    ["process global", /\bprocess\./],
    ["require()", /\brequire\(/],
    ["the clock", /Date\.now\(|new Date\(\s*\)|performance\.now\(/],
    ["randomness", /Math\.random\(|crypto\.getRandomValues|randomUUID/],
  ];
  const files = filesUnder(join(PKG, "src"), [".ts"]);

  it.each(files.map((f) => [rel(f), f]))("%s", (_, file) => {
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(PATTERNS.filter(([, re]) => re.test(code)).map(([what]) => what)).toEqual([]);
  });
});
