import { describe, expect, it } from "vitest";
import { handleKey, handleProblem, tidyHandle } from "./handles";

describe("tidyHandle", () => {
  it("removes spaces, a leading @ and capital letters", () => {
    expect(tidyHandle("  @Jane_Doe ")).toBe("jane_doe");
  });
});

describe("handleKey", () => {
  it("ignores underscores, so look-alikes collide", () => {
    expect(handleKey("kim_k")).toBe(handleKey("kimk"));
    expect(handleKey("k_i_m_k")).toBe("kimk");
  });
});

describe("handleProblem", () => {
  it.each(["jane", "jane_doe", "j4ne", "abc", "a_b_c", "x".repeat(30)])("accepts %s", (handle) => {
    expect(handleProblem(handle)).toBeNull();
  });

  it.each([
    ["ab", "too short"],
    ["x".repeat(31), "too long"],
    ["a_b", "fewer than 3 letters or numbers"],
    ["_jane", "leading underscore"],
    ["jane_", "trailing underscore"],
    ["jane__doe", "double underscore"],
    ["jane.doe", "full stop"],
    ["jane-doe", "hyphen"],
    ["jane doe", "space"],
    ["Jane", "capital letter (must be tidied first)"],
    ["jané", "accented letter"],
    ["jаne", "Cyrillic look-alike letter"],
    ["jane​", "invisible character"],
    ["ｊａｎｅ", "full-width letters"],
  ])("refuses %s (%s)", (handle) => {
    expect(handleProblem(handle)).not.toBeNull();
  });

  it.each(["admin", "support", "ad_min", "sup_port", "connect", "official", "stripe"])("blocks %s", (handle) => {
    expect(handleProblem(handle)).toBe("That handle is not available.");
  });
});
