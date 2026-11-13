import { describe, expect, it } from "vitest";
import { containsPattern, keyUsable, matchRank, orderResults, SEARCH, searchTerms } from "./search-rules";

const hana = { displayName: "Hana Host", handle: "hana_host", handleKey: "hanahost", socials: ["hana.live", "hana_h"] };

describe("cleaning what was typed", () => {
  it("ignores capitals, a leading @ and extra spaces", () => {
    expect(searchTerms("  @Hana_Host ")).toEqual({ text: "hana_host", key: "hanahost" });
    expect(searchTerms("Hana   Host")).toEqual({ text: "hana host", key: "hanahost" });
  });
  it("finds nothing for fewer than 2 characters", () => {
    expect(searchTerms("")).toBeNull();
    expect(searchTerms(" @ ")).toBeNull();
    expect(searchTerms("h")).toBeNull();
    expect(searchTerms("ha")).not.toBeNull();
  });
  it("cuts very long input", () => {
    expect(searchTerms("a".repeat(500))!.text.length).toBe(SEARCH.max);
  });
  it("does not let underscores alone match everyone", () => {
    const terms = searchTerms("__")!;
    expect(terms.key).toBe("");
    expect(keyUsable(terms)).toBe(false);
  });
});

describe("matching safely", () => {
  it("treats %, _ and \\ as plain text", () => {
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(containsPattern("hana")).toBe("%hana%");
  });
});

describe("how well a host matches", () => {
  const rank = (typed: string) => matchRank(hana, searchTerms(typed)!);
  it("an exact handle or social name comes first", () => {
    expect(rank("hana_host")).toBe(0);
    expect(rank("@HANA_HOST")).toBe(0);
    expect(rank("hana.live")).toBe(0);
  });
  it("then the same with underscores and spaces ignored, or the exact name", () => {
    expect(rank("hanahost")).toBe(1);
    expect(rank("hana host")).toBe(1);
    expect(rank("hanah")).toBe(1); // the social name hana_h, loosely
  });
  it("then names that start with what was typed, then the rest", () => {
    expect(rank("han")).toBe(2);
    expect(rank("host")).toBe(3);
    expect(rank("live")).toBe(3);
  });
});

describe("ordering results", () => {
  it("puts the best match first, then goes by name, and shows at most 20", () => {
    const terms = searchTerms("hana")!;
    const exact = { displayName: "Zed", handle: "hana", handleKey: "hana", socials: [] };
    const starts = { displayName: "Hana Banana", handle: "banana", handleKey: "banana", socials: [] };
    const inside = { displayName: "Oh Hana", handle: "ohh", handleKey: "ohh", socials: [] };
    expect(orderResults([inside, starts, exact], terms).map((h) => h.handle)).toEqual(["hana", "banana", "ohh"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ displayName: `Hana ${String(i).padStart(2, "0")}`, handle: `h${i}`, handleKey: `h${i}`, socials: [] }));
    const shown = orderResults(many, terms);
    expect(shown.length).toBe(SEARCH.results);
    expect(shown[0].displayName).toBe("Hana 00");
  });
});
