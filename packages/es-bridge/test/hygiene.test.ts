/**
 * CLAUDE.md rules a test can check for Task 2: no claims in UI text and
 * docs (rule 4) and no remote resources in the web client (rule 2).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

function files(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, extensions);
    return extensions.some((e) => name.endsWith(e)) ? [path] : [];
  });
}

const FORBIDDEN = ["secure", "unhackable", "military-grade", "zero-knowledge", "quantum", "end-to-end encrypted", "verified", "private by design"];

describe("rule 4: no claims in the UI, docs or messages of the bridge", () => {
  const targets = [
    join(REPO, "docs/TRY-IT.md"),
    join(REPO, "README.md"),
    join(REPO, "packages/es-bridge/README.md"),
    join(REPO, "packages/es-web/README.md"),
    join(REPO, "packages/es-web/index.html"),
    ...files(join(REPO, "packages/es-web/src"), [".ts", ".tsx", ".css"]),
    ...files(join(REPO, "packages/es-bridge/src"), [".ts"]),
  ];
  it.each(targets.map((f) => [relative(REPO, f), f]))("%s", (_, file) => {
    // The TLS option of imapflow and nodemailer is called `secure`; it is a library name, not a claim.
    const text = readFileSync(file, "utf8").replace(/\bsecure\s*:/g, "").toLowerCase();
    expect(FORBIDDEN.filter((word) => text.includes(word))).toEqual([]);
  });
});

describe("rule 2: the web client loads nothing from the internet", () => {
  const targets = [join(REPO, "packages/es-web/index.html"), ...files(join(REPO, "packages/es-web/src"), [".ts", ".tsx", ".css"])];
  it.each(targets.map((f) => [relative(REPO, f), f]))("%s has no remote URL", (_, file) => {
    // The WebSocket goes to the page's own origin (the bridge): ws://${location.host}/…
    const urls = readFileSync(file, "utf8").match(/\b(?:https?|wss?):\/\/[^\s"'`)]+/g) ?? [];
    expect(urls.filter((url) => !url.startsWith("ws://${location.host}/"))).toEqual([]);
  });
});
