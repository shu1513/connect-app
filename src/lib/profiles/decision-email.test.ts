import { describe, expect, it } from "vitest";
import { profileDecisionEmail } from "./decision-email";

const host = { name: "Hana", handle: "hana_host" };

describe("the email a host gets about their profile", () => {
  it("approved: gives the address of their page and where to finish setting up", () => {
    const { subject, text } = profileDecisionEmail("approved", host, "https://connect.example");
    expect(subject).toBe("Your Connect page is approved");
    expect(text).toContain("Hi Hana,");
    expect(text).toContain("https://connect.example/h/hana_host");
    expect(text).toContain("https://connect.example/host");
  });
  it("approved while the host has hidden their page: does not say it is public", () => {
    const { text } = profileDecisionEmail("approved", { ...host, hidden: true }, "https://connect.example");
    expect(text).toContain("hidden by you");
    expect(text).not.toContain("public:");
    expect(text).not.toContain("/h/hana_host");
  });
  it("declined: says the page is not public and that it can be changed and looked at again", () => {
    const { subject, text } = profileDecisionEmail("declined", host, "https://connect.example");
    expect(subject).toContain("not approved");
    expect(text).toContain("not public");
    expect(text).toContain("https://connect.example/host");
    expect(text).not.toContain("/h/hana_host");
  });
  it("suspended: does not claim that every call has already been cancelled", () => {
    const { text } = profileDecisionEmail("suspended", host, "https://connect.example");
    expect(text).toContain("are being cancelled");
    expect(text).not.toContain("were cancelled");
    expect(text).not.toContain("/h/hana_host");
  });
});
