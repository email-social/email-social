#!/usr/bin/env node
/**
 * Checks the licence of every package in package-lock.json (CLAUDE.md rule 8,
 * tasks/02b):
 *
 * - runtime dependencies (everything the bridge and the web client ship or
 *   run with): permissive licences only; no GPL, AGPL or LGPL, and no
 *   package without a licence ("UNLICENSED" or none given);
 * - development and build tools (lockfile entries marked "dev"): the same,
 *   plus MPL-2.0 for the packages listed in README.md under
 *   "MPL-2.0 build tools".
 *
 * An SPDX expression passes when it can be satisfied with allowed licences
 * ("MIT OR EUPL-1.1+" passes through MIT; "A AND B" needs both). Our own
 * workspace packages must be Apache-2.0.
 *
 *   node scripts/license-check.mjs              check the lockfile
 *   node scripts/license-check.mjs --self-test  check the rules themselves
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Permissive licences allowed everywhere. */
export const PERMISSIVE = new Set(["MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Unlicense", "Python-2.0", "CC-BY-4.0"]);

/** Allowed for development and build tools only, when listed in README.md. */
export const BUILD_ONLY = new Set(["MPL-2.0"]);

/**
 * Parses an SPDX licence expression into a tree: { or: [...] }, { and: [...] } or a licence id.
 * "WITH <exception>" is kept with its licence; "+" ("or later") is dropped.
 */
export function parseSpdx(expression) {
  const tokens = expression.replace(/[()]/g, " $& ").split(/\s+/).filter(Boolean);
  let i = 0;
  const primary = () => {
    const token = tokens[i++];
    if (token === "(") {
      const inner = or();
      i++; // ")"
      return inner;
    }
    let id = (token ?? "").replace(/\+$/, "");
    if (tokens[i]?.toUpperCase() === "WITH") {
      id += ` WITH ${tokens[i + 1]}`;
      i += 2;
    }
    return id;
  };
  const and = () => {
    const parts = [primary()];
    while (tokens[i]?.toUpperCase() === "AND") {
      i++;
      parts.push(primary());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  };
  const or = () => {
    const parts = [and()];
    while (tokens[i]?.toUpperCase() === "OR") {
      i++;
      parts.push(and());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  };
  return or();
}

/** Whether a licence expression can be satisfied with the allowed licence ids. */
export function satisfies(expression, allowed) {
  const check = (node) => {
    if (typeof node === "string") return allowed.has(node.split(" WITH ")[0]);
    if ("or" in node) return node.or.some(check);
    return node.and.every(check);
  };
  if (typeof expression !== "string" || expression.trim() === "" || /^UNLICENSED$/i.test(expression.trim())) return false;
  return check(parseSpdx(expression.trim()));
}

/** Package names (or "prefix-*" patterns) listed under "MPL-2.0 build tools" in README.md. */
export function listedBuildTools(readme) {
  const section = /^#+ .*MPL-2\.0 build tools.*$([\s\S]*?)(?=^#+ |(?![\s\S]))/m.exec(readme)?.[1] ?? "";
  const bullets = section.split("\n").filter((line) => /^\s*[-*] /.test(line));
  return bullets.flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
}

function isListed(name, listed) {
  return listed.some((entry) => (entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry));
}

/** The problems found in a lockfile (package-lock.json v3), as sentences. */
export function check(lock, readme, workspaceLicences = {}) {
  const listed = listedBuildTools(readme);
  const problems = [];
  const counts = { runtime: 0, dev: 0, buildOnly: [] };
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === "" || !path.includes("node_modules/")) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    if (entry.link === true) {
      const licence = workspaceLicences[name];
      if (licence !== "Apache-2.0") problems.push(`${name} (our workspace package) is licensed ${licence ?? "without a licence"}, not Apache-2.0`);
      continue;
    }
    const licence = entry.license;
    if (entry.dev === true) {
      counts.dev++;
      if (satisfies(licence, PERMISSIVE)) continue;
      if (satisfies(licence, new Set([...PERMISSIVE, ...BUILD_ONLY]))) {
        if (isListed(name, listed)) counts.buildOnly.push(name);
        else problems.push(`${name} (build tool, ${licence}) is not listed under "MPL-2.0 build tools" in README.md`);
        continue;
      }
      problems.push(`${name} (build tool) has licence ${licence ?? "(none)"}, which is not allowed`);
    } else {
      counts.runtime++;
      if (!satisfies(licence, PERMISSIVE)) problems.push(`${name} (runtime dependency) has licence ${licence ?? "(none)"}, which is not allowed`);
    }
  }
  return { problems, counts };
}

function selfTest() {
  const assert = (ok, message) => {
    if (!ok) throw new Error(`license-check self-test failed: ${message}`);
  };
  assert(satisfies("MIT", PERMISSIVE), "MIT");
  assert(satisfies("(MIT OR EUPL-1.1+)", PERMISSIVE), "a choice with MIT");
  assert(!satisfies("(MIT AND GPL-3.0-only)", PERMISSIVE), "MIT and GPL together");
  assert(!satisfies("GPL-2.0-or-later", PERMISSIVE), "GPL");
  assert(!satisfies("AGPL-3.0-only", PERMISSIVE), "AGPL");
  assert(!satisfies("LGPL-2.1-only", PERMISSIVE), "LGPL");
  assert(!satisfies("UNLICENSED", PERMISSIVE), "UNLICENSED");
  assert(!satisfies(undefined, PERMISSIVE), "no licence");
  assert(!satisfies("MPL-2.0", PERMISSIVE), "MPL-2.0 at run time");
  assert(satisfies("Apache-2.0 WITH LLVM-exception", PERMISSIVE), "an exception");
  const readme = "# X\n\n## MPL-2.0 build tools\n\nText with `code`.\n\n- `lightningcss`, `lightningcss-*`: CSS\n\n## Next\n- `not-this`\n";
  assert(JSON.stringify(listedBuildTools(readme)) === JSON.stringify(["lightningcss", "lightningcss-*"]), "README list");
  const lock = {
    packages: {
      "": {},
      "node_modules/ok": { license: "MIT" },
      "node_modules/gpl": { license: "GPL-3.0-only" },
      "node_modules/none": {},
      "node_modules/mpl-runtime": { license: "MPL-2.0" },
      "node_modules/lightningcss-linux-x64-gnu": { license: "MPL-2.0", dev: true },
      "node_modules/other-mpl": { license: "MPL-2.0", dev: true },
      "node_modules/agpl-tool": { license: "AGPL-3.0", dev: true },
      "node_modules/@email-social/es-core": { link: true },
    },
  };
  const { problems } = check(lock, readme, { "@email-social/es-core": "Apache-2.0" });
  const expected = ["gpl (runtime", "none (runtime", "mpl-runtime (runtime", "other-mpl (build tool, MPL-2.0) is not listed", "agpl-tool (build tool)"];
  assert(problems.length === expected.length && expected.every((e, i) => problems[i].startsWith(e)), `problems: ${JSON.stringify(problems)}`);
  console.log("license:check self-test passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  selfTest();
  if (!process.argv.includes("--self-test")) {
    const lock = JSON.parse(readFileSync(ROOT + "package-lock.json", "utf8"));
    const readme = readFileSync(ROOT + "README.md", "utf8");
    const workspaces = {};
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path.startsWith("packages/")) workspaces[entry.name ?? JSON.parse(readFileSync(ROOT + path + "/package.json", "utf8")).name] = JSON.parse(readFileSync(ROOT + path + "/package.json", "utf8")).license;
    }
    const { problems, counts } = check(lock, readme, workspaces);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`✗ ${problem}`);
      process.exit(1);
    }
    console.log(
      `license:check: ${counts.runtime} runtime and ${counts.dev} development packages, all allowed` +
        (counts.buildOnly.length > 0 ? `; MPL-2.0 build tools listed in README.md: ${counts.buildOnly.join(", ")}` : ""),
    );
  }
}
