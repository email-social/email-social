import { describe, expect, it } from "vitest";
import { parseArgs, USAGE } from "../src/cli-args.js";

describe("command line", () => {
  it("defaults to signing in to an IMAP account on a random port and opening the browser", () => {
    expect(parseArgs([])).toEqual({ demo: false, open: true, port: 0, help: false, maildir: null, address: null, name: null, cacheDir: null, maxMessages: 500 });
  });

  it("reads every option", () => {
    expect(
      parseArgs(["--maildir", "mail", "--address", "me@example.com", "--name", "Me Myself", "--cache-dir", "cache", "--port", "8123", "--no-open", "--max-messages", "50"]),
    ).toEqual({ demo: false, open: false, port: 8123, help: false, maildir: "mail", address: "me@example.com", name: "Me Myself", cacheDir: "cache", maxMessages: 50 });
    expect(parseArgs(["--demo"]).demo).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["--port=9000"]).port).toBe(9000);
  });

  it("refuses unknown options, missing values and a maildir without an address", () => {
    for (const argv of [["--nope"], ["--maildir"], ["--port", "x"], ["--port", "70000"], ["--maildir", "m"], ["--demo", "--maildir", "m", "--address", "a@example.com"], ["extra"]]) {
      expect(() => parseArgs(argv), argv.join(" ")).toThrow();
    }
  });

  it("documents every option in the usage text", () => {
    for (const option of ["--demo", "--maildir", "--address", "--name", "--cache-dir", "--port", "--no-open", "--max-messages", "--help"]) {
      expect(USAGE).toContain(option);
    }
  });
});
