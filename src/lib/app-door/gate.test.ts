import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate itself, with the two things it asks (the switches, and who is logged in) stood in for.
vi.mock("server-only", () => ({}));
const switches = vi.fn();
const signedInFrom = vi.fn();
vi.mock("@/lib/safety/switches", () => ({ switches: () => switches() }));
vi.mock("@/lib/session", () => ({ signedInFrom: (headers: Headers, options: unknown) => signedInFrom(headers, options) }));

import { appRequest } from "./gate";
import { APP_HEADER, SIGN_IN_HEADER } from "./rules";

const person = { id: "u1", name: "Maria", email: "maria@example.test", timeZone: null, paused: false, emailVerified: true, welcomed: true, closed: false, twoFactorEnabled: false, sessionCreatedAt: new Date() };
const ask = (headers: Record<string, string>) => new Request("https://connect.example/api/app/anything", { headers });
const app = (more: Record<string, string> = {}) => ask({ [APP_HEADER]: "android 1.0.0", ...more });
/** The refusal's code; or "let in" for a real answer of the gate (one that names the app that asked), and never for anything else. */
const code = async (result: unknown) => {
  if (result instanceof Response) return ((await result.json()) as { error: { code: string } }).error.code;
  const asked = result as { client?: { platform?: string }; switches?: unknown } | undefined;
  return asked?.client?.platform === "android" && asked.switches !== undefined ? "let in" : "neither a refusal nor an answer";
};

beforeEach(() => {
  switches.mockReset().mockResolvedValue({ appOldestVersion: "" });
  signedInFrom.mockReset().mockResolvedValue(null);
});

describe("the gate for the app's addresses", () => {
  it("refuses what does not come the app's way, before anything is read", async () => {
    expect(await code(await appRequest(ask({}), "anyone"))).toBe("not_the_app");
    expect(await code(await appRequest(app({ "sec-fetch-site": "same-origin" }), "anyone"))).toBe("not_the_app");
    expect(switches).not.toHaveBeenCalled();
    expect(signedInFrom).not.toHaveBeenCalled();
  });

  it("refuses a copy that is too old, at every address but the opening one", async () => {
    switches.mockResolvedValue({ appOldestVersion: "1.0.1" });
    signedInFrom.mockResolvedValue(person);
    const refused = await appRequest(app({ [SIGN_IN_HEADER]: "s=1" }), "member");
    expect(refused instanceof Response && refused.status).toBe(426);
    expect(await code(refused)).toBe("update_needed");
    // An address for anyone is no exception: only the opening address answers a copy that is too old.
    expect(await code(await appRequest(app(), "anyone"))).toBe("update_needed");
    const opening = await appRequest(app(), "anyone", { opening: true });
    expect(opening instanceof Response).toBe(false);
    expect(!(opening instanceof Response) && opening.updateNeeded).toBe(true);
  });

  it("reads the sign-in from the app's own header, never from a cookie that came along", async () => {
    signedInFrom.mockResolvedValue(person);
    // A browser's cookie, with the app's header added by a page: nobody is read at all.
    expect(await code(await appRequest(app({ cookie: "better-auth.session_token=stolen" }), "member"))).toBe("not_signed_in");
    expect(signedInFrom).not.toHaveBeenCalled();

    const result = await appRequest(app({ cookie: "better-auth.session_token=ambient", [SIGN_IN_HEADER]: "better-auth.session_token=mine" }), "member");
    expect(result instanceof Response).toBe(false);
    expect(!(result instanceof Response) && result.person?.id).toBe("u1");
    const [handed, options] = signedInFrom.mock.calls[0] as [Headers, { renew?: boolean }];
    expect(handed.get("cookie")).toBe("better-auth.session_token=mine");
    expect([...handed.keys()]).toEqual(["cookie"]);
    // And it never extends the login: only the phone's own request to the login tool does.
    expect(options).toEqual({ renew: false });
  });

  it("does not read a sign-in that could not be one", async () => {
    signedInFrom.mockResolvedValue(person);
    for (const value of ["", "no-pairs-here", "a=\u00fc", "x".repeat(5000) + "=1"]) {
      signedInFrom.mockClear();
      expect(await code(await appRequest(app({ [SIGN_IN_HEADER]: value }), "member")), JSON.stringify(value.slice(0, 20))).toBe("not_signed_in");
      expect(signedInFrom).not.toHaveBeenCalled();
    }
  });

  it("lets in whom the address is for, and names what is missing for the others", async () => {
    const signed = () => app({ [SIGN_IN_HEADER]: "s=1" });
    expect(await code(await appRequest(app(), "member"))).toBe("not_signed_in");
    expect(await code(await appRequest(app(), "anyone"))).toBe("let in");

    signedInFrom.mockResolvedValue({ ...person, welcomed: false });
    expect(await code(await appRequest(signed(), "confirmed"))).toBe("let in");
    expect(await code(await appRequest(signed(), "member"))).toBe("welcome_needed");

    signedInFrom.mockResolvedValue({ ...person, paused: true });
    expect(await code(await appRequest(signed(), "member"))).toBe("let in");
    expect(await code(await appRequest(signed(), "active"))).toBe("paused");
  });

  it("answers a closed account exactly as it answers nobody", async () => {
    const nobody = await appRequest(app(), "member");
    signedInFrom.mockResolvedValue({ ...person, closed: true });
    const closed = await appRequest(app({ [SIGN_IN_HEADER]: "s=1" }), "member");
    expect(closed instanceof Response && nobody instanceof Response).toBe(true);
    expect((closed as Response).status).toBe((nobody as Response).status);
    expect(await (closed as Response).text()).toBe(await (nobody as Response).text());
    const open = await appRequest(app({ [SIGN_IN_HEADER]: "s=1" }), "anyone");
    expect(!(open instanceof Response) && open.person).toBeNull();
  });

  it("marks every answer as not to be kept", async () => {
    const refused = (await appRequest(ask({}), "anyone")) as Response;
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
  });
});
