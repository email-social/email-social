import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as esCore from "../src/index.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** The fenced code block that follows a "## <title>" heading. */
function blockAfter(title: string): string {
  const match = new RegExp(`^## ${title}\\n[\\s\\S]*?\`\`\`ts\\n([\\s\\S]*?)\`\`\``, "m").exec(readme);
  if (match === null) throw new Error(`no code block under "## ${title}"`);
  return match[1]!;
}

describe("packages/es-core/README.md", () => {
  it("states the API in at most 15 lines", () => {
    const api = blockAfter("API").trimEnd().split("\n");
    expect(api.length).toBeGreaterThan(5);
    expect(api.length).toBeLessThanOrEqual(15);
  });

  it("names every export of the public API", () => {
    const api = blockAfter("API");
    for (const name of Object.keys(esCore)) expect(api, name).toContain(name);
  });

  it("has one example that imports from the package", () => {
    expect(readme.match(/^## Example$/gm)).toHaveLength(1);
    expect(blockAfter("Example")).toContain('from "@email-social/es-core"');
  });
});
