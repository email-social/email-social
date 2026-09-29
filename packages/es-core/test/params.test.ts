import { describe, expect, it } from "vitest";
import { parseContentDisposition, parseContentType } from "../src/headers/params.js";

describe("Content-Type (RFC 2045 §5.1)", () => {
  it("lowercases the media type and parameter names and unquotes values", () => {
    expect(parseContentType('Text/Plain; Charset="UTF-8"; Format=Flowed; DelSp=yes')).toEqual({
      type: "text/plain",
      params: { charset: "UTF-8", format: "Flowed", delsp: "yes" },
    });
    expect(parseContentType('multipart/mixed;\r\n\tboundary="----=_Part_12_345.678"')).toEqual({
      type: "multipart/mixed",
      params: { boundary: "----=_Part_12_345.678" },
    });
  });

  it("defaults to text/plain when the header is absent or unparseable (§5.2)", () => {
    expect(parseContentType(null)).toEqual({ type: "text/plain", params: {} });
    expect(parseContentType("")).toEqual({ type: "text/plain", params: {} });
    expect(parseContentType("garbage; charset=iso-8859-2")).toEqual({ type: "text/plain", params: { charset: "iso-8859-2" } });
    expect(parseContentType("; charset=utf-8")).toEqual({ type: "text/plain", params: { charset: "utf-8" } });
  });

  it("unescapes quoted-pairs in quoted values", () => {
    expect(parseContentType('application/octet-stream; name="say \\"hi\\" \\\\ now.txt"').params.name).toBe('say "hi" \\ now.txt');
  });

  it("tolerates spaces around '=', a trailing ';', missing quotes and unquoted values with spaces", () => {
    expect(parseContentType("text/html ; charset = windows-1250 ;")).toEqual({ type: "text/html", params: { charset: "windows-1250" } });
    expect(parseContentType("application/pdf; name=Annual report 2024.pdf; x=1")).toEqual({
      type: "application/pdf",
      params: { name: "Annual report 2024.pdf", x: "1" },
    });
    expect(parseContentType('text/plain; name="unterminated.txt').params.name).toBe("unterminated.txt");
  });

  it("keeps the first occurrence of a repeated parameter", () => {
    expect(parseContentType("text/plain; charset=utf-8; charset=iso-8859-1").params.charset).toBe("utf-8");
  });

  it("stores parameter names that clash with Object.prototype as ordinary keys", () => {
    const { params } = parseContentType("text/plain; constructor=a; __proto__=b; toString=c");
    expect(Object.keys(params)).toEqual(["constructor", "__proto__", "tostring"]);
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    expect(params.constructor).toBe("a");
  });

  it("decodes an RFC 2231 extended value with charset and language (§4)", () => {
    expect(parseContentType("application/pdf; name*=utf-8'cs'%C5%BEádost%20o%20dovolenou.pdf").params.name).toBe("žádost o dovolenou.pdf");
    expect(parseContentType("application/pdf; name*=iso-8859-2''%BEaloba.pdf").params.name).toBe("žaloba.pdf");
    expect(parseContentType("application/pdf; name*=''plain%20name.pdf").params.name).toBe("plain name.pdf");
  });

  it("joins RFC 2231 continuations in numeric order, decoding extended pieces (§3, §4.1)", () => {
    // Thunderbird-style: a long Czech filename split into percent-encoded pieces, a character split between pieces.
    const value =
      "attachment;\r\n filename*0*=UTF-8''P%C5%99%C3%ADli%C5%A1%20%C5%BElu%C5%A5ou%C4;\r\n filename*1*=%8Dk%C3%BD%20k%C5%AF%C5%88;\r\n filename*2=.txt";
    expect(parseContentDisposition(value)).toEqual({ disposition: "attachment", params: { filename: "Příliš žluťoučký kůň.txt" } });
    expect(parseContentType('message/external-body; access-type=URL; URL*1="/file.txt"; URL*0="ftp://ftp.example.com"').params.url).toBe(
      "ftp://ftp.example.com/file.txt",
    );
  });

  it("prefers an RFC 2231 value over a plain fallback of the same parameter", () => {
    expect(parseContentDisposition("attachment; filename=\"zadost.pdf\"; filename*=UTF-8''%C5%BE%C3%A1dost.pdf").params.filename).toBe("žádost.pdf");
  });

  it("decodes RFC 2047 encoded-words in quoted values (Gmail, Outlook)", () => {
    expect(parseContentType('application/pdf; name="=?UTF-8?B?xb7DoWRvc3QucGRm?="').params.name).toBe("žádost.pdf");
    expect(parseContentDisposition('attachment; filename="=?utf-8?Q?Nab=C3=ADdka_2024.xlsx?="').params.filename).toBe("Nabídka 2024.xlsx");
  });

  it("does not decode a boundary that happens to look like an encoded-word", () => {
    expect(parseContentType('multipart/mixed; boundary="=?q?q?b?="').params.boundary).toBe("=?q?q?b?=");
  });

  it("keeps raw UTF-8 filenames", () => {
    expect(parseContentType('image/jpeg; name="dovolená u moře.jpg"').params.name).toBe("dovolená u moře.jpg");
  });
});

describe("Content-Disposition (RFC 2183)", () => {
  it("returns null for an absent header", () => {
    expect(parseContentDisposition(null)).toEqual({ disposition: null, params: {} });
  });

  it("recognises inline and attachment in any case", () => {
    expect(parseContentDisposition("INLINE").disposition).toBe("inline");
    expect(parseContentDisposition('Attachment; filename="a.txt"; size=12')).toEqual({ disposition: "attachment", params: { filename: "a.txt", size: "12" } });
  });

  it("treats unknown or missing disposition types as attachment (§2.8)", () => {
    expect(parseContentDisposition("x-special; filename=a.bin").disposition).toBe("attachment");
    expect(parseContentDisposition('filename="lost-type.txt"')).toEqual({ disposition: "attachment", params: { filename: "lost-type.txt" } });
  });
});
