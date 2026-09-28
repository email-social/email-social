import { describe, expect, it } from "vitest";
import { formatAddress, formatAddressList, parseAddressList } from "../src/headers/address.js";
import type { EsAddress } from "../src/types.js";
import { mulberry32, pick, randomInt } from "./helpers/prng.js";

const addr = (name: string, address: string): EsAddress => ({ name, address });

describe("parsing address lists (RFC 5322 §3.4)", () => {
  it("parses name-addr, bare addr-spec and quoted display names", () => {
    expect(parseAddressList('Alice Example <alice@example.com>, bob@example.org, "Nováková, Jana" <jana@example.net>')).toEqual([
      addr("Alice Example", "alice@example.com"),
      addr("", "bob@example.org"),
      addr("Nováková, Jana", "jana@example.net"),
    ]);
  });

  it("uses a trailing comment as the name when there is no phrase", () => {
    expect(parseAddressList("bob@example.org (Bob Builder), carol@example.com (Carol (work))")).toEqual([
      addr("Bob Builder", "bob@example.org"),
      addr("Carol (work)", "carol@example.com"),
    ]);
    expect(parseAddressList("Alice <alice@example.com> (ignored comment)")).toEqual([addr("Alice", "alice@example.com")]);
  });

  it("flattens groups and drops empty groups (§3.4)", () => {
    expect(parseAddressList("Team: alice@example.com, Bob <bob@example.org>;, carol@example.net")).toEqual([
      addr("", "alice@example.com"),
      addr("Bob", "bob@example.org"),
      addr("", "carol@example.net"),
    ]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddressList("Empty Group:;, dave@example.com")).toEqual([addr("", "dave@example.com")]);
  });

  it("strips obsolete source routes (§4.4)", () => {
    expect(parseAddressList("Alice <@relay1.example.net,@relay2.example.net:alice@example.com>")).toEqual([addr("Alice", "alice@example.com")]);
  });

  it("unescapes quoted-pairs and keeps commas inside quotes", () => {
    expect(parseAddressList('"Bob \\"The Builder\\", Jr." <bob@example.org>, "a\\\\b" <c@example.com>')).toEqual([
      addr('Bob "The Builder", Jr.', "bob@example.org"),
      addr("a\\b", "c@example.com"),
    ]);
  });

  it("decodes encoded-words in names, also inside quoted strings (Outlook, Gmail)", () => {
    expect(parseAddressList("=?UTF-8?Q?Jana_Nov=C3=A1kov=C3=A1?= <jana@example.com>")).toEqual([addr("Jana Nováková", "jana@example.com")]);
    expect(parseAddressList('"=?utf-8?B?Tm92w6FrLCBKYW4=?=" <jan@example.com>')).toEqual([addr("Novák, Jan", "jan@example.com")]);
    expect(parseAddressList("=?utf-8?q?Petr?=\r\n =?utf-8?q?_=C5=A0t=C4=9Bp=C3=A1nek?= <petr@example.com>")).toEqual([
      addr("Petr Štěpánek", "petr@example.com"),
    ]);
  });

  it("accepts raw UTF-8 names and addresses (RFC 6532)", () => {
    expect(parseAddressList("Jiří Dvořák <jiří@příklad.example.com>")).toEqual([addr("Jiří Dvořák", "jiří@příklad.example.com")]);
  });

  it("collapses whitespace in names and trims spaces inside angle brackets", () => {
    expect(parseAddressList("  Alice \r\n\t  Example   <  alice@example.com  >")).toEqual([addr("Alice Example", "alice@example.com")]);
    expect(parseAddressList('"  Spaced   Out  " <s@example.com>')).toEqual([addr("Spaced Out", "s@example.com")]);
  });

  it("lowercases only the domain", () => {
    expect(parseAddressList("Alice <Alice.Smith@Example.COM>")).toEqual([addr("Alice", "Alice.Smith@example.com")]);
  });

  it("keeps a quoted local part as written", () => {
    expect(parseAddressList('"john doe"@example.com, <"a,b"@example.org>')).toEqual([
      addr("", '"john doe"@example.com'),
      addr("", '"a,b"@example.org'),
    ]);
  });

  it("ignores extra commas, semicolon separators and entries without '@'", () => {
    expect(parseAddressList(", ,alice@example.com,, ; bob@example.org; nobody, Undisclosed <>, <local>")).toEqual([
      addr("", "alice@example.com"),
      addr("", "bob@example.org"),
    ]);
    expect(parseAddressList("")).toEqual([]);
  });

  it("never throws on malformed input", () => {
    const random = mulberry32(5322);
    const alphabet = ['"', "<", ">", "(", ")", ",", ";", ":", "@", "\\", " ", "a", "é", "=?", "?=", "\r\n", "[", "]"];
    for (let n = 0; n < 300; n++) {
      let text = "";
      for (let i = randomInt(random, 0, 30); i > 0; i--) text += pick(random, alphabet);
      const parsed = parseAddressList(text);
      for (const entry of parsed) expect(entry.address).toContain("@");
    }
  });
});

describe("formatting addresses", () => {
  it("writes name-addr and bare addresses", () => {
    expect(formatAddress(addr("Alice Example", "alice@example.com"))).toBe("Alice Example <alice@example.com>");
    expect(formatAddress(addr("", "bob@example.org"))).toBe("bob@example.org");
    expect(formatAddress(addr("Example, Alice", "alice@example.com"))).toBe('"Example, Alice" <alice@example.com>');
    expect(formatAddress(addr("Jana Nováková", "jana@example.com"))).toMatch(/^=\?UTF-8\?[QB]\?.*\?= <jana@example\.com>$/);
  });

  it("puts list items on one line while they fit and folds between items after that", () => {
    const short = formatAddressList([addr("", "a@example.com"), addr("Bob", "bob@example.org")], 4);
    expect(short).toBe("a@example.com, Bob <bob@example.org>");
    const many = Array.from({ length: 8 }, (_, i) => addr(`Person Number ${i}`, `person.${i}@example.com`));
    const out = formatAddressList(many, "To: ".length);
    const lines = ("To: " + out).split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78);
    expect(parseAddressList(out)).toEqual(many);
  });

  it("round trips generated lists through parseAddressList exactly", () => {
    const random = mulberry32(3522);
    const nameParts = ["Alice", "Bob", "Jana", "Nováková", "Žofie", "O'Brien", "Smith,", "Jr.", '"Al"', "\\", "(work)", "<x>", "@", ":", ";", "😀", "日本", "=?", "?=", "Ř", "_", "a=b", "[team]"];
    const locals = ["alice", "bob", "jana.novakova", "o'brien", "first+tag", "x_y", "Mixed.Case", '"john doe"', '"a,b"'];
    const domains = ["example.com", "example.org", "example.net", "mail.example.com"];
    for (let n = 0; n < 150; n++) {
      const list: EsAddress[] = [];
      for (let i = randomInt(random, 1, 6); i > 0; i--) {
        const words: string[] = [];
        for (let w = randomInt(random, 0, 4); w > 0; w--) words.push(pick(random, nameParts));
        list.push(addr(words.join(" "), pick(random, locals) + "@" + pick(random, domains)));
      }
      const offset = randomInt(random, 4, 30);
      const out = formatAddressList(list, offset);
      expect(/^[\x20-\x7e\r\n]*$/.test(out)).toBe(true);
      const lines = out.split("\r\n");
      lines.forEach((line, i) => expect((i === 0 ? offset : 0) + line.length, out).toBeLessThanOrEqual(78));
      expect(parseAddressList(out), out).toEqual(list);
    }
  });
});
