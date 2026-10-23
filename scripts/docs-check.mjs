#!/usr/bin/env node
/**
 * Checks that the specification and the root README make no claims
 * (CLAUDE.md rule 4, tasks/03): none of the forbidden words appears, in any
 * letter case, in a file under spec/ or in README.md.
 *
 * One exception: the fenced code blocks of spec/es-protocol-v2-excerpt.md.
 * That file is the Czech working draft, kept unchanged for provenance; its
 * draft code names a JSON field and a variable "verified". Its prose is
 * checked like every other file.
 *
 *   node scripts/docs-check.mjs              check spec/ and README.md
 *   node scripts/docs-check.mjs FILE...      check these files instead
 *   node scripts/docs-check.mjs --self-test  check the rules themselves
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** CLAUDE.md rule 4. */
export const FORBIDDEN = [
  "secure",
  "unhackable",
  "military-grade",
  "zero-knowledge",
  "quantum",
  "end-to-end encrypted",
  "verified",
  "private by design",
];

/** Files whose fenced code blocks are not checked (repository-relative paths). */
export const CODE_EXEMPT = new Set(["spec/es-protocol-v2-excerpt.md"]);

/** The text with every line of a fenced code block (``` or ~~~, fences included) emptied; line numbers stay. */
export function withoutFencedCode(text) {
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence === null && open !== null) {
        fence = open[1];
        return "";
      }
      if (fence !== null) {
        if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
        return "";
      }
      return line;
    })
    .join("\n");
}

/** The forbidden words in a text, as { line, word } in order of appearance. */
export function claimsIn(text) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const word of FORBIDDEN) if (lower.includes(word)) found.push({ line: i + 1, word });
  });
  return found;
}

/** The problems in one file, as sentences; `path` is relative to the repository root. */
export function checkFile(path, text) {
  const checked = CODE_EXEMPT.has(path) ? withoutFencedCode(text) : text;
  return claimsIn(checked).map(({ line, word }) => `${path}:${line}: "${word}" (CLAUDE.md rule 4)`);
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`docs:check self-test failed: ${message}`);
}

function selfTest() {
  assert(claimsIn("A Secure line\nfine\nEnd-to-end encrypted, VERIFIED").map((c) => `${c.line}:${c.word}`).join(" ") === "1:secure 3:end-to-end encrypted 3:verified", "claimsIn");
  const fenced = "prose\n```js\nconst verified = 1;\n```\n~~~\nsecure\n~~~\nafter verified";
  assert(withoutFencedCode(fenced).split("\n").length === fenced.split("\n").length, "line numbers kept");
  assert(checkFile("spec/es-protocol-v2-excerpt.md", fenced).join() === 'spec/es-protocol-v2-excerpt.md:8: "verified" (CLAUDE.md rule 4)', "exempt code blocks only");
  assert(checkFile("spec/es-protocol.md", fenced).length === 3, "no exemption elsewhere");
  assert(checkFile("README.md", "Stored only in your mailbox.").length === 0, "clean text");
  console.log("docs:check self-test passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  selfTest();
  if (!process.argv.includes("--self-test")) {
    const args = process.argv.slice(2);
    const files = args.length > 0 ? args.map((a) => resolve(a)) : [...filesUnder(join(ROOT, "spec")), join(ROOT, "README.md")];
    const problems = files.flatMap((file) => checkFile(relative(ROOT, file).split("\\").join("/"), readFileSync(file, "utf8")));
    if (problems.length > 0) {
      for (const problem of problems) console.error(`✗ ${problem}`);
      process.exit(1);
    }
    console.log(`docs:check: ${files.length} files, no forbidden words`);
  }
}
