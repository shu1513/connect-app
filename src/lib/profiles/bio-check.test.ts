import { describe, expect, it } from "vitest";
import { bioHasCode, isAutomatic, readInstagramAnswer, readYouTubeAnswer, type BioSettings } from "./bio-check";

const CODE = "connect-k7m2pqrs9x";

describe("bioHasCode", () => {
  it("finds the code in the middle of other text, in capitals, and next to an emoji", () => {
    expect(bioHasCode(`Dancer. Bookings: jo@example.test ${CODE} Love you all`, CODE)).toBe(true);
    expect(bioHasCode(`✨${CODE.toUpperCase()}✨`, CODE)).toBe(true);
    expect(bioHasCode(`line one\n${CODE}\nline three`, CODE)).toBe(true);
  });

  it("does not take half a code, another host's code, or an empty bio for it", () => {
    expect(bioHasCode(`hello ${CODE.slice(0, -1)}`, CODE)).toBe(false);
    expect(bioHasCode("hello connect-aaaaaaaaaa", CODE)).toBe(false);
    expect(bioHasCode("", CODE)).toBe(false);
    expect(bioHasCode("anything at all", "")).toBe(false);
  });
});

describe("readInstagramAnswer", () => {
  const good = (found: object) => JSON.stringify({ business_discovery: { id: "17841400039600391", ...found }, id: "17841401929457335" });

  it("reads a bio, also when Meta writes the name in other capitals", () => {
    expect(readInstagramAnswer(good({ username: "jane.doe", biography: `Hi ${CODE}` }), "jane.doe")).toEqual({ kind: "bio", text: `Hi ${CODE}` });
    expect(readInstagramAnswer(good({ username: "Jane.Doe", biography: "x" }), "jane.doe")).toEqual({ kind: "bio", text: "x" });
  });

  it("an account with an empty bio comes back without the field", () => {
    // Seen for real on 15 November 2026.
    expect(readInstagramAnswer(good({ username: "shu1513" }), "shu1513")).toEqual({ kind: "bio", text: "" });
  });

  it("an answer about a different account is not used", () => {
    expect(readInstagramAnswer(good({ username: "someone.else", biography: CODE }), "jane.doe")).toEqual({ kind: "unavailable" });
  });

  it("a name that does not exist is 'no account', by Meta's own numbers", () => {
    // Seen for real on 15 November 2026.
    const body = JSON.stringify({ error: { message: "Invalid user id", type: "OAuthException", code: 110, error_subcode: 2207013, error_user_title: "Cannot find User" } });
    expect(readInstagramAnswer(body, "zz_no_such")).toEqual({ kind: "no_account" });
    // The same number without that sub-number is not known to be about the host's account.
    expect(readInstagramAnswer(JSON.stringify({ error: { code: 110 } }), "zz_no_such")).toEqual({ kind: "unavailable", code: 110 });
    expect(readInstagramAnswer(JSON.stringify({ error: { code: 100, message: "Invalid parameter" } }), "zz_no_such")).toEqual({ kind: "unavailable", code: 100 });
  });

  it("a refused key or permission is ours, never the host's", () => {
    // Seen for real on 15 November 2026, with one permission missing.
    expect(readInstagramAnswer(JSON.stringify({ error: { message: "(#10) Application does not have permission for this action", code: 10, type: "OAuthException" } }), "jane")).toEqual({ kind: "refused", code: 10 });
    for (const code of [190, 102, 200, 299]) expect(readInstagramAnswer(JSON.stringify({ error: { code } }), "jane")).toEqual({ kind: "refused", code });
  });

  it("asked too often", () => {
    for (const code of [4, 17, 32, 613, 341, 80002]) expect(readInstagramAnswer(JSON.stringify({ error: { code } }), "jane")).toEqual({ kind: "too_often", code });
  });

  it("anything it does not recognise is 'not available'", () => {
    for (const body of ["", "<html>Sorry</html>", "null", "[]", "{}", JSON.stringify({ error: { message: "no number" } }), JSON.stringify({ error: { code: "190" } })]) {
      expect(readInstagramAnswer(body, "jane").kind).toBe("unavailable");
    }
    expect(readInstagramAnswer(good({ username: "jane", biography: 12 }), "jane")).toEqual({ kind: "unavailable" });
    expect(readInstagramAnswer(good({ biography: CODE }), "jane")).toEqual({ kind: "unavailable" });
  });
});

describe("readYouTubeAnswer", () => {
  const list = (items?: unknown) => JSON.stringify({ kind: "youtube#channelListResponse", etag: "x", pageInfo: { totalResults: Array.isArray(items) ? items.length : 0 }, ...(items === undefined ? {} : { items }) });

  it("reads the channel's description", () => {
    // The shape seen for real on 15 November 2026.
    const body = list([{ id: "UCBR8-60-B28hp2BmDPdntcQ", snippet: { title: "YouTube", customUrl: "@youtube", description: `Official. ${CODE}` } }]);
    expect(readYouTubeAnswer(body, "youtube")).toEqual({ kind: "bio", text: `Official. ${CODE}` });
    expect(readYouTubeAnswer(list([{ snippet: { title: "No handle given back", description: "d" } }]), "jane")).toEqual({ kind: "bio", text: "d" });
    expect(readYouTubeAnswer(list([{ snippet: { customUrl: "@Jane-Doe" } }]), "jane-doe")).toEqual({ kind: "bio", text: "" });
  });

  it("a handle that leads nowhere is a good answer with no channel in it", () => {
    // Seen for real on 15 November 2026: no "items" at all.
    expect(readYouTubeAnswer(list(), "nobody-here")).toEqual({ kind: "no_account" });
    expect(readYouTubeAnswer(list([]), "nobody-here")).toEqual({ kind: "no_account" });
  });

  it("a channel with a different handle, or with only a matching title, is not used", () => {
    expect(readYouTubeAnswer(list([{ snippet: { customUrl: "@someone-else", description: CODE } }]), "jane").kind).toBe("unavailable");
    expect(readYouTubeAnswer(list([{ snippet: { title: "jane", customUrl: "@not-jane", description: CODE } }]), "jane").kind).toBe("unavailable");
    expect(readYouTubeAnswer(list([{ snippet: { description: CODE } }, { snippet: { description: CODE } }]), "jane").kind).toBe("unavailable");
  });

  it("tells a refused key from a used-up allowance, by Google's reasons", () => {
    const failure = (code: number, reason: string, where: "errors" | "details" = "errors") => JSON.stringify({ error: { code, message: "m", [where]: [{ reason }] } });
    expect(readYouTubeAnswer(failure(403, "quotaExceeded"), "jane")).toEqual({ kind: "too_often", code: 403 });
    expect(readYouTubeAnswer(failure(403, "rateLimitExceeded"), "jane")).toEqual({ kind: "too_often", code: 403 });
    expect(readYouTubeAnswer(failure(400, "keyInvalid"), "jane")).toEqual({ kind: "refused", code: 400 });
    expect(readYouTubeAnswer(failure(403, "accessNotConfigured"), "jane")).toEqual({ kind: "refused", code: 403 });
    expect(readYouTubeAnswer(failure(400, "API_KEY_INVALID", "details"), "jane")).toEqual({ kind: "refused", code: 400 });
    expect(readYouTubeAnswer(failure(500, "backendError"), "jane")).toEqual({ kind: "unavailable", code: 500 });
  });

  it("anything it does not recognise is 'not available'", () => {
    for (const body of ["", "not json", "null", "{}", JSON.stringify({ kind: "something#else", items: [] }), list("not a list"), list([{ snippet: { description: 5 } }]), list([{}])]) {
      expect(readYouTubeAnswer(body, "jane").kind).toBe("unavailable");
    }
  });
});

describe("isAutomatic", () => {
  const both: BioSettings = { instagram: { token: "t", accountId: "17841401929457335" }, youtube: { key: "k" } };

  it("Instagram and YouTube, each only when its own settings are there", () => {
    expect(isAutomatic("instagram", both)).toBe(true);
    expect(isAutomatic("youtube", both)).toBe(true);
    expect(isAutomatic("instagram", { ...both, instagram: null })).toBe(false);
    expect(isAutomatic("youtube", { ...both, instagram: null })).toBe(true);
    expect(isAutomatic("youtube", { ...both, youtube: null })).toBe(false);
  });

  it("never TikTok, X or anything else", () => {
    for (const network of ["tiktok", "x", "", "Instagram", "facebook"]) expect(isAutomatic(network, both)).toBe(false);
  });
});
