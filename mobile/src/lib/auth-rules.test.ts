import { CODE_WRONG, codeProblem, emailLinks, GENERIC, NO_MATCH, NOT_REACHED, passwordProblem, signInOutcome, signUpProblem, TOO_MANY, typedCode } from "./auth-rules";

describe("what signing in led to", () => {
  it("is signed in when the login tool says so", () => {
    expect(signInOutcome({ data: { token: "t", user: {} }, error: null })).toEqual({ kind: "in" });
  });

  it("asks for the two-step code when the login tool asks for it", () => {
    expect(signInOutcome({ data: { twoFactorRedirect: true }, error: null })).toEqual({ kind: "code" });
  });

  it("leads to 'check your email' when the address is not confirmed", () => {
    expect(signInOutcome({ data: null, error: { status: 403, code: "EMAIL_NOT_VERIFIED" } })).toEqual({ kind: "confirm" });
  });

  it("gives one sentence for a wrong password, no account, and a closed account", () => {
    for (const error of [{ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 400, code: "INVALID_EMAIL" }, { status: 500 }, { status: 403, code: "SOMETHING_ELSE" }]) {
      expect(signInOutcome({ data: null, error })).toEqual({ kind: "problem", words: NO_MATCH });
    }
  });

  it("says so when there were too many attempts, or Connect was not reached", () => {
    expect(signInOutcome({ data: null, error: { status: 429 } })).toEqual({ kind: "problem", words: TOO_MANY });
    expect(signInOutcome({ data: null, error: {} })).toEqual({ kind: "problem", words: NOT_REACHED });
    expect(signInOutcome({ data: null, error: { status: 0, message: "Network request failed" } })).toEqual({ kind: "problem", words: NOT_REACHED });
  });
});

describe("a typed second-step code", () => {
  it("is from the app when it is six digits, with or without spaces", () => {
    expect(typedCode("123456")).toEqual({ kind: "app", code: "123456" });
    expect(typedCode(" 123 456 ")).toEqual({ kind: "app", code: "123456" });
  });

  it("is a backup code otherwise, and keeps its hyphen", () => {
    expect(typedCode("abcde-fghij")).toEqual({ kind: "backup", code: "abcde-fghij" });
    expect(typedCode("12345")).toEqual({ kind: "backup", code: "12345" });
  });

  it("has the website's words when it is not taken", () => {
    expect(codeProblem({ status: 401 })).toBe(CODE_WRONG);
    expect(codeProblem({ status: 429 })).toBe(TOO_MANY);
    expect(codeProblem({})).toBe(NOT_REACHED);
  });
});

describe("a problem with a new password or account", () => {
  it("uses the website's sentences", () => {
    expect(passwordProblem({ status: 400, code: "PASSWORD_TOO_SHORT" })).toBe("Use a password of at least 12 characters.");
    expect(passwordProblem({ status: 400, code: "PASSWORD_TOO_LONG" })).toBe("That password is too long.");
    expect(passwordProblem({ status: 400, code: "PASSWORD_COMPROMISED", message: "Leaked." })).toBe("Leaked.");
    expect(passwordProblem({ status: 400, code: "INVALID_EMAIL" })).toBe("That email address does not look right.");
    expect(passwordProblem({ status: 429 })).toBe(TOO_MANY);
    expect(passwordProblem({ status: 500 })).toBe(GENERIC);
    expect(passwordProblem({})).toBe(NOT_REACHED);
  });

  it("is caught on the phone first where that is plain", () => {
    const fine = { name: "Ada Lovelace", email: "ada@example.com", password: "a-long-enough-one" };
    expect(signUpProblem(fine)).toBeNull();
    expect(signUpProblem({ ...fine, name: " A " })).toMatch(/your name/);
    expect(signUpProblem({ ...fine, email: "  " })).toMatch(/email/);
    expect(signUpProblem({ ...fine, password: "short" })).toBe("Use a password of at least 12 characters.");
    expect(signUpProblem({ ...fine, password: "x".repeat(129) })).toBe("That password is too long.");
  });
});

describe("the links in the emails", () => {
  it("lead to the website by its full address, never to the app", () => {
    expect(emailLinks("https://connect.example")).toEqual({ afterConfirming: "https://connect.example/welcome", newPassword: "https://connect.example/reset-password" });
  });
});
