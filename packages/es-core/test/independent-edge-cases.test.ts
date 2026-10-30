/**
 * The two inputs on which the independent parser (independent/REPORT.md)
 * and es-core disagreed: independent/tools/probe.mjs "RD-14 BOM with
 * windows-1250" and independent/tools/fuzz.mjs 400, mutt-iso-8859-2.json
 * round 213 (a mutation that put the bytes EF BB BF at the start of the From
 * name's iso-8859-2 encoded-word), reduced to the field that differed.
 *
 * Section 6.5 step 5 removes a UTF-8 byte order mark. Under a label that is
 * not UTF-8, EF BB BF is not one: step 3 decodes the bytes with the labelled
 * charset, where they are three ordinary characters. es-core is right; the
 * independent parser removed the bytes before decoding.
 */
import { describe, expect, it } from "vitest";
import { parseMessage } from "../src/parse.js";

const BOM = [0xef, 0xbb, 0xbf];
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

describe("RD-14 step 5: the bytes EF BB BF under a label that is not UTF-8", () => {
  it("keeps them as text at the start of a windows-1250 part (ď»ż)", () => {
    const raw = new Uint8Array([...ascii("Content-Type: text/plain; charset=windows-1250\r\n\r\n"), ...BOM, 0x41]);
    expect(parseMessage(raw).text).toBe("ď»żA");
  });

  it("keeps them as text at the start of an iso-8859-2 encoded-word (ďťż)", () => {
    const raw = new Uint8Array([
      ...ascii("From: =?iso-8859-2?Q?"),
      ...BOM,
      ...ascii("Ond=F8ej_Bene=B9?= <ondrej@host.example.com>\r\nSubject: x\r\n\r\nbody\r\n"),
    ]);
    expect(parseMessage(raw).from).toEqual({ name: "ďťżOndřej Beneš", address: "ondrej@host.example.com" });
  });

  it("removes them at the start of a UTF-8 encoded-word and of a UTF-8 part", () => {
    const word = parseMessage("From: =?utf-8?Q?=EF=BB=BFOnd=C5=99ej?= <ondrej@host.example.com>\r\n\r\nbody\r\n");
    expect(word.from?.name).toBe("Ondřej");
    const part = new Uint8Array([...ascii("Content-Type: text/plain; charset=utf-8\r\n\r\n"), ...BOM, 0x41]);
    expect(parseMessage(part).text).toBe("A");
  });
});
