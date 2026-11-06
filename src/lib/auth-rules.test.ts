import { describe, expect, it } from "vitest";
import { outsideLoginProblem } from "./auth-rules";

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
