import { describe, expect, it } from "vitest";
import { normalizeSubject, subjectKey } from "../src/threading/subject.js";

const NBSP = " ";
const NNBSP = " ";

type Case = [input: string, base: string, isReply: boolean, isForward: boolean];

const check = ([input, base, isReply, isForward]: Case): void => {
  expect(normalizeSubject(input)).toEqual({ base, isReply, isForward });
};

describe("normalizeSubject: English prefixes", () => {
  it.each<Case>([
    ["Re: Lunch on Friday", "Lunch on Friday", true, false],
    ["RE: Lunch on Friday", "Lunch on Friday", true, false],
    ["re: Lunch on Friday", "Lunch on Friday", true, false],
    ["Re:Lunch on Friday", "Lunch on Friday", true, false],
    ["Fwd: Lunch on Friday", "Lunch on Friday", false, true],
    ["FW: Lunch on Friday", "Lunch on Friday", false, true],
    ["Fw: Lunch on Friday", "Lunch on Friday", false, true],
    ["Re: Re: RE: Lunch on Friday", "Lunch on Friday", true, false],
  ])("%j", (...c) => check(c));
});

describe("normalizeSubject: Czech prefixes (Outlook cs uses Odp:/PŘ:)", () => {
  it.each<Case>([
    ["Odp: Faktura za únor", "Faktura za únor", true, false],
    ["ODP: Faktura za únor", "Faktura za únor", true, false],
    ["PŘ: Faktura za únor", "Faktura za únor", false, true],
    ["Př: Faktura za únor", "Faktura za únor", false, true],
    ["Odpověď: Faktura za únor", "Faktura za únor", true, false],
    ["Přeposláno: Faktura za únor", "Faktura za únor", false, true],
    // Seznam.cz webmail keeps the Outlook prefix and adds its own "Re:".
    ["Re: Odp: Vyúčtování za březen", "Vyúčtování za březen", true, false],
  ])("%j", (...c) => check(c));

  it("recognises PŘ written with a combining caron (NFD input)", () => {
    check(["P" + "Ř: Faktura", "Faktura", false, true]);
  });
});

describe("normalizeSubject: German prefixes", () => {
  it.each<Case>([
    ["AW: Projektübersicht Q2", "Projektübersicht Q2", true, false],
    ["Aw: Projektübersicht Q2", "Projektübersicht Q2", true, false],
    ["WG: Projektübersicht Q2", "Projektübersicht Q2", false, true],
    ["Antw: Projektübersicht Q2", "Projektübersicht Q2", true, false],
    ["AW: WG: AW: Projektübersicht Q2", "Projektübersicht Q2", true, true],
  ])("%j", (...c) => check(c));
});

describe("normalizeSubject: French prefixes and the space before the colon", () => {
  it.each<Case>([
    ["RE : Réunion de lundi", "Réunion de lundi", true, false],
    [`RE${NBSP}: Réunion de lundi`, "Réunion de lundi", true, false],
    [`RE${NNBSP}: Réunion de lundi`, "Réunion de lundi", true, false],
    ["TR : Réunion de lundi", "Réunion de lundi", false, true],
    [`TR${NBSP}:${NBSP}Réunion de lundi`, "Réunion de lundi", false, true],
    ["Réf. : Réunion de lundi", "Réunion de lundi", true, false],
    ["Réf : Réunion de lundi", "Réunion de lundi", true, false],
    ["Rép : Réunion de lundi", "Réunion de lundi", true, false],
  ])("%j", (...c) => check(c));
});

describe("normalizeSubject: other localisations", () => {
  it.each<Case>([
    ["SV: Möte", "Möte", true, false],
    ["VB: Möte", "Möte", false, true],
    ["Rif: Riunione", "Riunione", true, false],
    ["RES: Reunião", "Reunião", true, false],
    ["ENC: Reunião", "Reunião", false, true],
    ["RV: Reunión", "Reunión", false, true],
    ["Antw: Vergadering", "Vergadering", true, false],
    ["Doorst: Vergadering", "Vergadering", false, true],
    ["YNT: Toplantı", "Toplantı", true, false],
    ["回复：会议", "会议", true, false],
    ["转发: 会议", "会议", false, true],
  ])("%j", (...c) => check(c));
});

describe("normalizeSubject: counters", () => {
  it.each<Case>([
    ["Re[2]: Budget", "Budget", true, false],
    ["RE[12]: Budget", "Budget", true, false],
    ["Re(3): Budget", "Budget", true, false],
    ["Re^2: Budget", "Budget", true, false],
    ["AW[2]: Budget", "Budget", true, false],
    ["Fwd[2]: Budget", "Budget", false, true],
  ])("%j", (...c) => check(c));
});

describe("normalizeSubject: forward wrappers (RFC 5256 §2.1)", () => {
  it("unwraps \"[Fwd: X]\"", () => check(["[Fwd: Photos from Saturday]", "Photos from Saturday", false, true]));
  it("unwraps \"[fwd: X]\" case-insensitively and nested prefixes inside", () =>
    check(["[fwd: Re: Photos from Saturday]", "Photos from Saturday", true, true]));
  it("strips a trailing \"(fwd)\" (Pine style)", () => check(["Photos from Saturday (fwd)", "Photos from Saturday", false, true]));
  it("strips repeated trailers", () => check(["Photos (fwd) (FWD)", "Photos", false, true]));
});

describe("normalizeSubject: mailing-list tags", () => {
  it("strips a list tag before a prefix", () => check(["[dev-list] Re: Release plan", "Release plan", true, false]));
  it("strips a list tag after a prefix", () => check(["Re: [dev-list] Release plan", "Release plan", true, false]));
  it("strips mixed chains", () => check(["Re: [list] AW: Re[3]: Release plan", "Release plan", true, false]));
  it("strips a list tag without a space after it", () => check(["[dev-list]Release plan", "Release plan", false, false]));
  it("keeps a subject that is only a tag", () => check(["[dev-list]", "[dev-list]", false, false]));
  it("keeps a tag that is all that is left after a prefix", () => check(["Re: [dev-list]", "[dev-list]", true, false]));
  it("strips several tags but keeps the last one when nothing follows it", () => check(["[a] [b]", "[b]", false, false]));
});

describe("normalizeSubject: whitespace and edge cases", () => {
  it("collapses tabs, folding and no-break spaces and trims", () =>
    check([`  Re:\t Lunch${NBSP}${NBSP} on \r\n Friday  `, "Lunch on Friday", true, false]));
  it("returns an empty base for an empty subject", () => check(["", "", false, false]));
  it("returns an empty base for whitespace only", () => check([" \t ", "", false, false]));
  it("returns an empty base for a bare prefix", () => check(["Re:", "", true, false]));
  it("does not strip words that merely start like a prefix", () => {
    check(["Review: the plan", "Review: the plan", false, false]);
    check(["Fwdx: the plan", "Fwdx: the plan", false, false]);
    check(["Report", "Report", false, false]);
  });
  it("does not strip single-letter tokens or a prefix without a colon", () => {
    check(["I: need help", "I: need help", false, false]);
    check(["Re Lunch", "Re Lunch", false, false]);
  });
  it("does not strip prefixes in the middle of the subject", () => check(["Lunch Re: Friday", "Lunch Re: Friday", false, false]));
  it("keeps the original casing of the base", () => check(["RE: ÚNOR Faktura", "ÚNOR Faktura", true, false]));
});

describe("subjectKey", () => {
  it("lowercases and composes to NFC", () => {
    expect(subjectKey("Réunion DE Lundi")).toBe("réunion de lundi");
    expect(subjectKey("Réunion")).toBe("réunion");
    expect(subjectKey("Faktura za ÚNOR")).toBe(subjectKey("faktura za únor"));
  });
});
