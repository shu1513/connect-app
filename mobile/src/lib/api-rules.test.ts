import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addressFor, APP_HEADER, appHeader, isLoginToolAddress, isServer, KEEP_HEADER, readAnswer, SIGN_IN_HEADER, UNREACHABLE, whereNext } from "./api-rules";

describe("the names the app and the server share", () => {
  it("are the same on both sides", () => {
    // The app cannot load the server's code, so the two header names are written on each side; this keeps them one.
    const server = readFileSync(join(__dirname, "../../../src/lib/app-door/rules.ts"), "utf8");
    expect(server).toContain(`export const APP_HEADER = "${APP_HEADER}";`);
    expect(server).toContain(`export const SIGN_IN_HEADER = "${SIGN_IN_HEADER}";`);
    expect(server).toContain(`export const KEEP_HEADER = "${KEEP_HEADER}";`);
  });
});

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
    expect(addressFor("https://connect.example:8443", "/api/app/calls/8f2c-11/join?day=2026-11-20&q=a%20b")).toBe("https://connect.example:8443/api/app/calls/8f2c-11/join?day=2026-11-20&q=a%20b");
  });

  it("is a plain, unlocked server only in a test build", () => {
    expect(addressFor("http://10.0.2.2:3310", "/api/app/start")).toBeNull();
    expect(addressFor("http://10.0.2.2:3310", "/api/app/home?day=2026-11-20", { plain: true })).toBe("http://10.0.2.2:3310/api/app/home?day=2026-11-20");
    expect(addressFor(server, "/api/app/start", { plain: true })).toBe("https://connect.example/api/app/start");
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
      "/api/app/",
      "/api/app",
      "/api/app/start/",
      "/api/app/%2e%2e/auth",
      "/api/app/a%2Fb",
      "/api/app/a.b",
      "/api/app/start#x",
      "/api/app/start?next=a#b",
      "/api/app/start?a b",
      "/api/app/start?a\\b",
      "/api/app/sta rt",
      "",
    ]) {
      expect(addressFor(server, path)).toBeNull();
    }
  });

  it("knows a server address the app may talk to", () => {
    expect(isServer("https://connect.example")).toBe(true);
    expect(isServer("https://connect.example:8443")).toBe(true);
    expect(isServer("http://localhost:3310")).toBe(false);
    expect(isServer("http://localhost:3310", { plain: true })).toBe(true);
    for (const bad of ["", "https://", "https://a@connect.example", "https://connect.example/", "https://connect.example/x", "ftp://connect.example"]) expect(isServer(bad, { plain: true })).toBe(false);
  });

  it("knows the login tool's own addresses, the only other place a sign-in may go", () => {
    const here = "https://connect.example";
    expect(isLoginToolAddress(here, "https://connect.example/api/auth/sign-in/email")).toBe(true);
    expect(isLoginToolAddress(here, "https://connect.example/api/auth/get-session?x=1")).toBe(true);
    // A server set with its usual port written out is the same place as the address without it.
    expect(isLoginToolAddress("https://connect.example:443", "https://connect.example/api/auth/get-session")).toBe(true);
    expect(isLoginToolAddress("https://connect.example:8443", "https://connect.example/api/auth/get-session")).toBe(false);
    for (const bad of [
      "https://evil.test/api/auth/sign-in/email",
      "https://connect.example.evil.test/api/auth/get-session",
      "https://connect.example@evil.test/api/auth/get-session",
      "https://connect.example/api/app/start",
      "https://connect.example/api/auth",
      "http://connect.example/api/auth/get-session",
      "/api/auth/get-session",
      "",
    ]) {
      expect(isLoginToolAddress(here, bad)).toBe(false);
    }
  });

  it("is nowhere when the server setting is missing or is not a plain server address", () => {
    for (const bad of ["", "connect.example", "https://connect.example/", "https://connect.example/some/path", "ftp://connect.example", "https://connect.example?x=1", "https://someone:secret@connect.example", "https://someone@connect.example", "https://connect.example:port", "https://"]) {
      expect(addressFor(bad, "/api/app/start")).toBeNull();
      expect(addressFor(bad, "/api/app/start", { plain: true })).toBeNull();
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

  it("takes a refusal for a refusal whatever number came with it", () => {
    expect(readAnswer(200, { error: { code: "update_needed", message: "Please update." } })).toEqual({ ok: false, code: "update_needed", message: "Please update." });
  });

  it("counts everything else as not reaching Connect, and never guesses", () => {
    for (const [status, body] of [
      [500, { error: "boom" }],
      [502, null],
      [200, null],
      [200, []],
      [200, { error: { code: "a_refusal_of_a_later_server", message: "Not now." } }],
      [200, { error: { code: "paused" } }],
      [201, { error: "refused", done: true }],
      [200, [{ me: null }]],
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
