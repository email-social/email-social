import { describe, expect, it } from "vitest";
import { decodeText, isSupportedCharset } from "../src/codec/charset.js";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// "Příliš žluťoučký kůň" in the single-byte Central European encodings.
const czechWin1250 = bytes(0x50, 0xf8, 0xed, 0x6c, 0x69, 0x9a, 0x20, 0x9e, 0x6c, 0x75, 0x9d, 0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x20, 0x6b, 0xf9, 0xf2);
const czechLatin2 = bytes(0x50, 0xf8, 0xed, 0x6c, 0x69, 0xb9, 0x20, 0xbe, 0x6c, 0x75, 0xbb, 0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x20, 0x6b, 0xf9, 0xf2);

describe("charset decoding", () => {
  it("decodes UTF-8 whatever the case or spelling of the label", () => {
    for (const label of ["utf-8", "UTF-8", "utf8", " \"UTF-8\" ", "unicode-1-1-utf-8"]) {
      expect(decodeText(utf8("Jana Nováková 😀"), label), label).toBe("Jana Nováková 😀");
    }
  });

  it("decodes windows-1250 (Outlook and Seznam.cz in the Czech locale)", () => {
    expect(decodeText(czechWin1250, "windows-1250")).toBe("Příliš žluťoučký kůň");
    expect(decodeText(czechWin1250, "cp1250")).toBe("Příliš žluťoučký kůň");
  });

  it("decodes iso-8859-2 under its common labels", () => {
    for (const label of ["iso-8859-2", "ISO-8859-2", "latin2", "iso_8859-2", "l2"]) {
      expect(decodeText(czechLatin2, label), label).toBe("Příliš žluťoučký kůň");
    }
  });

  it("decodes koi8-r", () => {
    // "Привет" in KOI8-R.
    expect(decodeText(bytes(0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4), "koi8-r")).toBe("Привет");
  });

  it("reads iso-8859-1 as windows-1252, as the WHATWG Encoding standard and real senders do", () => {
    // 0x80 is the euro sign and 0x93/0x94 are curly quotes in windows-1252, C1 controls in ISO-8859-1.
    expect(decodeText(bytes(0x80, 0x20, 0x93, 0x63, 0x61, 0x66, 0xe9, 0x94), "iso-8859-1")).toBe("€ “café”");
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9), "latin1")).toBe("café");
  });

  it("decodes multi-byte legacy charsets", () => {
    // "日本" in Shift_JIS and ISO-2022-JP (the usual Japanese mail charset, RFC 1468).
    expect(decodeText(bytes(0x93, 0xfa, 0x96, 0x7b), "shift_jis")).toBe("日本");
    expect(decodeText(bytes(0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x1b, 0x28, 0x42), "iso-2022-jp")).toBe("日本");
  });

  it("decodes unlabelled or us-ascii-labelled 8-bit text as UTF-8 when it is valid UTF-8", () => {
    for (const label of [null, undefined, "", "us-ascii", "ASCII", "ansi_x3.4-1968", "iso646-us"]) {
      expect(decodeText(utf8("Dobrý den"), label), String(label)).toBe("Dobrý den");
      expect(decodeText(utf8("plain ascii"), label), String(label)).toBe("plain ascii");
    }
  });

  it("falls back to windows-1252 for 8-bit text that is not valid UTF-8", () => {
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9), null)).toBe("café");
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9), "us-ascii")).toBe("café");
  });

  it("falls back for labels the Encoding standard does not know", () => {
    for (const label of ["utf-7", "x-unknown", "cp852", "unknown-8bit", "x-user-defined", "iso-2022-kr", "nonsense label"]) {
      expect(decodeText(utf8("Dobrý den"), label), label).toBe("Dobrý den");
      expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9), label), label).toBe("café");
    }
  });

  it("removes a UTF-8 byte order mark", () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x68, 0x69), "utf-8")).toBe("hi");
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x68, 0xc3, 0xad), null)).toBe("hí");
  });

  it("replaces invalid sequences in a labelled charset instead of throwing", () => {
    expect(decodeText(bytes(0x61, 0xff, 0x62), "utf-8")).toBe("a�b");
  });

  it("decodes UTF-16 with its label", () => {
    expect(decodeText(bytes(0x3d, 0x04, 0x30, 0x00), "utf-16le")).toBe("н0");
  });

  it("reports which labels are supported", () => {
    expect(isSupportedCharset("utf-8")).toBe(true);
    expect(isSupportedCharset("Windows-1250")).toBe(true);
    expect(isSupportedCharset("us-ascii")).toBe(true);
    expect(isSupportedCharset("utf-7")).toBe(false);
    expect(isSupportedCharset("iso-2022-kr")).toBe(false);
    expect(isSupportedCharset("")).toBe(false);
  });
});
