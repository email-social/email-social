import { describe, expect, it } from "vitest";
import { decodeFlowed } from "../src/mime/flowed.js";

const lines = (...parts: string[]): string => parts.join("\n");

describe("decodeFlowed (RFC 3676)", () => {
  it("joins a line ending in a space with the next line, keeping the space when DelSp is no (§4.2)", () => {
    expect(decodeFlowed(lines("Hello, this is ", "one paragraph.", ""), false)).toBe("Hello, this is one paragraph.\n");
  });

  it("removes the trailing space of flowed lines when DelSp is yes (§4.2)", () => {
    expect(decodeFlowed(lines("Hyper", "text and ", "more", ""), false)).toBe("Hyper\ntext and more\n");
    expect(decodeFlowed(lines("Hyper ", "text", ""), true)).toBe("Hypertext\n");
  });

  it("keeps fixed lines, empty lines and the presence or absence of a final line break", () => {
    expect(decodeFlowed(lines("a", "", "b", ""), false)).toBe("a\n\nb\n");
    expect(decodeFlowed(lines("a", "b"), false)).toBe("a\nb");
    expect(decodeFlowed("", false)).toBe("");
    expect(decodeFlowed("\n", false)).toBe("\n");
  });

  it("joins several flowed lines into one paragraph and ends it at the first fixed line", () => {
    expect(decodeFlowed(lines("one ", "two ", "three", "four ", "five", ""), false)).toBe("one two three\nfour five\n");
  });

  it("removes one space of space-stuffing before checking anything else (§4.4)", () => {
    expect(decodeFlowed(lines(" From Monday on,", "  two spaces", " >not a quote", ""), false)).toBe(
      "From Monday on,\n two spaces\n>not a quote\n",
    );
  });

  it("counts the quote depth, unwraps quoted paragraphs and writes quotes as '> ' prefixes (§4.5)", () => {
    const input = lines("> quoted text that ", "> goes on", ">> deeper ", ">>still", "");
    expect(decodeFlowed(input, false)).toBe("> quoted text that goes on\n>> deeper still\n");
  });

  it("writes an empty quoted line as the bare quote marks", () => {
    expect(decodeFlowed(lines("> a", ">", "> ", ">>", ""), false)).toBe("> a\n>\n>\n>>\n");
  });

  it("does not join a flowed line with a line of a different quote depth", () => {
    expect(decodeFlowed(lines("> end of quote ", "My answer.", ""), false)).toBe("> end of quote \nMy answer.\n");
    expect(decodeFlowed(lines("> end of quote ", "My answer.", ""), true)).toBe("> end of quote\nMy answer.\n");
  });

  it("keeps the '-- ' signature separator as is and never joins it with neighbours (§4.3)", () => {
    const input = lines("Alice ", "-- ", "Alice Example", "Example s.r.o.", "");
    expect(decodeFlowed(input, false)).toBe("Alice \n-- \nAlice Example\nExample s.r.o.\n");
    expect(decodeFlowed(input, true)).toBe("Alice\n-- \nAlice Example\nExample s.r.o.\n");
  });

  it("recognises a quoted signature separator", () => {
    expect(decodeFlowed(lines("> -- ", "> sig", ""), false)).toBe("> -- \n> sig\n");
  });

  it("keeps a flowed last line (nothing to join it with)", () => {
    expect(decodeFlowed("last ", false)).toBe("last ");
    expect(decodeFlowed("last \n", true)).toBe("last\n");
  });

  it("accepts CRLF line endings", () => {
    expect(decodeFlowed("soft \r\nwrap\r\n", false)).toBe("soft wrap\n");
  });

  it("keeps trailing spaces other than the soft-break space as content", () => {
    expect(decodeFlowed(lines("two  ", "x", ""), true)).toBe("two x\n");
    expect(decodeFlowed(lines("two  ", "x", ""), false)).toBe("two  x\n");
  });
});
