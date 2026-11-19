import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseAccount,
  INSTAGRAM_ACCOUNTS_ASKED,
  instagramAccountsFor,
  instagramLoginUrl,
  instagramSettings,
  readAccountsAnswer,
  readKeyAnswer,
  type InstagramSend,
  type InstagramSettings,
} from "./instagram";

const SETTINGS: InstagramSettings = { appId: "2019306082070462", appSecret: "our-secret", configId: "2598664127223933", returnUrl: "https://connect.example/api/social/instagram/return", signingSecret: "s3cret" };

describe("instagramSettings", () => {
  const before = { ...process.env };
  afterEach(() => {
    process.env = { ...before };
  });
  const set = (values: Record<string, string | undefined>) => {
    for (const name of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_LOGIN_CONFIG_ID", "BETTER_AUTH_SECRET", "PUBLIC_APP_URL", "BETTER_AUTH_URL"]) delete process.env[name];
    for (const [name, value] of Object.entries(values)) if (value !== undefined) process.env[name] = value;
  };
  const on = { INSTAGRAM_APP_ID: "2019306082070462", INSTAGRAM_APP_SECRET: "s", INSTAGRAM_LOGIN_CONFIG_ID: "2598664127223933", BETTER_AUTH_SECRET: "x", PUBLIC_APP_URL: "https://connect.example/" };

  it("is on with the app's number, its secret, the configuration's number and a plain https address, and builds the one return address", () => {
    set(on);
    expect(instagramSettings()).toEqual({ appId: "2019306082070462", appSecret: "s", configId: "2598664127223933", returnUrl: "https://connect.example/api/social/instagram/return", signingSecret: "x" });
  });

  it("is off when any one of them is missing, the signing secret included", () => {
    for (const name of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_LOGIN_CONFIG_ID", "BETTER_AUTH_SECRET"]) {
      set({ ...on, [name]: undefined });
      expect(instagramSettings()).toBeNull();
      set({ ...on, [name]: " " });
      expect(instagramSettings()).toBeNull();
    }
  });

  it("is off when one of Meta's two numbers is not a number", () => {
    set({ ...on, INSTAGRAM_APP_ID: "connect" });
    expect(instagramSettings()).toBeNull();
    set({ ...on, INSTAGRAM_LOGIN_CONFIG_ID: "2598664127223933&x=1" });
    expect(instagramSettings()).toBeNull();
  });

  it("is off when the site's address is not a plain https address", () => {
    for (const address of ["http://localhost:3000", "https://connect.example/app", "https://connect.example/?a=1", "https://connect.example/#x", "https://someone:pw@connect.example", "not an address", ""]) {
      set({ ...on, PUBLIC_APP_URL: address });
      expect(instagramSettings()).toBeNull();
    }
  });

  it("the bio check's own two settings do not switch it on", () => {
    set({ INSTAGRAM_CHECK_TOKEN: "t", INSTAGRAM_CHECK_ACCOUNT_ID: "17841401929457335", BETTER_AUTH_SECRET: "x", PUBLIC_APP_URL: "https://connect.example" } as Record<string, string>);
    expect(instagramSettings()).toBeNull();
  });
});

describe("instagramLoginUrl", () => {
  it("sends the host to Meta with the app's number, the configuration, the return address and the value", () => {
    const url = new URL(instagramLoginUrl({ appId: SETTINGS.appId, configId: SETTINGS.configId, returnUrl: SETTINGS.returnUrl, state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/dialog/oauth");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: SETTINGS.appId, config_id: SETTINGS.configId, redirect_uri: SETTINGS.returnUrl, response_type: "code", state: "abc" });
  });
});

describe("readKeyAnswer", () => {
  it("reads the key", () => {
    expect(readKeyAnswer(JSON.stringify({ access_token: "EAAkey", token_type: "bearer", expires_in: 5183944 }))).toEqual({ kind: "key", accessToken: "EAAkey" });
  });

  it("tells our own set-up being refused from a code Meta will not take", () => {
    // Both seen for real on 19 November 2026.
    const unknownApp = { error: { message: "Error validating application. Cannot get application info due to a system error.", type: "OAuthException", code: 101 } };
    const unknownReturn = { error: { message: "Can't load URL: The domain of this URL isn't included in the app's domains.", type: "OAuthException", code: 191 } };
    expect(readKeyAnswer(JSON.stringify(unknownApp))).toEqual({ kind: "refused" });
    expect(readKeyAnswer(JSON.stringify(unknownReturn))).toEqual({ kind: "refused" });
    expect(readKeyAnswer(JSON.stringify({ error: { message: "This authorization code has been used.", type: "OAuthException", code: 100 } }))).toEqual({ kind: "failed", reason: "the code was not accepted" });
    expect(readKeyAnswer(JSON.stringify({ error: "nope" }))).toEqual({ kind: "failed", reason: "the code was not accepted" });
    // An error is an error, also when a key is written beside it.
    expect(readKeyAnswer(JSON.stringify({ error: { code: 100 }, access_token: "EAAkey" })).kind).toBe("failed");
  });

  it("an answer without a key, or one that cannot be read, is not used", () => {
    for (const body of ["", "nope", "[]", "{}", JSON.stringify({ access_token: "" }), JSON.stringify({ access_token: 5 })]) {
      expect(readKeyAnswer(body)).toEqual({ kind: "failed", reason: "an answer that could not be read" });
    }
  });
});

describe("readAccountsAnswer", () => {
  const list = (data: unknown, paging: unknown = { cursors: { before: "a", after: "b" } }) => JSON.stringify({ data, paging });
  const unreadable = { kind: "failed", reason: "the list of accounts could not be read" };

  it("reads the list as Meta sent it for real: cursors are there also when nothing follows", () => {
    const real = '{"data":[{"id":"17841401929457335","username":"shu1513"}],"paging":{"cursors":{"before":"QVFI","after":"QVFI"}}}';
    expect(readAccountsAnswer(real)).toEqual({ kind: "accounts", accounts: [{ accountId: "17841401929457335", username: "shu1513" }] });
  });

  it("reads none and several", () => {
    expect(readAccountsAnswer(list([]))).toEqual({ kind: "accounts", accounts: [] });
    expect(readAccountsAnswer(JSON.stringify({ data: [] }))).toEqual({ kind: "accounts", accounts: [] });
    expect(readAccountsAnswer(list([{ id: "11111", username: "Jane.Doe_1" }, { id: "22222", username: "other" }]))).toEqual({
      kind: "accounts",
      accounts: [{ accountId: "11111", username: "Jane.Doe_1" }, { accountId: "22222", username: "other" }],
    });
  });

  it("keeps a number too long for a JavaScript number exactly as it came", () => {
    const body = '{"data":[{"id":"178414019294573359999","username":"jane"}]}';
    expect(readAccountsAnswer(body)).toEqual({ kind: "accounts", accounts: [{ accountId: "178414019294573359999", username: "jane" }] });
    // A bare number has already lost its last digits when it is read: it is not taken.
    expect(readAccountsAnswer('{"data":[{"id":178414019294573359999,"username":"jane"}]}')).toEqual(unreadable);
  });

  it("a list that goes on is refused whole, however short this page is", () => {
    const more = { cursors: { before: "a", after: "b" }, next: "https://graph.facebook.com/v27.0/next-page" };
    expect(readAccountsAnswer(list([{ id: "11111", username: "jane" }], more))).toEqual({ kind: "failed", reason: "the list of accounts goes on" });
    const many = Array.from({ length: INSTAGRAM_ACCOUNTS_ASKED + 1 }, (_, i) => ({ id: String(10000 + i), username: `a${i}` }));
    expect(readAccountsAnswer(list(many))).toEqual({ kind: "failed", reason: "the list of accounts goes on" });
  });

  it("a paging part that is damaged is a damaged answer, never taken for \"nothing follows\"", () => {
    const one = [{ id: "11111", username: "jane" }];
    for (const paging of ["damaged", ["next"], 5, true]) expect(readAccountsAnswer(list(one, paging))).toEqual(unreadable);
    // Left out, empty, or with an empty "next": nothing follows.
    for (const paging of [null, {}, { next: null }]) expect(readAccountsAnswer(list(one, paging)).kind).toBe("accounts");
    expect(readAccountsAnswer(JSON.stringify({ data: one })).kind).toBe("accounts");
  });

  it("one line that cannot be read makes the whole list unreadable: lines are never dropped", () => {
    const good = { id: "11111", username: "jane" };
    for (const bad of [{ username: "other" }, { id: "22222" }, { id: "", username: "other" }, { id: "22x22", username: "other" }, { id: "22222", username: "ot her" }, { id: "22222", username: "a".repeat(31) }, null, "22222"]) {
      expect(readAccountsAnswer(list([good, bad]))).toEqual(unreadable);
    }
  });

  it("the same account twice, by number or by name, is not a list", () => {
    expect(readAccountsAnswer(list([{ id: "11111", username: "jane" }, { id: "11111", username: "other" }]))).toEqual(unreadable);
    expect(readAccountsAnswer(list([{ id: "11111", username: "jane" }, { id: "22222", username: "JANE" }]))).toEqual(unreadable);
  });

  it("an error, or an answer that is not a list, is not used", () => {
    for (const body of ["", "nope", "{}", "[]", JSON.stringify({ data: "x" }), JSON.stringify({ error: { message: "(#10) Application does not have permission for this action", code: 10 } }), JSON.stringify({ data: [{ id: "11111", username: "jane" }], error: { code: 10 } })]) {
      expect(readAccountsAnswer(body)).toEqual(unreadable);
    }
  });
});

describe("chooseAccount: which of the shared accounts is taken", () => {
  const a = { accountId: "11111", username: "alice" };
  const b = { accountId: "22222", username: "bob" };
  const take = (account: typeof a) => ({ kind: "take", account });

  it("none shared: none", () => {
    expect(chooseAccount([], null)).toEqual({ kind: "none_shared" });
    expect(chooseAccount([], { nameKey: "alice", providerAccountId: "11111" })).toEqual({ kind: "none_shared" });
  });

  it("1. exactly one shared: that one, whatever the host's entry says", () => {
    expect(chooseAccount([a], null)).toEqual(take(a));
    expect(chooseAccount([a], { nameKey: "someone.else", providerAccountId: null })).toEqual(take(a));
    expect(chooseAccount([a], { nameKey: "bob", providerAccountId: "22222" })).toEqual(take(a));
  });

  it("2. several, and one has the number kept on the entry: that one, whatever the names say", () => {
    expect(chooseAccount([a, b], { nameKey: "alice", providerAccountId: "22222" })).toEqual(take(b));
    // The entry's account was renamed, and another shared account now carries its old name: the number wins.
    const renamed = { accountId: "11111", username: "alice.new" };
    const tookTheName = { accountId: "22222", username: "alice" };
    expect(chooseAccount([tookTheName, renamed], { nameKey: "alice", providerAccountId: "11111" })).toEqual(take(renamed));
  });

  it("an entry with a number that is not among the shared accounts never falls back to its name", () => {
    expect(chooseAccount([a, b], { nameKey: "alice", providerAccountId: "99999" })).toEqual({ kind: "several" });
  });

  it("3. several, no number on the entry, exactly one has the entry's name: that one", () => {
    expect(chooseAccount([a, b], { nameKey: "bob", providerAccountId: null })).toEqual(take(b));
    expect(chooseAccount([{ accountId: "11111", username: "Alice" }, b], { nameKey: "alice", providerAccountId: null })).toEqual(take({ accountId: "11111", username: "Alice" }));
  });

  it("4. several, and neither: none. A name the host typed is never taken when Meta did not list it", () => {
    expect(chooseAccount([a, b], null)).toEqual({ kind: "several" });
    expect(chooseAccount([a, b], { nameKey: "carol", providerAccountId: null })).toEqual({ kind: "several" });
  });
});

describe("instagramAccountsFor (with a pretended connection)", () => {
  type Sent = { url: string; method: string; headers?: Record<string, string>; body?: Record<string, string> };
  const connection = (answers: Array<string | null>) => {
    const sent: Sent[] = [];
    const send: InstagramSend = async (url, request) => {
      sent.push({ url, method: request.method, headers: request.headers, body: request.body === undefined ? undefined : Object.fromEntries(new URLSearchParams(request.body)) });
      return answers.shift() ?? null;
    };
    return { sent, send };
  };
  const key = JSON.stringify({ access_token: "EAAkey", token_type: "bearer" });
  const accounts = JSON.stringify({ data: [{ id: "17841401929457335", username: "jane.doe" }], paging: { cursors: { before: "a", after: "b" } } });

  it("swaps the code and asks once which accounts were shared: two requests, and no third", async () => {
    const { sent, send } = connection([key, accounts]);
    expect(await instagramAccountsFor("the-code", SETTINGS, send)).toEqual({ kind: "accounts", accounts: [{ accountId: "17841401929457335", username: "jane.doe" }] });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST https://graph.facebook.com/v27.0/oauth/access_token",
      `GET https://graph.facebook.com/v27.0/me/assigned_instagram_accounts?fields=id,username&limit=${INSTAGRAM_ACCOUNTS_ASKED}`,
    ]);
    // The secret and the code travel in the body, with the return address once more; the key in a header.
    expect(sent[0].headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(sent[0].body).toEqual({ client_id: SETTINGS.appId, client_secret: "our-secret", redirect_uri: SETTINGS.returnUrl, code: "the-code" });
    expect(sent[1].headers).toEqual({ authorization: "Bearer EAAkey" });
    expect(sent[1].body).toBeUndefined();
  });

  it("never puts the secret, the code or the key in an address", async () => {
    const { sent, send } = connection([key, accounts]);
    await instagramAccountsFor("the-code", SETTINGS, send);
    for (const request of sent) for (const secret of ["our-secret", "the-code", "EAAkey"]) expect(request.url).not.toContain(secret);
  });

  it("when our own set-up is refused, or the code is not taken, nothing more is asked", async () => {
    const refused = connection([JSON.stringify({ error: { code: 101 } })]);
    expect(await instagramAccountsFor("c", SETTINGS, refused.send)).toEqual({ kind: "refused" });
    expect(refused.sent).toHaveLength(1);
    const used = connection([JSON.stringify({ error: { code: 100 } })]);
    expect(await instagramAccountsFor("c", SETTINGS, used.send)).toEqual({ kind: "failed", reason: "the code was not accepted" });
    expect(used.sent).toHaveLength(1);
  });

  it("no answer to either request is a failure, never a guess", async () => {
    const first = connection([null]);
    expect(await instagramAccountsFor("c", SETTINGS, first.send)).toEqual({ kind: "failed", reason: "no answer" });
    expect(first.sent).toHaveLength(1);
    const second = connection([key, null]);
    expect(await instagramAccountsFor("c", SETTINGS, second.send)).toEqual({ kind: "failed", reason: "no answer" });
    expect(second.sent).toHaveLength(2);
  });

  it("the real requests have a time limit, follow no redirect and are never answered from a store", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const answers = [key, accounts];
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return new Response(answers.shift());
    });
    try {
      expect((await instagramAccountsFor("the-code", SETTINGS)).kind).toBe("accounts");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.options.redirect).toBe("error");
      expect(call.options.cache).toBe("no-store");
      expect(call.options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("a request that breaks (no connection, a redirect, too slow) is \"no answer\", never an error thrown on", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    try {
      expect(await instagramAccountsFor("the-code", SETTINGS)).toEqual({ kind: "failed", reason: "no answer" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a list Meta would not give (the permission was not granted) is a failure", async () => {
    const { send } = connection([key, JSON.stringify({ error: { message: "(#10) Application does not have permission for this action", code: 10 } })]);
    expect(await instagramAccountsFor("c", SETTINGS, send)).toEqual({ kind: "failed", reason: "the list of accounts could not be read" });
  });
});
