import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/util/sha256.js";

describe("sha256", () => {
  it("matches the FIPS 180-4 examples", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with node:crypto on every length around the padding boundaries", () => {
    for (let length = 0; length < 200; length++) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 31 + length) & 0xff);
      expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("hashes strings as UTF-8", () => {
    expect(sha256Hex("Příliš žluťoučký kůň")).toBe(
      createHash("sha256").update("Příliš žluťoučký kůň", "utf8").digest("hex"),
    );
  });
});
