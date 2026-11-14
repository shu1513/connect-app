import { describe, expect, it } from "vitest";
import { returnPath, safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/h/hana_host/book?length=30&start=2026-11-20T15%3A00%3A00.000Z")).toBe("/h/hana_host/book?length=30&start=2026-11-20T15%3A00%3A00.000Z");
  });
  it("sends anything else to the home page", () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", "h/hana", "/a b", "", undefined, null, 5, ["/a"]]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("returnPath", () => {
  it("keeps a page worth going back to", () => {
    expect(returnPath("/h/hana_host/now?length=15")).toBe("/h/hana_host/now?length=15");
  });
  it("drops another site's address, the home page, and nothing at all", () => {
    for (const none of ["https://evil.example/x", "//evil.example", "/", "", undefined, ["/h/a", "/h/b"]]) expect(returnPath(none)).toBeNull();
  });
  it("drops a path too long to carry in an address", () => {
    expect(returnPath(`/h/${"a".repeat(496)}`)).toBe(`/h/${"a".repeat(496)}`);
    expect(returnPath(`/h/${"a".repeat(498)}`)).toBeNull();
  });
});
