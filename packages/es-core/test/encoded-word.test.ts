import { describe, expect, it } from "vitest";
import { decodeEncodedWords, encodeHeaderValue } from "../src/codec/encoded-word.js";
import { mulberry32, pick, randomInt } from "./helpers/prng.js";

/** RFC 5322 §2.2.3 unfolding. */
const unfold = (value: string): string => value.replace(/\r\n(?=[ \t])/g, "");

/** Removes the quotes of an RFC 5322 quoted-string (§3.2.4). */
const unquote = (value: string): string =>
  value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\(.)/g, "$1") : value;

const ENCODED_WORD = /=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=/g;

describe("RFC 2047 decoding", () => {
  it("decodes B and Q words in any letter case", () => {
    expect(decodeEncodedWords("=?UTF-8?B?UMWZw61sacWhIMW+bHXFpW91xI1rw70=?=")).toBe("Příliš žluťoučký");
    expect(decodeEncodedWords("=?utf-8?q?P=C5=99=C3=ADli=C5=A1_=C5=BElu=C5=A5ou=C4=8Dk=C3=BD?=")).toBe("Příliš žluťoučký");
    expect(decodeEncodedWords("=?Utf-8?b?w6k=?= =?UTF-8?Q?=c3=a9?=")).toBe("éé");
  });

  it("turns '_' into a space in Q words only", () => {
    expect(decodeEncodedWords("=?iso-8859-1?q?caf=E9_cr=E8me?=")).toBe("café crème");
    expect(decodeEncodedWords("snake_case =?utf-8?q?a=5Fb?=")).toBe("snake_case a_b");
  });

  it("drops whitespace between adjacent encoded-words but keeps it next to plain text (§6.2)", () => {
    expect(decodeEncodedWords("=?utf-8?q?a?= =?utf-8?q?b?=")).toBe("ab");
    expect(decodeEncodedWords("=?utf-8?q?a?=\r\n =?utf-8?q?b?=\t =?utf-8?q?c?=")).toBe("abc");
    expect(decodeEncodedWords("=?utf-8?q?a_?= =?utf-8?q?b?=")).toBe("a b");
    expect(decodeEncodedWords("Re: =?utf-8?q?caf=C3=A9?= au lait")).toBe("Re: café au lait");
    expect(decodeEncodedWords("=?utf-8?q?a?= plain =?utf-8?q?b?=")).toBe("a plain b");
  });

  it("joins a UTF-8 character split across two words before decoding it", () => {
    // "č" (C4 8D) split between words, as some Outlook and webmail versions do.
    expect(decodeEncodedWords("=?UTF-8?Q?Dobr=C3=BD_den_pane_Nov=C3=A1=C4?= =?UTF-8?Q?=8Dek?=")).toBe("Dobrý den pane Nováček");
    // The same inside base64 words: "ží" = C5 BE C3 AD split after the third byte.
    expect(decodeEncodedWords("=?utf-8?B?xb7D?= =?utf-8?B?rQ==?=")).toBe("ží");
  });

  it("decodes words in different charsets separately", () => {
    expect(decodeEncodedWords("=?iso-8859-2?Q?=B9koda?= =?windows-1250?Q?_=9Akoda?= =?koi8-r?B?8NLJ18XU?=")).toBe("škoda škodaПривет");
  });

  it("strips an RFC 2231 §5 language tag from the charset", () => {
    expect(decodeEncodedWords("=?UTF-8*cs?Q?Dobr=C3=BD_den?=")).toBe("Dobrý den");
    expect(decodeEncodedWords("=?US-ASCII*EN?Q?Keith_Moore?=")).toBe("Keith Moore");
  });

  it("leaves malformed words untouched", () => {
    for (const text of ["=?utf-8?x?abc?=", "=??q?abc?=", "=?utf-8?q?abc", "=?utf-8?q?what??=", "just =? text ?= here", "=?utf-8?b?", "E=mc^2"]) {
      expect(decodeEncodedWords(text), text).toBe(text);
    }
  });

  it("decodes words that touch surrounding text or sit inside quotes (liberal, like common readers)", () => {
    expect(decodeEncodedWords("abc=?utf-8?q?=C3=A9?=def")).toBe("abcédef");
    expect(decodeEncodedWords('"=?utf-8?q?Nov=C3=A1k,_Jan?=" ')).toBe('"Novák, Jan" ');
  });

  it("uses the charset fallback for unknown charsets and keeps invalid '=' in Q", () => {
    expect(decodeEncodedWords("=?x-unknown?q?caf=C3=A9?=")).toBe("café");
    expect(decodeEncodedWords("=?x-unknown?q?caf=E9?=")).toBe("café");
    expect(decodeEncodedWords("=?utf-8?q?100=_sure?=")).toBe("100= sure");
  });
});

describe("RFC 2047 encoding of header values", () => {
  it("writes printable ASCII as it is", () => {
    expect(encodeHeaderValue("Lunch on Friday?", { phrase: false, offset: 9 })).toBe("Lunch on Friday?");
    expect(encodeHeaderValue("Alice Example", { phrase: true, offset: 4 })).toBe("Alice Example");
    expect(encodeHeaderValue("", { phrase: false, offset: 9 })).toBe("");
  });

  it("folds long ASCII values at spaces so lines stay within 78 characters (RFC 5322 §2.1.1)", () => {
    const subject = "The quarterly planning meeting has moved to the large room on the second floor next to the kitchen";
    const out = encodeHeaderValue(subject, { phrase: false, offset: "Subject: ".length });
    const lines = ("Subject: " + out).split("\r\n");
    expect(lines.length).toBe(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78);
    expect(unfold(out)).toBe(subject);
  });

  it("keeps a single overlong word unbroken", () => {
    const word = "x".repeat(100);
    expect(encodeHeaderValue("see " + word, { phrase: false, offset: 9 })).toBe("see\r\n " + word);
  });

  it("encodes non-ASCII text as UTF-8 encoded-words", () => {
    const out = encodeHeaderValue("Příliš žluťoučký kůň", { phrase: false, offset: 9 });
    expect(out).toMatch(/^=\?UTF-8\?[QB]\?/);
    expect(decodeEncodedWords(unfold(out))).toBe("Příliš žluťoučký kůň");
  });

  it("chooses Q for mostly-ASCII text and B for mostly-non-ASCII text", () => {
    expect(encodeHeaderValue("Re: Café au lait", { phrase: false, offset: 9 })).toBe("=?UTF-8?Q?Re:_Caf=C3=A9_au_lait?=");
    expect(encodeHeaderValue("日本語", { phrase: false, offset: 9 })).toBe("=?UTF-8?B?5pel5pys6Kqe?=");
  });

  it("encodes values that already look like encoded-words", () => {
    const text = "=?utf-8?q?not_encoded?=";
    const out = encodeHeaderValue(text, { phrase: false, offset: 9 });
    expect(out).not.toBe(text);
    expect(decodeEncodedWords(unfold(out))).toBe(text);
  });

  it("quotes ASCII display names that contain specials", () => {
    expect(encodeHeaderValue("Novák, Jan", { phrase: true, offset: 0 })).toMatch(/^=\?UTF-8\?/);
    expect(encodeHeaderValue("Example, Alice", { phrase: true, offset: 0 })).toBe('"Example, Alice"');
    expect(encodeHeaderValue('Bob "The Builder" O\\Brien', { phrase: true, offset: 0 })).toBe('"Bob \\"The Builder\\" O\\\\Brien"');
    expect(encodeHeaderValue("John Q. Public", { phrase: true, offset: 0 })).toBe('"John Q. Public"');
  });

  it("uses only the RFC 2047 §5(3) characters literally in phrase Q words", () => {
    const out = encodeHeaderValue("Žofie (office) <x>, \"q\"", { phrase: true, offset: 0 });
    for (const word of unfold(out).match(ENCODED_WORD) ?? []) {
      const [, , encoding, payload] = word.split("?");
      if (encoding === "Q") expect(/^[A-Za-z0-9!*+\-/=_]*$/.test(payload!), word).toBe(true);
    }
    expect(decodeEncodedWords(unfold(out))).toBe("Žofie (office) <x>, \"q\"");
  });

  it("encodes leading, trailing and repeated spaces so they survive decoding", () => {
    for (const text of ["  two leading", "trailing ", "a    b", " ", "\tx"]) {
      const out = encodeHeaderValue(text, { phrase: false, offset: 9 });
      expect(decodeEncodedWords(unfold(out)), JSON.stringify(text)).toBe(text);
    }
  });

  it("starts on a new line when the first line has no room left", () => {
    const out = encodeHeaderValue("ž", { phrase: false, offset: 70 });
    expect(out.startsWith("\r\n ")).toBe(true);
    expect(decodeEncodedWords(unfold(out).trim())).toBe("ž");
  });

  it("round trips generated strings with folded lines ≤ 78 and encoded-words ≤ 75 (RFC 2047 §2)", () => {
    const random = mulberry32(2047);
    const pieces = [
      "a", "Z", "0", " ", "  ", "ž", "Ř", "ů", "é", "ß", "😀", "👩‍💻", "日本", "Привет", "=?", "?=", "=", "?", "_",
      '"', "\\", "(", ")", "<", ">", ",", ";", ":", "@", ".", "[", "]", "'", "!", "*", "+", "-", "/", "#",
      "\x01", "\x7f", "Re: ", "Jana Nováková", "x".repeat(30), "č".repeat(20), "😀".repeat(12),
    ];
    for (let n = 0; n < 400; n++) {
      let text = "";
      const count = randomInt(random, 0, 14);
      for (let i = 0; i < count; i++) text += pick(random, pieces);
      const phrase = random() < 0.5;
      const offset = randomInt(random, 0, 40);
      const out = encodeHeaderValue(text, { phrase, offset });
      const lines = out.split("\r\n");
      expect(/^[\x20-\x7e\r\n]*$/.test(out), JSON.stringify(text)).toBe(true);
      // Only a single word too long for any line may exceed 78 characters.
      const fits = (line: string, i: number): boolean =>
        (i === 0 ? offset + line.length : line.length) <= 78 || !/[ \t]/.test(line.trimStart());
      expect(lines.every(fits), JSON.stringify(out)).toBe(true);
      expect(lines.slice(1).every((line) => line.startsWith(" ")), JSON.stringify(out)).toBe(true);
      for (const word of out.match(ENCODED_WORD) ?? []) expect(word.length).toBeLessThanOrEqual(75);
      const decoded = decodeEncodedWords(phrase ? unquote(unfold(out)) : unfold(out));
      expect(decoded, JSON.stringify({ text, out })).toBe(text);
    }
  });
});
