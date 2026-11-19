import { describe, expect, it } from "vitest";
import { HOME_COUNTRY, HOST_COUNTRIES, hostCountryName, isHostCountry } from "./countries";

describe("where a host can be based", () => {
  it("is 33 countries, each written as two capital letters, none twice", () => {
    expect(HOST_COUNTRIES).toHaveLength(33);
    for (const country of HOST_COUNTRIES) expect(country.code).toMatch(/^[A-Z]{2}$/);
    expect(new Set(HOST_COUNTRIES.map((country) => country.code)).size).toBe(HOST_COUNTRIES.length);
    expect(new Set(HOST_COUNTRIES.map((country) => country.name)).size).toBe(HOST_COUNTRIES.length);
  });
  it("is in the order of the names, as the form shows it", () => {
    const names = HOST_COUNTRIES.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it("has the United States, the United Kingdom, Canada, Switzerland and the euro countries that were tried", () => {
    for (const code of [HOME_COUNTRY, "US", "GB", "CA", "CH", "DE", "FR", "ES"]) expect(isHostCountry(code)).toBe(true);
  });
  it("does not have the countries Stripe refuses to pay from a US account, nor Iceland", () => {
    for (const code of ["AU", "SG", "MX", "BR", "AR", "CL", "CO", "PE", "UY", "IS", "GI", "JP", "NZ", "HK"]) expect(isHostCountry(code)).toBe(false);
  });
  it("takes a code only exactly as written", () => {
    for (const code of ["", "us", "gb", "USA", " US", "U", "United States"]) expect(isHostCountry(code)).toBe(false);
  });
  it("names a country, and gives the code back for one that is not in the list", () => {
    expect(hostCountryName("GB")).toBe("United Kingdom");
    expect(hostCountryName("US")).toBe("United States");
    expect(hostCountryName("AU")).toBe("AU");
  });
});
