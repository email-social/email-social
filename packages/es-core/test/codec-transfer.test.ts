import { describe, expect, it } from "vitest";
import { base64Decode, base64DecodedLength, base64Encode } from "../src/codec/base64.js";
import { qpDecode, qpEncodeText } from "../src/codec/quoted-printable.js";
import { mulberry32, pick, randomInt } from "./helpers/prng.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const latin1 = (b: Uint8Array): string => String.fromCharCode(...b);
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe("base64 (RFC 2045 §6.8)", () => {
  it("encodes the RFC 4648 §10 test vectors", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "Zg=="],
      ["fo", "Zm8="],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg=="],
      ["fooba", "Zm9vYmE="],
      ["foobar", "Zm9vYmFy"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base64Encode(enc(plain))).toBe(encoded);
      expect(dec(base64Decode(encoded))).toBe(plain);
    }
  });

  it("wraps encoded lines at 76 characters with CRLF and no trailing line break", () => {
    const data = new Uint8Array(200).map((_, i) => i);
    const out = base64Encode(data);
    const lines = out.split("\r\n");
    expect(lines.length).toBe(4);
    expect(lines.slice(0, 3).every((l) => l.length === 76)).toBe(true);
    expect(out.endsWith("\r\n")).toBe(false);
    expect(base64Encode(data, 0)).not.toContain("\r\n");
    expect(base64Encode(data, 0)).toBe(lines.join(""));
  });

  it("uses the + and / characters of the standard alphabet", () => {
    expect(base64Encode(bytes(0xfb, 0xff, 0xbf))).toBe("+/+/");
    expect(base64Decode("+/+/")).toEqual(bytes(0xfb, 0xff, 0xbf));
  });

  it("ignores line breaks, whitespace and characters outside the alphabet", () => {
    // RFC 2045 §6.8: "Any characters outside of the base64 alphabet are to be ignored".
    expect(dec(base64Decode("Zm9v\r\nYmFy\r\n"))).toBe("foobar");
    expect(dec(base64Decode("  Zm 9v\tYm\nFy  "))).toBe("foobar");
    expect(dec(base64Decode("Zm9v!YmFy*"))).toBe("foobar");
    expect(dec(base64Decode("Zm9v-YmFy_"))).toBe("foobar");
  });

  it("tolerates missing padding", () => {
    expect(dec(base64Decode("Zg"))).toBe("f");
    expect(dec(base64Decode("Zm8"))).toBe("fo");
    expect(dec(base64Decode("Zm9vYg"))).toBe("foob");
    // A single leftover character carries fewer than 8 bits and is dropped.
    expect(dec(base64Decode("Zm9vY"))).toBe("foo");
  });

  it("stops at the first padding character", () => {
    expect(dec(base64Decode("Zg==Zm9v"))).toBe("f");
    expect(dec(base64Decode("Zm8=\r\n\r\n--boundary junk"))).toBe("fo");
    expect(base64Decode("====")).toEqual(new Uint8Array(0));
  });

  it("computes the decoded length without decoding", () => {
    for (const text of ["", "Zg==", "Zm8", "Zm9v YmFy", "Zm9vY", "Zg==Zm9v", "!!", "Zm9v\r\nYmE=\r\n", "žZm9v"]) {
      expect(base64DecodedLength(text), JSON.stringify(text)).toBe(base64Decode(text).length);
    }
  });

  it("round trips random binary data of every length up to 300 bytes", () => {
    const random = mulberry32(2045);
    for (let length = 0; length <= 300; length++) {
      const data = new Uint8Array(length).map(() => randomInt(random, 0, 255));
      const encoded = base64Encode(data, pick(random, [0, 76, 64]));
      expect(/^[A-Za-z0-9+/=\r\n]*$/.test(encoded)).toBe(true);
      expect(base64Decode(encoded)).toEqual(data);
      expect(base64DecodedLength(encoded)).toBe(length);
    }
  });
});

describe("quoted-printable decoding (RFC 2045 §6.7)", () => {
  it("decodes =XX triplets in upper and lower case hexadecimal", () => {
    expect(dec(qpDecode(enc("P=C5=99=C3=ADli=C5=A1 =c5=belu=c5=a5ou=c4=8dk=c3=bd k=C5=AF=c5=88")))).toBe("Příliš žluťoučký kůň");
  });

  it("removes soft line breaks, including a UTF-8 sequence split across them", () => {
    // "č" is C4 8D; Outlook breaks lines between the two bytes of a character.
    expect(dec(qpDecode(enc("Dobr=C3=BD den, pan=C3=AD Nov=C3=A1kov=C3=A1, v=C3=A1=C5=\r\n=BEen=C3=A1 pan=C3=AD =C4=\n=8Ctenn=C3=A1")))).toBe(
      "Dobrý den, paní Nováková, vážená paní Čtenná",
    );
    expect(dec(qpDecode(enc("one =\r\ntwo=\nthree=")))).toBe("one twothree");
  });

  it("treats whitespace after a soft break '=' as transport padding", () => {
    expect(dec(qpDecode(enc("soft = \t\r\nbreak=  \nend")))).toBe("soft break" + "end");
  });

  it("removes trailing whitespace of an encoded line but keeps encoded whitespace", () => {
    // §6.7 rule 3: literal trailing white space was added in transport; =20 / =09 is data.
    expect(dec(qpDecode(enc("line one   \r\nline two\t\t\r\nline three=20\r\nlast=09  ")))).toBe(
      "line one\r\nline two\r\nline three \r\nlast\t",
    );
  });

  it("keeps CRLF and LF hard line breaks exactly as they are", () => {
    expect(dec(qpDecode(enc("a\r\nb\nc\r\n")))).toBe("a\r\nb\nc\r\n");
  });

  it("keeps an invalid '=' sequence literally", () => {
    expect(dec(qpDecode(enc("50% =off, a=b, x==3D, =G1 and =4")))).toBe("50% =off, a=b, x==, =G1 and =4");
    expect(dec(qpDecode(enc("E=mc2")))).toBe("E=mc2");
  });

  it("passes 8-bit bytes through unchanged", () => {
    // A windows-1250 body that a careless sender labelled quoted-printable without encoding it.
    expect(latin1(qpDecode(bytes(0x9a, 0x3d, 0x45, 0x38, 0x20, 0xe8)))).toBe("\x9a\xe8 \xe8");
  });
});

describe("quoted-printable encoding", () => {
  const roundTrip = (text: string): string => dec(qpDecode(enc(qpEncodeText(text)))).replace(/\r\n/g, "\n");
  const lineLengths = (qp: string): number[] => qp.split("\r\n").map((l) => l.length);

  it("leaves plain ASCII alone and writes hard breaks as CRLF", () => {
    expect(qpEncodeText("Hello Bob,\nsee you tomorrow.\n")).toBe("Hello Bob,\r\nsee you tomorrow.\r\n");
  });

  it("encodes '=', non-ASCII bytes and control characters in upper case hex", () => {
    expect(qpEncodeText("a=b")).toBe("a=3Db");
    expect(qpEncodeText("žluťoučký")).toBe("=C5=BElu=C5=A5ou=C4=8Dk=C3=BD");
    expect(qpEncodeText("bell\x07 del\x7f cr\r tab\tok")).toBe("bell=07 del=7F cr=0D tab\tok");
  });

  it("encodes a space or tab at the end of a line", () => {
    expect(qpEncodeText("trailing \nspaces\t\nend ")).toBe("trailing=20\r\nspaces=09\r\nend=20");
  });

  it("protects lines starting with 'From ' and '.'", () => {
    expect(qpEncodeText("From here\nfrom there\n.\n.hidden\na.b")).toBe("=46rom here\r\nfrom there\r\n=2E\r\n=2Ehidden\r\na.b");
  });

  it("wraps long lines with soft breaks at 76 characters, never splitting a triplet", () => {
    const text = "Příliš žluťoučký kůň úpěl ďábelské ódy. ".repeat(8);
    const qp = qpEncodeText(text);
    expect(Math.max(...lineLengths(qp))).toBeLessThanOrEqual(76);
    for (const line of qp.split("\r\n")) expect(/=(?![0-9A-F]{2}|$)/.test(line), line).toBe(false);
    expect(roundTrip(text)).toBe(text);
  });

  it("applies the start-of-line protections to lines created by soft breaks", () => {
    const text = "x".repeat(75) + ".dot" + "\n" + "y".repeat(75) + "From me";
    const qp = qpEncodeText(text);
    for (const line of qp.split("\r\n")) {
      expect(line.startsWith(".")).toBe(false);
      expect(line.startsWith("From ")).toBe(false);
    }
    expect(roundTrip(text)).toBe(text);
  });

  it("round trips generated text and keeps every line within 76 ASCII characters", () => {
    const random = mulberry32(7);
    const pieces = ["a", "Z", " ", "\t", "=", ".", "From ", "\n", "ž", "ř", "😀", "é", "日本", "_", "?", "=?", "\x01", "  ", "x".repeat(40)];
    for (let n = 0; n < 200; n++) {
      let text = "";
      const count = randomInt(random, 0, 60);
      for (let i = 0; i < count; i++) text += pick(random, pieces);
      const qp = qpEncodeText(text);
      expect(/^[\x09\x0d\x0a\x20-\x7e]*$/.test(qp)).toBe(true);
      expect(Math.max(0, ...lineLengths(qp))).toBeLessThanOrEqual(76);
      for (const line of qp.split("\r\n")) expect(/[ \t]$/.test(line), JSON.stringify(line)).toBe(false);
      expect(roundTrip(text)).toBe(text);
    }
  });
});
