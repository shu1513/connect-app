import { describe, expect, it } from "vitest";
import { fromThisSite } from "./same-site";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe("whether a request comes from our own pages", () => {
  it("trusts what the browser says about where the request comes from", () => {
    expect(fromThisSite(headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(fromThisSite(headers({ "sec-fetch-site": "cross-site", origin: "https://connect.example", host: "connect.example" }))).toBe(false);
    expect(fromThisSite(headers({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(fromThisSite(headers({ "sec-fetch-site": "none" }))).toBe(false);
  });
  it("without that, compares the page's address with ours", () => {
    expect(fromThisSite(headers({ origin: "https://connect.example", host: "connect.example" }))).toBe(true);
    expect(fromThisSite(headers({ origin: "https://evil.example", host: "connect.example" }))).toBe(false);
    expect(fromThisSite(headers({ origin: "https://connect.example", host: "internal:3000", "x-forwarded-host": "connect.example" }))).toBe(true);
  });
  it("refuses a request that says nothing about where it comes from", () => {
    expect(fromThisSite(headers({}))).toBe(false);
    expect(fromThisSite(headers({ origin: "not an address", host: "connect.example" }))).toBe(false);
  });
});
