import { domainToASCII } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveDid, formatDid, isValidDid, parseDid, punycodeEncode, toAsciiDomain } from "../src/did.js";

describe("did:es identifiers (spec 1.1)", () => {
  it("parses the examples from the spec", () => {
    expect(parseDid("did:es:mail.example.com:abc123")).toEqual({ method: "es", domain: "mail.example.com", localId: "abc123" });
    expect(parseDid("did:es:example.org:user-uuid-here")).toEqual({ method: "es", domain: "example.org", localId: "user-uuid-here" });
  });

  it("formats a DID from a domain and a local identifier, lowercasing the domain", () => {
    expect(formatDid("Mail.Example.COM", "abc123")).toBe("did:es:mail.example.com:abc123");
    expect(formatDid("example.net", "0f%2Bx_y.z-1")).toBe("did:es:example.net:0f%2Bx_y.z-1");
  });

  it("rejects malformed identifiers", () => {
    for (const bad of [
      "",
      "did:es:",
      "did:es:example.com",
      "did:es:example.com:",
      "did:ES:example.com:abc",
      "did:web:example.com:abc",
      "DID:es:example.com:abc",
      "did:es:Example.com:abc",
      "did:es:-example.com:abc",
      "did:es:example-.com:abc",
      "did:es:exa_mple.com:abc",
      "did:es:example..com:abc",
      "did:es:example.com:a:b",
      "did:es:example.com:a+b",
      "did:es:example.com:a%2",
      "did:es:example.com:a%zz",
      "did:es:" + "a".repeat(64) + ".example.com:abc",
    ]) {
      expect(isValidDid(bad), bad).toBe(false);
    }
    expect(() => formatDid("example.com", "not valid")).toThrow(TypeError);
  });

  it("derives a stable DID from an address: ASCII domain plus 128-bit hash of the canonical address", () => {
    const did = deriveDid("alice@example.com");
    expect(did).toMatch(/^did:es:example\.com:[0-9a-f]{32}$/);
    expect(deriveDid("alice@example.com")).toBe(did);
    expect(deriveDid("  <alice@EXAMPLE.com> ")).toBe(did);
    // The local part is not case-folded, so a different spelling is a different identity.
    expect(deriveDid("Alice@example.com")).not.toBe(did);
    expect(isValidDid(did)).toBe(true);
    // Fixed vector for other implementations.
    expect(deriveDid("alice@example.com")).toBe("did:es:example.com:ff8d9819fc0e12bf0d24892e45987e24");
  });

  it("uses the ASCII form of internationalised domains", () => {
    expect(punycodeEncode("münchen")).toBe("mnchen-3ya");
    expect(punycodeEncode("bücher")).toBe("bcher-kva");
    for (const domain of ["příklad.example.com", "BÜCHER.example.org", "ñandú.example.net", "例え.example.com"]) {
      expect(toAsciiDomain(domain)).toBe(domainToASCII(domain));
    }
    const did = deriveDid("jana@příklad.example.com");
    expect(did.startsWith("did:es:" + domainToASCII("příklad.example.com") + ":")).toBe(true);
    expect(deriveDid("jana@" + domainToASCII("příklad.example.com"))).toBe(did);
  });

  it("refuses to derive a DID without a DNS domain", () => {
    expect(() => deriveDid("undisclosed-recipients")).toThrow(TypeError);
    expect(() => deriveDid("root@[192.0.2.1]")).toThrow(TypeError);
  });
});
