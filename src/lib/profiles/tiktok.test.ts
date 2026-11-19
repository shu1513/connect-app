import { afterEach, describe, expect, it } from "vitest";
import { readNote, writeNote } from "./login-note";
import {
  hasBothScopes,
  readAccountAnswer,
  readLoginNote,
  readTokenAnswer,
  sameValue,
  tiktokAccountFor,
  tiktokLoginUrl,
  tiktokSettings,
  writeLoginNote,
  type TikTokSend,
  type TikTokSettings,
} from "./tiktok";

const SETTINGS: TikTokSettings = { clientKey: "our-key", clientSecret: "our-secret", returnUrl: "https://connect.example/api/social/tiktok/return", signingSecret: "s3cret" };
const BOTH = "user.info.basic,user.info.profile";

describe("tiktokSettings", () => {
  const before = { ...process.env };
  afterEach(() => {
    process.env = { ...before };
  });
  const set = (values: Record<string, string | undefined>) => {
    for (const name of ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "BETTER_AUTH_SECRET", "PUBLIC_APP_URL", "BETTER_AUTH_URL"]) delete process.env[name];
    for (const [name, value] of Object.entries(values)) if (value !== undefined) process.env[name] = value;
  };
  const on = { TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s", BETTER_AUTH_SECRET: "x", PUBLIC_APP_URL: "https://connect.example/" };

  it("is on with both keys and a plain https address, and builds the one return address", () => {
    set(on);
    expect(tiktokSettings()).toEqual({ clientKey: "k", clientSecret: "s", returnUrl: "https://connect.example/api/social/tiktok/return", signingSecret: "x" });
  });

  it("reads the address part by part: capitals and the usual port still count, and the return address is tidied", () => {
    for (const address of ["https://CONNECT.EXAMPLE", "https://connect.example:443", "https://connect.example:443/"]) {
      set({ ...on, PUBLIC_APP_URL: address });
      expect(tiktokSettings()?.returnUrl).toBe("https://connect.example/api/social/tiktok/return");
    }
    set({ ...on, PUBLIC_APP_URL: "https://connect.example:8443" });
    expect(tiktokSettings()?.returnUrl).toBe("https://connect.example:8443/api/social/tiktok/return");
    set({ ...on, PUBLIC_APP_URL: "https://someone:pw@connect.example" });
    expect(tiktokSettings()).toBeNull();
  });

  it("is off when a key is missing", () => {
    set({ ...on, TIKTOK_CLIENT_KEY: undefined });
    expect(tiktokSettings()).toBeNull();
    set({ ...on, TIKTOK_CLIENT_SECRET: " " });
    expect(tiktokSettings()).toBeNull();
  });

  it("is off when the site's address is not a plain https address", () => {
    for (const address of ["http://localhost:3000", "https://connect.example/app", "https://connect.example/?a=1", "https://connect.example/#x", "not an address", ""]) {
      set({ ...on, PUBLIC_APP_URL: address });
      expect(tiktokSettings()).toBeNull();
    }
  });
});

describe("tiktokLoginUrl", () => {
  it("sends the host to TikTok with our key, both permissions, the return address and the value", () => {
    const url = new URL(tiktokLoginUrl({ clientKey: "our-key", returnUrl: SETTINGS.returnUrl, state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_key: "our-key", scope: BOTH, response_type: "code", redirect_uri: SETTINGS.returnUrl, state: "abc" });
  });
});

describe("the note of who started", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const note = writeLoginNote({ state: "value-1", userId: "user_A", expiresAt: new Date(now.getTime() + 600_000) }, "s3cret");

  it("reads back what was written", () => {
    expect(readLoginNote(note, "s3cret", now)).toEqual({ state: "value-1", userId: "user_A" });
  });

  it("is not accepted when changed, signed with another secret, out of date or missing", () => {
    const parts = note.split(".");
    const forOther = [parts[0], Buffer.from("user_B").toString("base64url"), parts[2], parts[3]].join(".");
    expect(readLoginNote(forOther, "s3cret", now)).toBeNull();
    expect(readLoginNote([parts[0], parts[1], String(Number(parts[2]) + 60_000), parts[3]].join("."), "s3cret", now)).toBeNull();
    expect(readLoginNote(note, "another", now)).toBeNull();
    expect(readLoginNote(note, "s3cret", new Date(now.getTime() + 600_000))).toBeNull();
    for (const bad of [undefined, "", "a.b.c", `${note}.x`]) expect(readLoginNote(bad, "s3cret", now)).toBeNull();
  });

  it("writes and reads the very notes it did before the signing moved to login-note.ts", () => {
    // Written by the code as it was on 19 November 2026, with these made-up values.
    const before = "fixed-state-value.dXNlcjpmaXhlZC8x.1900000000000.1wRwzwSETl6gKXtpwRap7MHzpIzK2omECXH2JbEp1P8";
    const input = { state: "fixed-state-value", userId: "user:fixed/1", expiresAt: new Date(1900000000000) };
    expect(writeLoginNote(input, "a-fixed-test-secret")).toBe(before);
    expect(readLoginNote(before, "a-fixed-test-secret", new Date(1899999999999))).toEqual({ state: "fixed-state-value", userId: "user:fixed/1" });
    expect(readLoginNote(before, "a-fixed-test-secret", new Date(1900000000000))).toBeNull();
  });

  it("is not a note for another network, and another network's note is not one of TikTok's", () => {
    const at = { state: "value-1", userId: "user_A", expiresAt: new Date(now.getTime() + 600_000) };
    expect(readNote("instagram-login", note, "s3cret", now)).toBeNull();
    expect(readLoginNote(writeNote("instagram-login", at, "s3cret"), "s3cret", now)).toBeNull();
    expect(readNote("instagram-login", writeNote("instagram-login", at, "s3cret"), "s3cret", now)).toEqual({ state: "value-1", userId: "user_A" });
  });

  it("compares two values exactly", () => {
    expect(sameValue("abc", "abc")).toBe(true);
    expect(sameValue("abc", "abd")).toBe(false);
    expect(sameValue("abc", "abcd")).toBe(false);
  });
});

describe("hasBothScopes", () => {
  it("needs both permissions; more are allowed, fewer are not", () => {
    expect(hasBothScopes(BOTH)).toBe(true);
    expect(hasBothScopes("user.info.profile, user.info.basic,video.list")).toBe(true);
    expect(hasBothScopes("user.info.basic")).toBe(false);
    expect(hasBothScopes("user.info.profile")).toBe(false);
    expect(hasBothScopes("user.info.basicuser.info.profile")).toBe(false);
    for (const bad of ["", null, undefined, 5, ["user.info.basic", "user.info.profile"]]) expect(hasBothScopes(bad)).toBe(false);
  });
});

describe("readTokenAnswer", () => {
  const good = { access_token: "act.example", expires_in: 7200, open_id: "723f24d7-e717", refresh_token: "rft.example", refresh_expires_in: 15552000, scope: BOTH, token_type: "Bearer" };

  it("reads the key and the account's number, ignoring what it does not need", () => {
    expect(readTokenAnswer(JSON.stringify(good))).toEqual({ kind: "key", accessToken: "act.example", openId: "723f24d7-e717" });
  });

  it("our own keys or permissions refused: only these three answers", () => {
    for (const reason of ["invalid_client", "unauthorized_client", "invalid_scope"]) {
      expect(readTokenAnswer(JSON.stringify({ error: reason, error_description: "x", log_id: "1" }))).toEqual({ kind: "refused", reason });
    }
  });

  it("any other refusal is not blamed on our keys", () => {
    for (const reason of ["invalid_grant", "invalid_request", "access_denied", "server_error", 7, null]) {
      expect(readTokenAnswer(JSON.stringify({ error: reason, error_description: "Redirect_uri is not matched with the uri when requesting code." }))).toEqual({ kind: "failed", reason: "the code was not accepted" });
    }
  });

  it("a key without both permissions, without the account's number, or a number that is not text, is not used", () => {
    expect(readTokenAnswer(JSON.stringify({ ...good, scope: "user.info.basic" }))).toEqual({ kind: "failed", reason: "permissions missing" });
    expect(readTokenAnswer(JSON.stringify({ ...good, open_id: "" }))).toEqual({ kind: "failed", reason: "no account number" });
    expect(readTokenAnswer(JSON.stringify({ ...good, open_id: 12345 }))).toEqual({ kind: "failed", reason: "no account number" });
    expect(readTokenAnswer(JSON.stringify({ ...good, access_token: "" })).kind).toBe("failed");
    for (const body of ["", "<html>", "null", "[]", "{}"]) expect(readTokenAnswer(body)).toEqual({ kind: "failed", reason: "an answer that could not be read" });
  });
});

describe("readAccountAnswer", () => {
  const answer = (user: object, code = "ok") => JSON.stringify({ data: { user }, error: { code, message: "", log_id: "2022" } });

  it("reads the account's number and name", () => {
    expect(readAccountAnswer(answer({ open_id: "723f", username: "Jane.Doe_1", display_name: "Jane", avatar_url: "x" }), "723f")).toEqual({ kind: "account", openId: "723f", username: "Jane.Doe_1" });
  });

  it("the number must be the same text as in the token answer", () => {
    expect(readAccountAnswer(answer({ open_id: "other", username: "jane" }), "723f")).toEqual({ kind: "failed", reason: "account numbers differ" });
    expect(readAccountAnswer(answer({ username: "jane" }), "723f")).toEqual({ kind: "failed", reason: "no account number" });
    expect(readAccountAnswer(answer({ open_id: 723, username: "jane" }), "723")).toEqual({ kind: "failed", reason: "no account number" });
  });

  it("never takes the display name for the name", () => {
    expect(readAccountAnswer(answer({ open_id: "723f", display_name: "Jane Doe" }), "723f")).toEqual({ kind: "failed", reason: "no account name" });
    for (const username of ["", "j", "jane doe", "jane/doe", "a".repeat(25), 5]) expect(readAccountAnswer(answer({ open_id: "723f", username }), "723f")).toEqual({ kind: "failed", reason: "no account name" });
  });

  it("an answer that does not say ok, or cannot be read, is not used", () => {
    expect(readAccountAnswer(answer({ open_id: "723f", username: "jane" }, "scope_not_authorized"), "723f").kind).toBe("failed");
    expect(readAccountAnswer(answer({ open_id: "723f", username: "jane" }, "access_token_invalid"), "723f").kind).toBe("failed");
    for (const body of ["", "nope", "{}", JSON.stringify({ data: { user: { open_id: "723f", username: "jane" } } }), JSON.stringify({ error: { code: "ok" } })]) {
      expect(readAccountAnswer(body, "723f")).toEqual({ kind: "failed", reason: "an answer that could not be read" });
    }
  });
});

describe("tiktokAccountFor (with a pretended connection)", () => {
  type Sent = { url: string; method: string; headers?: Record<string, string>; body?: Record<string, string> };
  const connection = (answers: Array<string | null | Error>) => {
    const sent: Sent[] = [];
    const send: TikTokSend = async (url, request) => {
      sent.push({ url, method: request.method, headers: request.headers, body: request.body === undefined ? undefined : Object.fromEntries(new URLSearchParams(request.body)) });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    };
    return { sent, send };
  };
  const token = JSON.stringify({ access_token: "act.key", open_id: "723f", scope: BOTH });
  const account = JSON.stringify({ data: { user: { open_id: "723f", username: "jane.doe" } }, error: { code: "ok" } });

  it("swaps the code, asks once which account it is, and hands the key back", async () => {
    const { sent, send } = connection([token, account, "{}"]);
    expect(await tiktokAccountFor("the-code", SETTINGS, send)).toEqual({ kind: "account", openId: "723f", username: "jane.doe" });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST https://open.tiktokapis.com/v2/oauth/token/",
      "GET https://open.tiktokapis.com/v2/user/info/?fields=open_id,username",
      "POST https://open.tiktokapis.com/v2/oauth/revoke/",
    ]);
    expect(sent[0].body).toEqual({ client_key: "our-key", client_secret: "our-secret", code: "the-code", grant_type: "authorization_code", redirect_uri: SETTINGS.returnUrl });
    expect(sent[1].headers).toEqual({ authorization: "Bearer act.key" });
    // TikTok takes a form only under exactly this label (seen for real: with ";charset=UTF-8" it answers "malformed").
    expect(sent[0].headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(sent[2].headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(sent[2].body).toEqual({ client_key: "our-key", client_secret: "our-secret", token: "act.key" });
  });

  it("never puts the secret, the code or the key in an address", async () => {
    const { sent, send } = connection([token, account, "{}"]);
    await tiktokAccountFor("the-code", SETTINGS, send);
    for (const request of sent) for (const secret of ["our-secret", "the-code", "act.key"]) expect(request.url).not.toContain(secret);
  });

  it("when our keys are refused, nothing more is asked", async () => {
    const { sent, send } = connection([JSON.stringify({ error: "invalid_client" })]);
    expect(await tiktokAccountFor("the-code", SETTINGS, send)).toEqual({ kind: "refused", reason: "invalid_client" });
    expect(sent).toHaveLength(1);
  });

  it("hands the key back also when the next step fails, and a failed hand-back changes nothing", async () => {
    const noAnswer = connection([token, null, "{}"]);
    expect(await tiktokAccountFor("c", SETTINGS, noAnswer.send)).toEqual({ kind: "failed", reason: "no answer" });
    expect(noAnswer.sent.at(-1)?.url).toBe("https://open.tiktokapis.com/v2/oauth/revoke/");

    const wrongAccount = connection([token, JSON.stringify({ data: { user: { open_id: "someone-else", username: "jane" } }, error: { code: "ok" } }), "{}"]);
    expect(await tiktokAccountFor("c", SETTINGS, wrongAccount.send)).toEqual({ kind: "failed", reason: "account numbers differ" });
    expect(wrongAccount.sent).toHaveLength(3);

    const handBackFails = connection([token, account, new Error("down")]);
    expect(await tiktokAccountFor("c", SETTINGS, handBackFails.send)).toEqual({ kind: "account", openId: "723f", username: "jane.doe" });
    const noHandBackAnswer = connection([token, account, null]);
    expect(await tiktokAccountFor("c", SETTINGS, noHandBackAnswer.send)).toEqual({ kind: "account", openId: "723f", username: "jane.doe" });
  });

  it("a key that came in an answer that is not good enough is still handed back", async () => {
    const fewPermissions = connection([JSON.stringify({ access_token: "act.key", open_id: "723f", scope: "user.info.basic" }), "{}"]);
    expect(await tiktokAccountFor("c", SETTINGS, fewPermissions.send)).toEqual({ kind: "failed", reason: "permissions missing" });
    expect(fewPermissions.sent.map((s) => s.url)).toEqual(["https://open.tiktokapis.com/v2/oauth/token/", "https://open.tiktokapis.com/v2/oauth/revoke/"]);
    expect(fewPermissions.sent[1].body?.token).toBe("act.key");

    const noNumber = connection([JSON.stringify({ access_token: "act.key", scope: BOTH }), "{}"]);
    expect(await tiktokAccountFor("c", SETTINGS, noNumber.send)).toEqual({ kind: "failed", reason: "no account number" });
    expect(noNumber.sent.at(-1)?.url).toBe("https://open.tiktokapis.com/v2/oauth/revoke/");
  });

  it("no answer to the first request: nothing else is asked", async () => {
    const { sent, send } = connection([null]);
    expect(await tiktokAccountFor("c", SETTINGS, send)).toEqual({ kind: "failed", reason: "no answer" });
    expect(sent).toHaveLength(1);
  });
});
