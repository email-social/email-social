/** WCAG 2.2 AA colour contrast of the palette in src/styles.css (1.4.3 text, 1.4.11 focus indicator). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const palette = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(palette[a]!), luminance(palette[b]!)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe("colour contrast (WCAG AA)", () => {
  it.each([
    ["text", "bg"],
    ["muted", "bg"],
    ["text", "panel"],
    ["muted", "panel"],
    ["text", "selected-bg"],
    ["muted", "selected-bg"],
    ["accent", "bg"],
    ["accent-text", "accent"],
    ["mine-text", "mine-bg"],
    ["mine-muted", "mine-bg"],
    ["theirs-text", "theirs-bg"],
    ["muted", "theirs-bg"],
    ["accent", "theirs-bg"],
    ["badge-text", "badge-bg"],
    ["error", "bg"],
    ["theirs-text", "card-bg"],
    ["muted", "card-bg"],
    ["mine-text", "mine-card-bg"],
    ["mine-muted", "mine-card-bg"],
  ])("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // The focus ring and the highlight of a bubble a quote card points to are drawn outside the element, on --bg.
  it.each([["focus", "bg"], ["focus", "panel"], ["focus", "selected-bg"], ["border", "bg"], ["accent", "card-bg"], ["mine-text", "mine-card-bg"]])("%s against %s is at least 3:1", (a, b) => {
    expect(contrast(a, b)).toBeGreaterThanOrEqual(3);
  });
});
