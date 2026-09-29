import { describe, expect, it } from "vitest";
import { extractPart, parseMessage } from "../src/index.js";
import { listFixtures, readFixture } from "./helpers/fixtures.js";

describe("extractPart: the decoded content of one attachment", () => {
  it("returns every listed attachment of every fixture with its metadata and decoded size", () => {
    let count = 0;
    for (const name of listFixtures()) {
      const raw = readFixture(name);
      for (const attachment of parseMessage(raw).attachments) {
        const part = extractPart(raw, attachment.partId);
        expect(part, `${name} part ${attachment.partId}`).not.toBeNull();
        expect(part!.contentType).toBe(attachment.contentType);
        expect(part!.filename).toBe(attachment.filename);
        expect(part!.bytes.length).toBe(attachment.size);
        count++;
      }
    }
    expect(count).toBe(5);
  });

  it("decodes base64 content (a PDF from Gmail and a JPEG from Apple Mail)", () => {
    const gmail = readFixture("gmail-web-attachment.eml");
    const pdf = parseMessage(gmail).attachments.find((a) => a.contentType === "application/pdf")!;
    expect(new TextDecoder().decode(extractPart(gmail, pdf.partId)!.bytes.subarray(0, 5))).toBe("%PDF-");

    const apple = readFixture("apple-mail-inline-image.eml");
    const jpeg = parseMessage(apple).attachments.find((a) => a.contentType === "image/jpeg")!;
    expect([...extractPart(apple, jpeg.partId)!.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it("gives the text of a text attachment as bytes, transfer encoding removed", () => {
    const raw = readFixture("mutt-attachment-patch.eml");
    const patch = parseMessage(raw).attachments.find((a) => a.contentType === "text/x-diff")!;
    expect(new TextDecoder().decode(extractPart(raw, patch.partId)!.bytes)).toContain("diff --git");
  });

  it("addresses the body of a single-part message as part 1 (RFC 9051 §6.4.5)", () => {
    const raw = "From: a@example.com\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello\r\n";
    expect(extractPart(raw, "1")).toEqual({ contentType: "text/plain", filename: null, bytes: new TextEncoder().encode("Hello\r\n") });
  });

  it("returns null for a part that does not exist or is a multipart container", () => {
    const raw = readFixture("gmail-web-attachment.eml");
    for (const partId of ["", "0", "9", "1.9", "x", "1..2"]) expect(extractPart(raw, partId), partId).toBeNull();
    // Part 1 of this message is the multipart/alternative body, not a leaf.
    expect(extractPart(raw, "1")).toBeNull();
    expect(extractPart(new Uint8Array(), "1")).toEqual({ contentType: "text/plain", filename: null, bytes: new Uint8Array() });
  });
});
