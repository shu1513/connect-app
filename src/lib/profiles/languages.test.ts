import { describe, expect, it } from "vitest";
import { chosenLanguages, HOST_LANGUAGES, languageNames, MAX_LANGUAGES, NO_LANGUAGE, TOO_MANY_LANGUAGES, UNKNOWN_LANGUAGE } from "./languages";

describe("the languages a host can choose", () => {
  it("is 51 languages, each code in small letters, no code and no name twice", () => {
    expect(HOST_LANGUAGES).toHaveLength(51);
    for (const language of HOST_LANGUAGES) expect(language.code).toMatch(/^[a-z]{2,3}$/);
    expect(new Set(HOST_LANGUAGES.map((language) => language.code)).size).toBe(HOST_LANGUAGES.length);
    expect(new Set(HOST_LANGUAGES.map((language) => language.name)).size).toBe(HOST_LANGUAGES.length);
  });
  it("is in the order of the names, as the form shows it", () => {
    const names = HOST_LANGUAGES.map((language) => language.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("has English, and the two sign languages", () => {
    expect(languageNames(["en"])).toEqual(["English"]);
    expect(languageNames(["ase", "bfi"])).toEqual(["American Sign Language", "British Sign Language"]);
  });
});

describe("what a host ticked", () => {
  it("is refused when nothing is chosen", () => {
    expect(chosenLanguages([])).toEqual({ problem: NO_LANGUAGE });
  });
  it("takes one, and exactly the most allowed", () => {
    expect(chosenLanguages(["en"])).toEqual({ codes: ["en"] });
    expect(MAX_LANGUAGES).toBe(5);
    expect(chosenLanguages(["en", "es", "fr", "de", "it"])).toEqual({ codes: ["en", "fr", "de", "it", "es"] });
  });
  it("is refused with one more than that", () => {
    expect(chosenLanguages(["en", "es", "fr", "de", "it", "pt"])).toEqual({ problem: TOO_MANY_LANGUAGES });
  });
  it("is refused whole when anything is not in the list, also beside good ones", () => {
    for (const bad of ["xx", "", "EN", " en", "English", "en,es", 7, null, undefined, {}, ["en"]]) {
      expect(chosenLanguages([bad])).toEqual({ problem: UNKNOWN_LANGUAGE });
      expect(chosenLanguages(["en", bad, "es"])).toEqual({ problem: UNKNOWN_LANGUAGE });
    }
  });
  it("folds doubles, so the same language six times is one language", () => {
    expect(chosenLanguages(["es", "es", "es", "es", "es", "es"])).toEqual({ codes: ["es"] });
  });
  it("is saved in the list's order, whatever order came in", () => {
    expect(chosenLanguages(["cy", "en", "ar"])).toEqual({ codes: ["ar", "en", "cy"] });
    expect(chosenLanguages(["ar", "cy", "en"])).toEqual({ codes: ["ar", "en", "cy"] });
  });
});

describe("the names shown for saved codes", () => {
  it("are in the list's order", () => {
    expect(languageNames(["es", "en"])).toEqual(["English", "Spanish"]);
  });
  it("leave out a code that is not in the list, and can be empty", () => {
    expect(languageNames(["en", "xx"])).toEqual(["English"]);
    expect(languageNames(["xx"])).toEqual([]);
    expect(languageNames([])).toEqual([]);
  });
});
