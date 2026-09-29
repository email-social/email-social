import { describe, expect, it } from "vitest";
import { decodeBody, decodedSize, parseMimeTree, type MimeNode } from "../src/mime/tree.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
/** Lines joined with CRLF, as on the wire. */
const crlf = (...lines: string[]): Uint8Array => enc.encode(lines.join("\r\n"));
const lf = (...lines: string[]): Uint8Array => enc.encode(lines.join("\n"));
const text = (node: MimeNode | undefined): string => dec.decode(node!.body);
const ids = (node: MimeNode): string[] => [node.partId, ...node.children.flatMap(ids)];

describe("parseMimeTree: single-part messages", () => {
  it("gives a non-multipart message one leaf root with part id '' and the body after the empty line", () => {
    const root = parseMimeTree(crlf("Subject: hi", "", "Hello", "world", ""));
    expect(root.partId).toBe("");
    expect(root.children).toEqual([]);
    expect(root.contentType).toBe("text/plain"); // RFC 2045 §5.2 default
    expect(root.transferEncoding).toBe("7bit"); // RFC 2045 §6.1 default
    expect(root.disposition).toBeNull();
    expect(root.contentId).toBeNull();
    expect(text(root)).toBe("Hello\r\nworld\r\n");
    expect(root.fields.map((f) => f.key)).toEqual(["subject"]);
  });

  it("reads type, parameters, disposition, transfer encoding and Content-ID of a part", () => {
    const root = parseMimeTree(
      crlf(
        "Content-Type: Image/JPEG; name=\"a.jpg\"",
        "Content-Disposition: INLINE; filename=a.jpg",
        "Content-Transfer-Encoding:  Base64 ",
        "Content-ID: <img1@example.com>",
        "",
        "AAAA",
      ),
    );
    expect(root.contentType).toBe("image/jpeg");
    expect(root.params).toEqual({ name: "a.jpg" });
    expect(root.disposition).toBe("inline");
    expect(root.dispositionParams).toEqual({ filename: "a.jpg" });
    expect(root.transferEncoding).toBe("base64");
    expect(root.contentId).toBe("<img1@example.com>");
  });

  it("puts a Content-ID without angle brackets (or with a comment) into angle brackets", () => {
    expect(parseMimeTree(crlf("Content-ID: part1.abc", "", "")).contentId).toBe("<part1.abc>");
    expect(parseMimeTree(crlf("Content-ID: <x@example.com> (logo)", "", "")).contentId).toBe("<x@example.com>");
    expect(parseMimeTree(crlf("Content-ID: <>", "", "")).contentId).toBeNull();
  });

  it("treats input without an empty line as header only, with an empty body", () => {
    const root = parseMimeTree(crlf("Subject: only headers", "From: a@example.com"));
    expect(root.fields).toHaveLength(2);
    expect(root.body.length).toBe(0);
  });

  it("does not descend into message/rfc822 or message/global parts", () => {
    for (const type of ["message/rfc822", "message/global"]) {
      const root = parseMimeTree(
        crlf(
          `Content-Type: ${type}`,
          "",
          "Content-Type: multipart/mixed; boundary=inner",
          "",
          "--inner",
          "",
          "x",
          "--inner--",
          "",
        ),
      );
      expect(root.contentType).toBe(type);
      expect(root.children).toEqual([]);
      expect(text(root)).toContain("--inner--");
    }
  });
});

describe("parseMimeTree: multipart bodies (RFC 2046 §5.1.1)", () => {
  it("numbers the parts of a multipart like IMAP (RFC 9051 §6.4.5) and gives each part its own headers", () => {
    const root = parseMimeTree(
      crlf(
        "Content-Type: multipart/mixed; boundary=\"b1\"",
        "",
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "first",
        "--b1",
        "Content-Type: application/pdf",
        "Content-Transfer-Encoding: base64",
        "",
        "JVBERg==",
        "--b1--",
        "",
      ),
    );
    expect(root.contentType).toBe("multipart/mixed");
    expect(root.children.map((c) => c.partId)).toEqual(["1", "2"]);
    expect(root.children.map((c) => c.contentType)).toEqual(["text/plain", "application/pdf"]);
    expect(root.children[0]!.params).toEqual({ charset: "utf-8" });
    expect(text(root.children[0])).toBe("first");
    expect(text(root.children[1])).toBe("JVBERg==");
  });

  it("gives the line break before a delimiter to the delimiter, and only that one line break", () => {
    const root = parseMimeTree(
      crlf("Content-Type: multipart/mixed; boundary=b", "", "--b", "", "line", "", "--b", "", "", "--b--", ""),
    );
    expect(text(root.children[0])).toBe("line\r\n");
    expect(text(root.children[1])).toBe("");
  });

  it("gives a part between two adjacent delimiter lines an empty body", () => {
    const root = parseMimeTree(crlf("Content-Type: multipart/mixed; boundary=b", "", "--b", "--b", "", "x", "--b--"));
    expect(root.children).toHaveLength(2);
    expect(root.children[0]!.body.length).toBe(0);
    expect(root.children[0]!.fields).toEqual([]);
    expect(text(root.children[1])).toBe("x");
  });

  it("ignores the preamble and the epilogue", () => {
    const root = parseMimeTree(
      crlf(
        "Content-Type: multipart/mixed; boundary=b",
        "",
        "This is a multi-part message in MIME format.",
        "--b",
        "",
        "body",
        "--b--",
        "epilogue text",
        "--b",
        "",
        "not a part",
        "",
      ),
    );
    expect(root.children).toHaveLength(1);
    expect(text(root.children[0])).toBe("body");
  });

  it("accepts transport padding (spaces and tabs) after delimiters and the close delimiter", () => {
    const root = parseMimeTree(
      crlf("Content-Type: multipart/mixed; boundary=b", "", "--b \t", "", "one", "--b  ", "", "two", "--b-- \t", "tail"),
    );
    expect(root.children.map(text)).toEqual(["one", "two"]);
  });

  it("ends the multipart at the end of input when the close delimiter is missing", () => {
    const root = parseMimeTree(crlf("Content-Type: multipart/mixed; boundary=b", "", "--b", "", "one", "--b", "", "two", "tail", ""));
    expect(root.children.map(text)).toEqual(["one", "two\r\ntail\r\n"]);
  });

  it("does not take boundary-like lines for delimiters", () => {
    const root = parseMimeTree(
      crlf(
        "Content-Type: multipart/mixed; boundary=b",
        "",
        "--b",
        "",
        "--bb",
        "--b-x",
        "---b",
        " --b",
        "x--b",
        "--B",
        "--b--x",
        "--b",
        "",
        "second",
        "--b--",
      ),
    );
    expect(root.children).toHaveLength(2);
    expect(text(root.children[0])).toBe("--bb\r\n--b-x\r\n---b\r\n --b\r\nx--b\r\n--B\r\n--b--x");
  });

  it("finds boundaries that contain characters special in regular expressions or quoted-printable", () => {
    const boundary = "===============4265789137540932190==";
    const apple = "Apple-Mail=_0B2D4F6A+(x)?.*";
    const root = parseMimeTree(
      crlf(
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        `Content-Type: multipart/alternative; boundary="${apple}"`,
        "",
        `--${apple}`,
        "",
        "plain",
        `--${apple}--`,
        `--${boundary}--`,
      ),
    );
    expect(ids(root)).toEqual(["", "1", "1.1"]);
    expect(text(root.children[0]!.children[0])).toBe("plain");
  });

  it("numbers nested multiparts '2.1', '2.2' and handles an inner close delimiter right before the outer delimiter", () => {
    const root = parseMimeTree(
      crlf(
        "Content-Type: multipart/mixed; boundary=outer",
        "",
        "--outer",
        "Content-Type: text/plain",
        "",
        "intro",
        "--outer",
        "Content-Type: multipart/alternative; boundary=inner",
        "",
        "--inner",
        "Content-Type: text/plain",
        "",
        "plain",
        "--inner",
        "Content-Type: text/html",
        "",
        "<p>html</p>",
        "--inner--",
        "--outer",
        "Content-Type: application/octet-stream",
        "",
        "bin",
        "--outer--",
        "",
      ),
    );
    expect(ids(root)).toEqual(["", "1", "2", "2.1", "2.2", "3"]);
    const alt = root.children[1]!;
    expect(alt.contentType).toBe("multipart/alternative");
    expect(alt.children.map(text)).toEqual(["plain", "<p>html</p>"]);
    expect(text(root.children[2])).toBe("bin");
  });

  it("parses LF-only messages the same way", () => {
    const root = parseMimeTree(
      lf("Content-Type: multipart/mixed; boundary=b", "", "--b", "Content-Type: text/plain", "", "a", "", "--b", "", "b", "--b--", ""),
    );
    expect(root.children.map(text)).toEqual(["a\n", "b"]);
    expect(root.children[0]!.contentType).toBe("text/plain");
  });

  it("treats a multipart without a boundary parameter as a text/plain leaf", () => {
    const root = parseMimeTree(crlf("Content-Type: multipart/mixed", "", "--x", "", "text", ""));
    expect(root.contentType).toBe("text/plain");
    expect(root.children).toEqual([]);
    expect(text(root)).toBe("--x\r\n\r\ntext\r\n");
  });

  it("treats a multipart whose body has no delimiter line as a text/plain leaf, so its content is not lost", () => {
    const root = parseMimeTree(crlf("Content-Type: multipart/alternative; boundary=zzz", "", "--other", "", "Hello", ""));
    expect(root.contentType).toBe("text/plain");
    expect(root.children).toEqual([]);
    expect(text(root)).toContain("Hello");
  });

  it("gives a part without headers the default type, and a part without an empty line its whole content as body", () => {
    const root = parseMimeTree(
      crlf("Content-Type: multipart/mixed; boundary=b", "", "--b", "", "no headers", "--b", "Just text, no header", "line 2", "--b--"),
    );
    expect(root.children.map((c) => c.contentType)).toEqual(["text/plain", "text/plain"]);
    expect(text(root.children[0])).toBe("no headers");
    expect(root.children[1]!.fields).toEqual([]);
    expect(text(root.children[1])).toBe("Just text, no header\r\nline 2");
  });

  it("defaults parts of multipart/digest to message/rfc822 (RFC 2046 §5.1.5)", () => {
    const root = parseMimeTree(
      crlf(
        "Content-Type: multipart/digest; boundary=d",
        "",
        "--d",
        "",
        "Subject: one",
        "",
        "body",
        "--d",
        "Content-Type: text/plain",
        "",
        "note",
        "--d--",
      ),
    );
    expect(root.children.map((c) => c.contentType)).toEqual(["message/rfc822", "text/plain"]);
  });

  it("stops descending at depth 32: deeper multiparts stay leaves", () => {
    const depth = 40;
    const lines: string[] = [];
    for (let i = 0; i < depth; i++) lines.push(`Content-Type: multipart/mixed; boundary=b${i}`, "", `--b${i}`);
    lines.push("Content-Type: text/plain", "", "deep");
    for (let i = depth - 1; i >= 0; i--) lines.push(`--b${i}--`);
    let node = parseMimeTree(crlf(...lines));
    let levels = 0;
    while (node.children.length > 0) {
      expect(node.children).toHaveLength(1);
      node = node.children[0]!;
      levels++;
    }
    expect(levels).toBe(32);
    expect(node.partId.split(".")).toHaveLength(32);
    expect(node.partId).toBe(Array(32).fill("1").join("."));
    expect(node.contentType).toBe("multipart/mixed");
  });

  it("never throws on truncated or malformed multipart input", () => {
    const base = "Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: multipart/alternative; boundary=c\r\n\r\n--c\r\n\r\nx\r\n--c--\r\n--b--\r\n";
    for (let cut = 0; cut <= base.length; cut++) {
      expect(() => parseMimeTree(enc.encode(base.slice(0, cut)))).not.toThrow();
    }
  });
});

describe("decodeBody and decodedSize", () => {
  const leaf = (encoding: string | null, body: string): MimeNode =>
    parseMimeTree(
      crlf(...(encoding === null ? [] : [`Content-Transfer-Encoding: ${encoding}`]), "Content-Type: application/octet-stream", "", body),
    );

  it("removes base64, ignoring line breaks and junk (RFC 2045 §6.8)", () => {
    const node = leaf("base64", "SGVs\r\nbG8g\r\nd29y bGQ=");
    expect(dec.decode(decodeBody(node))).toBe("Hello world");
    expect(decodedSize(node)).toBe(11);
  });

  it("removes quoted-printable, joining soft line breaks (RFC 2045 §6.7)", () => {
    const node = leaf("quoted-printable", "caf=C3=A9 au =\r\nlait=3D1");
    expect(dec.decode(decodeBody(node))).toBe("café au lait=1");
    expect(decodedSize(node)).toBe(15);
  });

  it("returns 7bit, 8bit, binary, unknown and absent encodings unchanged", () => {
    for (const encoding of ["7bit", "8bit", "binary", "x-uuencode", null]) {
      const node = leaf(encoding, "a=3D b");
      expect(dec.decode(decodeBody(node))).toBe("a=3D b");
      expect(decodedSize(node)).toBe(6);
    }
  });

  it("gives decodedSize equal to the decoded length for every base64 padding variant", () => {
    for (const body of ["", "QQ", "QUI", "QUJD", "QUJDRA==", "QU JD\r\nRE U=", "!!QUJD??"]) {
      const node = leaf("base64", body);
      expect(decodedSize(node), body).toBe(decodeBody(node).length);
    }
  });
});
