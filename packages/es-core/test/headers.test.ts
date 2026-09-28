import { describe, expect, it } from "vitest";
import { getHeader, getHeaders, parseHeaderFields, splitHeaderBody } from "../src/headers/header-block.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const split = (raw: string): { header: string; body: string } => {
  const { header, body } = splitHeaderBody(enc(raw));
  return { header: dec(header), body: dec(body) };
};
const fields = (raw: string) => parseHeaderFields(enc(raw));

describe("splitting header and body (RFC 5322 §2.1)", () => {
  it("splits at the first empty line with CRLF line endings", () => {
    const { header, body } = split("From: alice@example.com\r\nSubject: Hi\r\n\r\nHello\r\n\r\nBye\r\n");
    expect(body).toBe("Hello\r\n\r\nBye\r\n");
    expect(header.startsWith("From: alice@example.com\r\nSubject: Hi")).toBe(true);
    expect(header).not.toContain("Hello");
  });

  it("accepts LF-only and mixed line endings at the separator", () => {
    expect(split("Subject: a\n\nbody\n").body).toBe("body\n");
    expect(split("Subject: a\r\n\nbody").body).toBe("body");
    expect(split("Subject: a\n\r\nbody").body).toBe("body");
  });

  it("treats a message without an empty line as all header", () => {
    expect(split("Subject: a\r\nFrom: b@example.com\r\n")).toEqual({ header: "Subject: a\r\nFrom: b@example.com\r\n", body: "" });
    expect(split("Subject: a")).toEqual({ header: "Subject: a", body: "" });
  });

  it("returns an empty header when the input starts with an empty line", () => {
    expect(split("\r\nonly body")).toEqual({ header: "", body: "only body" });
  });

  it("skips an mbox 'From ' envelope line but not an obsolete 'From :' field", () => {
    const mbox = split("From alice@example.com Mon Jan 15 09:30:00 2024\nFrom: alice@example.com\nSubject: x\n\nbody");
    expect(mbox.header.startsWith("From: alice@example.com")).toBe(true);
    expect(mbox.body).toBe("body");
    const obsolete = split("From : alice@example.com\r\n\r\nbody");
    expect(getHeader(parseHeaderFields(enc(obsolete.header)), "from")).toBe("alice@example.com");
  });

  it("keeps the body bytes exactly, including 8-bit data", () => {
    const raw = new Uint8Array([...enc("Subject: x\r\n\r\n"), 0xe8, 0x0d, 0x0a, 0x00, 0xff]);
    expect(Array.from(splitHeaderBody(raw).body)).toEqual([0xe8, 0x0d, 0x0a, 0x00, 0xff]);
  });
});

describe("header fields (RFC 5322 §2.2)", () => {
  it("parses names, lowercased keys and trimmed values", () => {
    expect(fields("Subject:   Hello there  \r\nX-Mailer: Example Mail 1.0\r\n")).toEqual([
      { name: "Subject", key: "subject", value: "Hello there" },
      { name: "X-Mailer", key: "x-mailer", value: "Example Mail 1.0" },
    ]);
  });

  it("unfolds continuation lines by removing only the line break (§2.2.3)", () => {
    const parsed = fields("Subject: a long\r\n subject\r\n\tcontinued\r\nReferences: <a@example.com>\n <b@example.com>\n");
    expect(parsed.map((f) => f.value)).toEqual(["a long subject\tcontinued", "<a@example.com> <b@example.com>"]);
  });

  it("keeps whitespace-only continuation lines inside the field", () => {
    expect(fields("Subject: one\r\n \r\n two\r\n")[0]!.value).toBe("one  two");
  });

  it("accepts whitespace before the colon (obsolete syntax, §4.5.3)", () => {
    expect(fields("Subject : old style\r\nTo\t: bob@example.com\r\n")).toEqual([
      { name: "Subject", key: "subject", value: "old style" },
      { name: "To", key: "to", value: "bob@example.com" },
    ]);
  });

  it("keeps an empty value and a value containing colons", () => {
    expect(fields("Subject:\r\nX-Note: a: b: c\r\n").map((f) => f.value)).toEqual(["", "a: b: c"]);
  });

  it("skips lines without a colon and continuations of skipped lines", () => {
    expect(fields(" orphan continuation\r\nnot a header line\r\n still garbage\r\nSubject: kept\r\nbad name: x\r\n: no name\r\n")).toEqual([
      { name: "Subject", key: "subject", value: "kept" },
    ]);
  });

  it("decodes raw UTF-8 values (RFC 6532) and falls back to windows-1252 per field", () => {
    const raw = new Uint8Array([
      ...enc("Subject: Dobrý den\r\nX-Legacy: caf"), 0xe9, ...enc("\r\nFrom: Jana Nováková <jana@example.com>\r\n"),
    ]);
    expect(parseHeaderFields(raw).map((f) => f.value)).toEqual(["Dobrý den", "café", "Jana Nováková <jana@example.com>"]);
  });

  it("does not decode RFC 2047 encoded-words", () => {
    expect(fields("Subject: =?utf-8?q?caf=C3=A9?=\r\n")[0]!.value).toBe("=?utf-8?q?caf=C3=A9?=");
  });

  it("finds fields by name without regard to case", () => {
    const parsed = fields("Received: from a.example.com\r\nreceived: from b.example.com\r\nSUBJECT: hi\r\n");
    expect(getHeader(parsed, "Subject")).toBe("hi");
    expect(getHeader(parsed, "RECEIVED")).toBe("from a.example.com");
    expect(getHeaders(parsed, "received")).toEqual(["from a.example.com", "from b.example.com"]);
    expect(getHeader(parsed, "Date")).toBeNull();
    expect(getHeaders(parsed, "date")).toEqual([]);
  });
});
