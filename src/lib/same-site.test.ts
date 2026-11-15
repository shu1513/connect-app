import { describe, expect, it } from "vitest";
import { fromThisSite } from "./same-site";

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
const OURS = ["https://connect.example"];

describe("whether a request comes from our own pages", () => {
  it("trusts what the browser says about where the request comes from", () => {
    expect(fromThisSite(headers({ "sec-fetch-site": "same-origin" }), OURS)).toBe(true);
    expect(fromThisSite(headers({ "sec-fetch-site": "cross-site", origin: "https://connect.example" }), OURS)).toBe(false);
    expect(fromThisSite(headers({ "sec-fetch-site": "same-site" }), OURS)).toBe(false);
    expect(fromThisSite(headers({ "sec-fetch-site": "none" }), OURS)).toBe(false);
  });
  it("without that, the page's address must be one of the app's own, as set in its settings", () => {
    expect(fromThisSite(headers({ origin: "https://connect.example" }), OURS)).toBe(true);
    expect(fromThisSite(headers({ origin: "https://evil.example" }), OURS)).toBe(false);
    expect(fromThisSite(headers({ origin: "http://connect.example" }), OURS)).toBe(false);
  });
  it("is not fooled by headers the sender can write", () => {
    expect(fromThisSite(headers({ origin: "https://evil.example", host: "evil.example" }), OURS)).toBe(false);
    expect(fromThisSite(headers({ origin: "https://evil.example", "x-forwarded-host": "evil.example", host: "connect.example" }), OURS)).toBe(false);
  });
  it("refuses a request that says nothing about where it comes from, and everything when no address is set", () => {
    expect(fromThisSite(headers({}), OURS)).toBe(false);
    expect(fromThisSite(headers({ origin: "https://connect.example" }), [])).toBe(false);
  });
});
