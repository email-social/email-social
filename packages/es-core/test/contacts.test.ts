import { describe, expect, it } from "vitest";
import { deriveContacts } from "../src/contacts.js";
import type { Contact } from "../src/types.js";
import { mid, msg, t } from "./helpers/messages.js";
import { mulberry32, shuffle } from "./helpers/prng.js";

const byAddress = (contacts: Contact[], address: string): Contact | undefined => contacts.find((c) => c.address === address);

describe("deriveContacts: counting", () => {
  it("counts the messages that mention each address in From, To or Cc", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Alice <alice@example.com>", to: "Bob <bob@example.org>", date: t(0) }),
      msg({ id: mid("2"), from: "Bob <bob@example.org>", to: "Alice <alice@example.com>", cc: "Jana <jana@example.net>", date: t(1) }),
      msg({ id: mid("3"), from: "Alice <alice@example.com>", to: "Jana <jana@example.net>", date: t(2) }),
    ]);
    expect(contacts.map((c) => [c.address, c.count])).toEqual([
      ["alice@example.com", 3],
      ["jana@example.net", 2],
      ["bob@example.org", 2],
    ]);
  });

  it("counts an address once per message even when it appears several times in it", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Alice <alice@example.com>", to: ["alice@example.com", "Bob <bob@example.org>", "bob@example.org"], cc: "Alice <alice@EXAMPLE.com>", date: t(0) }),
    ]);
    expect(byAddress(contacts, "alice@example.com")!.count).toBe(1);
    expect(byAddress(contacts, "bob@example.org")!.count).toBe(1);
  });

  it("counts a message that appears twice (same id) only once", () => {
    const m = msg({ id: mid("1"), from: "Alice <alice@example.com>", to: "Bob <bob@example.org>", date: t(0) });
    const contacts = deriveContacts([m, { ...m }, m]);
    expect(contacts.map((c) => c.count)).toEqual([1, 1]);
  });

  it("counts messages without a Message-ID separately (different sha256 ids)", () => {
    const contacts = deriveContacts([
      msg({ id: "sha256:" + "1".repeat(64), from: "alice@example.com", to: "bob@example.org", date: t(0) }),
      msg({ id: "sha256:" + "2".repeat(64), from: "alice@example.com", to: "bob@example.org", date: t(0) }),
    ]);
    expect(contacts.map((c) => c.count)).toEqual([2, 2]);
  });

  it("returns no contacts for no messages and ignores messages without addresses", () => {
    expect(deriveContacts([])).toEqual([]);
    expect(deriveContacts([msg({ id: mid("1"), date: t(0) })])).toEqual([]);
  });
});

describe("deriveContacts: names", () => {
  it("prefers the name a person uses in From over names others give them in To/Cc", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Alice Example <alice@example.com>", to: "bob@example.org", date: t(0) }),
      msg({ id: mid("2"), from: "Bob <bob@example.org>", to: "Ali <alice@example.com>", date: t(1) }),
    ]);
    expect(byAddress(contacts, "alice@example.com")).toEqual({
      address: "alice@example.com",
      name: "Alice Example",
      names: ["Ali", "Alice Example"],
      lastSeen: t(1),
      count: 2,
    });
  });

  it("uses the most recent From name", () => {
    const contacts = deriveContacts([
      msg({ id: mid("2"), from: "Alice Example <alice@example.com>", to: "bob@example.org", date: t(10) }),
      msg({ id: mid("1"), from: "Alice <alice@example.com>", to: "bob@example.org", date: t(0) }),
    ]);
    expect(byAddress(contacts, "alice@example.com")!.name).toBe("Alice Example");
  });

  it("uses the most recent To/Cc name for an address that never sent", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "alice@example.com", to: "Jana <jana@example.net>", date: t(0) }),
      msg({ id: mid("2"), from: "alice@example.com", cc: "Jana Nováková <jana@example.net>", date: t(5) }),
      msg({ id: mid("3"), from: "alice@example.com", to: "jana@example.net", date: t(9) }),
    ]);
    expect(byAddress(contacts, "jana@example.net")).toMatchObject({ name: "Jana Nováková", names: ["Jana Nováková", "Jana"] });
  });

  it("ignores empty names and names equal to the address (case-insensitive)", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Bob <bob@example.org>", to: "Alice@Example.com <alice@example.com>", date: t(0) }),
      msg({ id: mid("2"), from: "alice@example.com <alice@example.com>", to: "   <bob@example.org>", date: t(1) }),
    ]);
    expect(byAddress(contacts, "alice@example.com")).toMatchObject({ name: "", names: [] });
    expect(byAddress(contacts, "bob@example.org")).toMatchObject({ name: "Bob", names: ["Bob"] });
  });

  it("removes the single quotes Outlook puts around names taken from its address cache", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Lukas Weber <lukas@example.net>", to: ["'Anna Becker' <anna@example.net>", "'carol@example.com' <carol@example.com>"], date: t(0) }),
    ]);
    expect(byAddress(contacts, "anna@example.net")!.names).toEqual(["Anna Becker"]);
    expect(byAddress(contacts, "carol@example.com")!.names).toEqual([]);
  });

  it("lists distinct names, most recent first, with the From name first within a message", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Bob <bob@example.org>", to: "Robert <bob@example.org>", date: t(0) }),
      msg({ id: mid("2"), from: "Alice <alice@example.com>", to: "Bobby <bob@example.org>", date: t(1) }),
      msg({ id: mid("3"), from: "Alice <alice@example.com>", to: "Robert <bob@example.org>", date: t(2) }),
    ]);
    expect(byAddress(contacts, "bob@example.org")).toMatchObject({ name: "Bob", names: ["Robert", "Bobby", "Bob"] });
    const single = deriveContacts([msg({ id: mid("1"), from: "Bob <bob@example.org>", to: "Robert <bob@example.org>", date: t(0) })]);
    expect(single[0]!.names).toEqual(["Bob", "Robert"]);
  });

  it("treats undated messages as older than dated ones for name recency", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Alice Undated <alice@example.com>", to: "bob@example.org", date: null }),
      msg({ id: mid("2"), from: "Alice Dated <alice@example.com>", to: "bob@example.org", date: t(0) }),
    ]);
    expect(byAddress(contacts, "alice@example.com")).toMatchObject({ name: "Alice Dated", names: ["Alice Dated", "Alice Undated"] });
  });
});

describe("deriveContacts: lastSeen", () => {
  it("is the latest date of the messages mentioning the address", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "alice@example.com", to: "bob@example.org", date: t(30) }),
      msg({ id: mid("2"), from: "alice@example.com", to: "jana@example.net", date: t(10) }),
    ]);
    expect(byAddress(contacts, "alice@example.com")!.lastSeen).toBe(t(30));
    expect(byAddress(contacts, "jana@example.net")!.lastSeen).toBe(t(10));
  });

  it("ignores undated messages and is null when every message is undated", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "alice@example.com", to: "bob@example.org", date: t(5) }),
      msg({ id: mid("2"), from: "alice@example.com", to: "jana@example.net", date: null }),
    ]);
    expect(byAddress(contacts, "alice@example.com")).toMatchObject({ lastSeen: t(5), count: 2 });
    expect(byAddress(contacts, "jana@example.net")).toMatchObject({ lastSeen: null, count: 1 });
  });

  it("compares dates as instants", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "alice@example.com", to: "bob@example.org", date: "2026-03-02T10:30:00+02:00" }),
      msg({ id: mid("2"), from: "alice@example.com", to: "bob@example.org", date: "2026-03-02T09:00:00.000Z" }),
    ]);
    expect(contacts[0]!.lastSeen).toBe("2026-03-02T09:00:00.000Z");
  });
});

describe("deriveContacts: identity and options", () => {
  it("folds the case of the domain only: the local part stays case-sensitive (RFC 5321 §2.4)", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "Alice <Alice@EXAMPLE.COM>", to: "bob@example.org", date: t(0) }),
      msg({ id: mid("2"), from: "Alice <Alice@example.com>", to: "bob@Example.Org", date: t(1) }),
      msg({ id: mid("3"), from: "alice <alice@example.com>", to: "BOB@example.org", date: t(2) }),
    ]);
    expect(contacts.map((c) => [c.address, c.count])).toEqual([
      ["BOB@example.org", 1],
      ["alice@example.com", 1],
      ["Alice@example.com", 2],
      ["bob@example.org", 2],
    ]);
  });

  it("leaves out excluded addresses, compared in canonical form", () => {
    const messages = [
      msg({ id: mid("1"), from: "Me <me@example.com>", to: ["Bob <bob@example.org>", "Me Too <Me@example.com>"], date: t(0) }),
      msg({ id: mid("2"), from: "Bob <bob@example.org>", to: "me@EXAMPLE.com", date: t(1) }),
    ];
    expect(deriveContacts(messages, { exclude: ["me@Example.COM"] }).map((c) => c.address)).toEqual(["bob@example.org", "Me@example.com"]);
    expect(deriveContacts(messages, { exclude: ["<me@example.com>", "Me@example.com"] }).map((c) => c.address)).toEqual(["bob@example.org"]);
    expect(deriveContacts(messages, {}).map((c) => c.address)).toEqual(["bob@example.org", "me@example.com", "Me@example.com"]);
  });

  it("sorts by lastSeen (newest first, never-dated last), then by address", () => {
    const contacts = deriveContacts([
      msg({ id: mid("1"), from: "zed@example.com", to: "amy@example.com", date: t(0) }),
      msg({ id: mid("2"), from: "carl@example.com", to: "bea@example.com", date: t(5) }),
      msg({ id: mid("3"), from: "dora@example.com", to: "abe@example.com", date: null }),
    ]);
    expect(contacts.map((c) => c.address)).toEqual([
      "bea@example.com",
      "carl@example.com",
      "amy@example.com",
      "zed@example.com",
      "abe@example.com",
      "dora@example.com",
    ]);
  });

  it("gives the same result for any order of the input", () => {
    const messages = [
      msg({ id: mid("1"), from: "Alice <alice@example.com>", to: "Bob <bob@example.org>", date: t(0) }),
      msg({ id: mid("2"), from: "Bobby <bob@example.org>", to: "Ali <alice@example.com>", cc: "Jana <jana@example.net>", date: t(1) }),
      msg({ id: mid("3"), from: "Alice E. <alice@example.com>", to: "J. N. <jana@example.net>", date: t(1) }),
      msg({ id: mid("4"), from: "Alice X <alice@example.com>", to: "jana@example.net" }),
      msg({ id: mid("2"), from: "Bob Copy <bob@example.org>", to: "Ali <alice@example.com>", date: t(1) }),
    ];
    const expected = deriveContacts(messages);
    const random = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(deriveContacts(shuffle(messages, random))).toEqual(expected);
    expect(byAddress(expected, "alice@example.com")!.name).toBe("Alice E.");
  });
});
