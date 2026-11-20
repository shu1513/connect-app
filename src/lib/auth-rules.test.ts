import { describe, expect, it } from "vitest";
import { isSwitchedOffLoginPath, leadsToTheWebsite, outsideLoginProblem } from "./auth-rules";

const google = (profile?: Record<string, unknown>) => ({ method: "oauth", oauth: { providerId: "google", profile } });

describe("outsideLoginProblem", () => {
  it("accepts a Google identity whose email Google has confirmed", () => {
    expect(outsideLoginProblem({ emailVerified: true }, google({ email_verified: true }))).toBeUndefined();
    expect(outsideLoginProblem({ emailVerified: true }, google({ email_verified: "true" }))).toBeUndefined();
  });

  it("refuses one whose email Google has not confirmed, whatever else is claimed", () => {
    expect(outsideLoginProblem({ emailVerified: true }, google({ email_verified: false }))?.error).toBe("email_not_verified");
    expect(outsideLoginProblem({ emailVerified: false }, google({ email_verified: "false" }))?.error).toBe("email_not_verified");
    expect(outsideLoginProblem({}, google({ email_verified: null }))?.error).toBe("email_not_verified");
  });

  it("falls back to the tool's own reading when the provider sends no claim", () => {
    expect(outsideLoginProblem({ emailVerified: true }, google(undefined))).toBeUndefined();
    expect(outsideLoginProblem({ emailVerified: false }, google({}))?.error).toBe("email_not_verified");
    expect(outsideLoginProblem({}, google(undefined))?.error).toBe("email_not_verified");
  });

  it("does not get in the way of password sign-up", () => {
    expect(outsideLoginProblem({ emailVerified: false }, { method: "email-password" })).toBeUndefined();
  });
});

describe("leadsToTheWebsite", () => {
  const own = ["https://connect.example", "http://localhost:3000"];

  it("accepts a path on this site", () => {
    for (const path of ["/", "/welcome", "/reset-password", "/welcome?next=%2Fh%2Fmaria", "/h/maria/book?length=30#times", "/calls/0f0e0d0c-1111-2222-3333-444455556666"]) {
      expect(leadsToTheWebsite(path, own), path).toBe(true);
    }
  });

  it("accepts a full address on one of the website's own sites", () => {
    expect(leadsToTheWebsite("https://connect.example/welcome", own)).toBe(true);
    expect(leadsToTheWebsite("http://localhost:3000/reset-password", own)).toBe(true);
  });

  it("refuses the phone app's own name, and anything else that is not the website", () => {
    for (const elsewhere of [
      "connect://",
      "connect://welcome",
      "connect:///welcome",
      "exp://127.0.0.1:8081",
      "https://connect.example.evil.test/welcome",
      "https://evil.test/?https://connect.example",
      "http://connect.example/welcome",
      "//evil.test/welcome",
      "/\\evil.test",
      "javascript:alert(1)",
      "welcome",
      "",
      // Paths that only become another site once they are tidied, or that a browser reads differently.
      "/.//evil.test",
      "/..//evil.test",
      "/a/..//evil.test",
      "/./welcome",
      "/welcome/../../evil",
      "/%2Fevil.test",
      "/%2f%2fevil.test",
      "/%5Cevil.test",
      "/%2e%2e/evil",
      "/welcome//x",
      "/wel\tcome",
      "/welcome\u0000",
      "https://connect.example@evil.test/welcome",
      "https://user:pw@connect.example/welcome",
      "https://connect.example//evil.test",
      "https://connect.example/.//evil.test",
      "https://connect.example\\@evil.test",
    ]) {
      expect(leadsToTheWebsite(elsewhere, own), elsewhere).toBe(false);
    }
  });

  it("refuses what is not a piece of text", () => {
    for (const value of [undefined, null, 1, {}, ["/welcome"]]) expect(leadsToTheWebsite(value, own)).toBe(false);
  });
});

describe("leadsToTheWebsite, for a full address", () => {
  const own = ["https://connect.example"];

  it("judges the path as it was written, not as it reads once tidied", () => {
    expect(leadsToTheWebsite("https://connect.example", own)).toBe(true);
    expect(leadsToTheWebsite("https://connect.example/", own)).toBe(true);
    expect(leadsToTheWebsite("https://connect.example/welcome?next=%2Fcalls", own)).toBe(true);
    expect(leadsToTheWebsite("https://connect.example?x=1", own)).toBe(true);
    expect(leadsToTheWebsite("https://connect.example#top", own)).toBe(true);
    for (const odd of ["https://connect.example/a/../welcome", "https://connect.example/./welcome", "https://connect.example/%2e%2e/x", "HTTPS://CONNECT.EXAMPLE/welcome", "https://connect.example:443/welcome"]) {
      expect(leadsToTheWebsite(odd, own), odd).toBe(false);
    }
  });
});

describe("the addresses of the login tool that are switched off", () => {
  // Written out here on purpose, not read from the list in the code: an address taken off that list by mistake must fail this test.
  const off = [
    "/update-user",
    "/change-email",
    "/delete-user",
    "/delete-user/callback",
    "/link-social",
    "/unlink-account",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    "/two-factor/disable",
  ];

  it("are each switched off, with anything under them", () => {
    for (const path of off) {
      expect(isSwitchedOffLoginPath(path), path).toBe(true);
      expect(isSwitchedOffLoginPath(`${path}/anything`), path).toBe(true);
    }
  });

  it("leave the addresses the app and the website use switched on", () => {
    for (const path of ["/sign-in/email", "/sign-up/email", "/sign-out", "/get-session", "/verify-email", "/send-verification-email", "/request-password-reset", "/reset-password", "/change-password", "/two-factor/verify-totp", "/two-factor/verify-backup-code", "/update-user-extra", "/revoke-sessions-later"]) {
      expect(isSwitchedOffLoginPath(path), path).toBe(false);
    }
  });
});
