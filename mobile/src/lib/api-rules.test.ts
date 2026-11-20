import { addressFor, appHeader, readAnswer, UNREACHABLE, whereNext } from "./api-rules";

describe("what the app says about itself", () => {
  it("is the kind of phone and the version", () => {
    expect(appHeader("android", "1.0.0")).toBe("android 1.0.0");
    expect(appHeader("ios", "2.3.4")).toBe("ios 2.3.4");
  });
});

describe("where a request may go", () => {
  const server = "https://connect.example";

  it("is a path of the door on our own server", () => {
    expect(addressFor(server, "/api/app/start")).toBe("https://connect.example/api/app/start");
    expect(addressFor("http://10.0.2.2:3310", "/api/app/home?day=2026-11-20")).toBe("http://10.0.2.2:3310/api/app/home?day=2026-11-20");
  });

  it("is nowhere for anything else, so the sign-in cannot be sent elsewhere", () => {
    for (const path of [
      "https://evil.test/api/app/start",
      "//evil.test/api/app/start",
      "/api/auth/get-session",
      "/api/app/../auth/sign-out",
      "/api/app/..%2Fauth",
      "api/app/start",
      "/api/app\\start",
      "/api/app//evil.test",
      "",
    ]) {
      expect(addressFor(server, path)).toBeNull();
    }
  });

  it("is nowhere when the server setting is missing or is not a plain server address", () => {
    for (const bad of ["", "connect.example", "https://connect.example/", "https://connect.example/some/path", "ftp://connect.example", "https://connect.example?x=1"]) {
      expect(addressFor(bad, "/api/app/start")).toBeNull();
    }
  });
});

describe("reading an answer", () => {
  it("takes a success as it is", () => {
    expect(readAnswer(200, { me: null })).toEqual({ ok: true, data: { me: null } });
  });

  it("takes a refusal of the door with its code and its sentence", () => {
    expect(readAnswer(401, { error: { code: "not_signed_in", message: "Please log in." } })).toEqual({ ok: false, code: "not_signed_in", message: "Please log in." });
    expect(readAnswer(426, { error: { code: "update_needed", message: "Please update." } })).toEqual({ ok: false, code: "update_needed", message: "Please update." });
  });

  it("counts everything else as not reaching Connect, and never guesses", () => {
    for (const [status, body] of [
      [500, { error: "boom" }],
      [502, null],
      [200, null],
      [200, "<html>Sign in to this network</html>"],
      [403, { error: { code: "something_new", message: "?" } }],
      [403, { error: { code: "paused" } }],
      [404, "Not found"],
    ] as const) {
      expect(readAnswer(status, body)).toEqual({ ok: false, code: "unreachable", message: UNREACHABLE });
    }
  });
});

describe("where a refusal leads", () => {
  it("sends each of the door's own refusals to its screen", () => {
    expect(whereNext("not_signed_in")).toBe("sign-in");
    expect(whereNext("update_needed")).toBe("update");
    expect(whereNext("welcome_needed")).toBe("welcome");
    expect(whereNext("confirm_email")).toBe("confirm-email");
  });

  it("leaves the rest to the screen that asked", () => {
    for (const code of ["paused", "switched_off", "not_found", "not_valid", "not_the_app", "unreachable"] as const) expect(whereNext(code)).toBe("stay");
  });
});
