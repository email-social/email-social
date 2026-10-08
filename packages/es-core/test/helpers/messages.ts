/**
 * Builders for EsMessage objects in threading and contacts tests. Only the
 * fields these algorithms read need values; everything else gets an empty
 * default. Addresses are taken exactly as written (no canonicalisation), so
 * tests can check that the code under test canonicalises them.
 */
import type { EsAddress, EsMessage } from "../../src/types.js";

/** "Name <local@domain>", "local@domain" or a ready EsAddress. */
export type AddressInput = string | EsAddress;

export interface MsgInit {
  /** EsMessage.id: "<left@right>" (also used as refs.messageId) or "sha256:<hex>" (no Message-ID). */
  id: string;
  from?: AddressInput | null;
  to?: AddressInput | AddressInput[];
  cc?: AddressInput | AddressInput[];
  date?: string | null;
  subject?: string;
  references?: string[];
  inReplyTo?: string | string[];
  text?: string;
}

/** Parses the tiny address syntax the tests use; not an RFC 5322 parser. */
export function addr(input: AddressInput): EsAddress {
  if (typeof input !== "string") return input;
  const m = /^\s*(.*?)\s*<([^<>]*)>\s*$/.exec(input);
  if (m) return { name: m[1]!.replace(/^"(.*)"$/, "$1"), address: m[2]! };
  return { name: "", address: input.trim() };
}

function list(input: AddressInput | AddressInput[] | undefined): EsAddress[] {
  if (input === undefined) return [];
  return (Array.isArray(input) ? input : [input]).map(addr);
}

/** An EsMessage with sensible defaults. */
export function msg(init: MsgInit): EsMessage {
  const inReplyTo = init.inReplyTo === undefined ? [] : Array.isArray(init.inReplyTo) ? init.inReplyTo : [init.inReplyTo];
  return {
    id: init.id,
    from: init.from === undefined || init.from === null ? null : addr(init.from),
    to: list(init.to),
    cc: list(init.cc),
    replyTo: [],
    date: init.date === undefined ? null : init.date,
    subject: init.subject ?? "",
    text: init.text ?? "",
    textSource: init.text === undefined ? "none" : "plain",
    es: null,
    attachments: [],
    refs: {
      messageId: init.id.startsWith("sha256:") ? null : init.id,
      inReplyTo: [...inReplyTo],
      references: [...(init.references ?? [])],
    },
    delivery: { listHeaders: [], listId: null, autoSubmitted: null, precedence: null, returnPath: null },
  };
}

const BASE = Date.UTC(2026, 2, 2, 9, 0, 0);

/** ISO date `minutes` after 2026-03-02T09:00:00.000Z; keeps test data short and readable. */
export function t(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

/** A Message-ID in angle brackets on example.com. */
export function mid(local: string): string {
  return `<${local}@example.com>`;
}
