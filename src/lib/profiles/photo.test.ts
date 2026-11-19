import { afterEach, describe, expect, it, vi } from "vitest";
import { readInstagramPhoto, readInstagramPhotoAnswer } from "./bio-check";
import { fetchPicture } from "./photo-fetch";
import { PHOTO, PICTURE_SERVERS, pictureAddress, sameAccount, serverFamily } from "./photo-rules";

const PICTURE = "https://scontent-lax7-1.xx.fbcdn.net/v/t51.2885-15/1234_n.jpg?_nc_cat=1&oe=6920A1B2";

describe("readInstagramPhotoAnswer", () => {
  // The shape seen for real on 19 November 2026: our own account's number outside, the asked account's inside.
  const good = (found: object) => JSON.stringify({ business_discovery: { id: "17841400039600391", ...found }, id: "17841401929457335" });

  it("reads the account's own number and the picture's address from the same answer", () => {
    expect(readInstagramPhotoAnswer(good({ username: "jane.doe", profile_picture_url: PICTURE }), "jane.doe")).toEqual({ kind: "picture", accountId: "17841400039600391", address: PICTURE });
    expect(readInstagramPhotoAnswer(good({ username: "Jane.Doe", profile_picture_url: PICTURE }), "jane.doe").kind).toBe("picture");
  });

  it("an answer about a different account is not used", () => {
    expect(readInstagramPhotoAnswer(good({ username: "someone.else", profile_picture_url: PICTURE }), "jane.doe")).toEqual({ kind: "unavailable" });
  });

  it("an answer without the account's number, or with one that is not a number, is not used", () => {
    expect(readInstagramPhotoAnswer(JSON.stringify({ business_discovery: { username: "jane", profile_picture_url: PICTURE }, id: "17841401929457335" }), "jane")).toEqual({ kind: "unavailable" });
    for (const id of [17841400039600391, "", "abc", "1784140003960039117841400039600391", null]) {
      expect(readInstagramPhotoAnswer(good({ id, username: "jane", profile_picture_url: PICTURE }), "jane")).toEqual({ kind: "unavailable" });
    }
  });

  it("an account that shows no picture is 'no picture'; a picture field of another kind is not used", () => {
    expect(readInstagramPhotoAnswer(good({ username: "jane" }), "jane")).toEqual({ kind: "no_picture" });
    for (const value of [null, 7, "", ["x"], "x".repeat(2001)]) expect(readInstagramPhotoAnswer(good({ username: "jane", profile_picture_url: value }), "jane")).toEqual({ kind: "unavailable" });
  });

  it("Meta's failures are told apart exactly as for a bio", () => {
    expect(readInstagramPhotoAnswer(JSON.stringify({ error: { code: 110, error_subcode: 2207013 } }), "zz_no_such")).toEqual({ kind: "no_account" });
    expect(readInstagramPhotoAnswer(JSON.stringify({ error: { code: 190 } }), "jane")).toEqual({ kind: "refused", code: 190 });
    expect(readInstagramPhotoAnswer(JSON.stringify({ error: { code: 4 } }), "jane")).toEqual({ kind: "too_often", code: 4 });
    for (const body of ["", "<html>Sorry</html>", "null", "[]", "{}"]) expect(readInstagramPhotoAnswer(body, "jane").kind).toBe("unavailable");
  });
});

describe("pictureAddress", () => {
  const servers = PICTURE_SERVERS.instagram;

  it("takes an https address on one of Meta's picture servers", () => {
    expect(pictureAddress(PICTURE, servers)?.hostname).toBe("scontent-lax7-1.xx.fbcdn.net");
    expect(pictureAddress("https://SCONTENT.xx.FBCDN.net/a.jpg", servers)?.hostname).toBe("scontent.xx.fbcdn.net");
  });

  it("refuses every other server, also ones made to look alike", () => {
    for (const address of [
      "https://evilfbcdn.net/a.jpg",
      "https://fbcdn.net.example.com/a.jpg",
      "https://example.com/fbcdn.net/a.jpg",
      "https://example.com/?x=.fbcdn.net",
      "https://fbcdn.net/a.jpg",
      "https://scontent.fbcdn.net./a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://[::1]/a.jpg",
      "https://localhost/a.jpg",
      "https://scontent.cdninstagram.com/a.jpg",
    ]) {
      expect(pictureAddress(address, servers), address).toBeNull();
    }
  });

  it("refuses http, a name and password, a port of its own, and what is not an address", () => {
    for (const address of [
      "http://scontent.xx.fbcdn.net/a.jpg",
      "https://user:pass@scontent.xx.fbcdn.net/a.jpg",
      "https://user@scontent.xx.fbcdn.net/a.jpg",
      "https://scontent.xx.fbcdn.net:8443/a.jpg",
      "ftp://scontent.xx.fbcdn.net/a.jpg",
      "data:image/jpeg;base64,AAAA",
      "//scontent.xx.fbcdn.net/a.jpg",
      "",
      "not an address",
    ]) {
      expect(pictureAddress(address, servers), address).toBeNull();
    }
  });

  it("a network with no servers listed gives no address at all", () => {
    expect(pictureAddress(PICTURE, PICTURE_SERVERS.tiktok)).toBeNull();
  });

  it("only the last two parts of a server's name are ever written down", () => {
    expect(serverFamily("https://a.b.example.com/secret/path?key=1")).toBe("example.com");
    expect(serverFamily("nonsense")).toBe("not an address");
  });
});

describe("sameAccount", () => {
  const photo = { sourceNameKey: "jane.doe", sourceAccountId: "111" };

  it("no confirmed entry on that network: the photo has no account", () => {
    expect(sameAccount(photo, null)).toBe(false);
  });

  it("an entry proven by signing in decides by its number, whatever the name", () => {
    expect(sameAccount(photo, { nameKey: "jane.doe", providerAccountId: "111" })).toBe(true);
    expect(sameAccount(photo, { nameKey: "jane.new", providerAccountId: "111" })).toBe(true);
    // The same name, now another account.
    expect(sameAccount(photo, { nameKey: "jane.doe", providerAccountId: "222" })).toBe(false);
  });

  it("an entry proven with the code decides by its name", () => {
    expect(sameAccount(photo, { nameKey: "jane.doe", providerAccountId: null })).toBe(true);
    expect(sameAccount(photo, { nameKey: "someone.else", providerAccountId: null })).toBe(false);
  });
});

describe("fetchPicture", () => {
  const address = new URL(PICTURE);
  const answerOf = (pieces: Uint8Array[], init: ResponseInit = {}, gap = 0) =>
    new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const piece of pieces) {
            if (gap) await new Promise((resolve) => setTimeout(resolve, gap));
            controller.enqueue(piece);
          }
          controller.close();
        },
      }),
      init,
    );

  it("gives the bytes of a good answer, and asks without a key, a cookie or a redirect", async () => {
    let asked: RequestInit | undefined;
    const bytes = await fetchPicture(address, {
      transport: async (_address, init) => {
        asked = init;
        return answerOf([new Uint8Array([1, 2]), new Uint8Array([3])]);
      },
    });
    expect(bytes && [...bytes]).toEqual([1, 2, 3]);
    expect(asked?.redirect).toBe("error");
    expect(asked?.credentials).toBe("omit");
    expect(asked?.cache).toBe("no-store");
    expect(asked?.headers).toBeUndefined();
  });

  it("another answer than 200, an empty one, and no connection give nothing", async () => {
    for (const status of [204, 206, 301, 302, 404, 500]) expect(await fetchPicture(address, { transport: async () => new Response(status === 204 ? null : "x", { status }) })).toBeNull();
    expect(await fetchPicture(address, { transport: async () => answerOf([]) })).toBeNull();
    expect(
      await fetchPicture(address, {
        transport: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    ).toBeNull();
  });

  it("a picture that is too large is dropped, whether it says so or not", async () => {
    const piece = new Uint8Array(600);
    expect(await fetchPicture(address, { maxBytes: 1000, transport: async () => answerOf([piece], { headers: { "content-length": "5000" } }) })).toBeNull();
    expect(await fetchPicture(address, { maxBytes: 1000, transport: async () => answerOf([piece, piece]) })).toBeNull();
    expect((await fetchPicture(address, { maxBytes: 1000, transport: async () => answerOf([piece]) }))?.length).toBe(600);
  });

  it("the time limit covers the reading too", async () => {
    const slow: Parameters<typeof fetchPicture>[1] = {
      withinMs: 40,
      transport: async (_address, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            // The rest never comes; the reading ends when the request is stopped.
            init.signal?.addEventListener("abort", () => controller.error(new DOMException("stopped", "AbortError")));
          },
        });
        return new Response(body);
      },
    };
    expect(await fetchPicture(address, slow)).toBeNull();
  });

  it("the limits are the plan's", () => {
    expect(PHOTO.triesPerDay).toBe(5);
    expect(PHOTO.fetchMaxBytes).toBe(5 * 1024 * 1024);
    expect(PHOTO.fetchWithinMs).toBe(8000);
  });
});

describe("readInstagramPhoto: how Meta's answer is read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const withSettings = () => {
    vi.stubEnv("INSTAGRAM_CHECK_TOKEN", "a-pretend-key");
    vi.stubEnv("INSTAGRAM_CHECK_ACCOUNT_ID", "17841401929457335");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  };
  const inPieces = (text: string, size: number) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(text);
          for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
          controller.close();
        },
      }),
    );
  const good = JSON.stringify({ business_discovery: { id: "17841400039600391", username: "jane.doe", profile_picture_url: PICTURE }, id: "17841401929457335" });

  it("an answer that arrives in many small pieces is put together and read; the key goes in a header, never in the address", async () => {
    withSettings();
    let asked: { address: string; init?: RequestInit } | undefined;
    vi.stubGlobal("fetch", async (address: URL, init?: RequestInit) => {
      asked = { address: String(address), init };
      return inPieces(good, 7);
    });
    expect(await readInstagramPhoto("jane.doe")).toEqual({ kind: "picture", accountId: "17841400039600391", address: PICTURE });
    expect(asked?.address).toContain("business_discovery.username%28jane.doe%29%7Bid%2Cusername%2Cprofile_picture_url%7D");
    expect(asked?.address).not.toContain("a-pretend-key");
    expect((asked?.init?.headers as Record<string, string>).authorization).toBe("Bearer a-pretend-key");
    expect(asked?.init?.redirect).toBe("error");
  });

  it("an answer longer than any real one is dropped while it is being read", async () => {
    withSettings();
    let pulled = 0;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled++;
              // It never ends by itself: only the reader's own limit stops it.
              controller.enqueue(new Uint8Array(64 * 1024).fill(32));
            },
          }),
        ),
    );
    expect(await readInstagramPhoto("jane.doe")).toEqual({ kind: "unavailable" });
    expect(pulled).toBeLessThan(20);
  });

  it("without the settings, or for a name that is not a name, nothing is asked", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", async () => (asked++, inPieces(good, 100)));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("INSTAGRAM_CHECK_TOKEN", "");
    vi.stubEnv("INSTAGRAM_CHECK_ACCOUNT_ID", "");
    expect(await readInstagramPhoto("jane.doe")).toEqual({ kind: "unavailable" });
    withSettings();
    expect(await readInstagramPhoto("jane doe){biography}")).toEqual({ kind: "unavailable" });
    expect(asked).toBe(0);
  });
});
