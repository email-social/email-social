/** The footer the bridge writes and the one the web client recognises are the same sentence. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_SOCIAL_FOOTER } from "../src/format.js";

describe("Email Social footer", () => {
  it("matches es-bridge's FOOTER", () => {
    const session = readFileSync(new URL("../../es-bridge/src/session.ts", import.meta.url), "utf8");
    expect(session).toContain(`export const FOOTER = ${JSON.stringify(EMAIL_SOCIAL_FOOTER)};`);
  });
});
