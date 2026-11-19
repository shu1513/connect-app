import { describe, expect, it } from "vitest";
import { azureRefusal, readAzure } from "./azure";
import { readOpenAi } from "./openai";
import { askInOrder, waitMinutes, type ServiceTurn } from "./order";
import { readOwn } from "./own";
import { readSightengine, sightengineRefusal } from "./sightengine";
import { askService, type Answer } from "./types";

const NAMES = ["sexual", "violence", "violence/graphic", "self-harm", "self-harm/intent", "self-harm/instructions"];
/** An answer of OpenAI's as its guide shows it, with nothing found. */
function openAi(change: (result: { categories: Record<string, unknown>; category_scores: Record<string, unknown>; category_applied_input_types: Record<string, unknown> }) => void = () => {}) {
  const result = {
    flagged: false,
    categories: Object.fromEntries([...NAMES, "harassment"].map((name) => [name, false])) as Record<string, unknown>,
    category_scores: Object.fromEntries([...NAMES, "harassment"].map((name) => [name, 0.001])) as Record<string, unknown>,
    category_applied_input_types: { ...Object.fromEntries(NAMES.map((name) => [name, ["image"]])), harassment: [] } as Record<string, unknown>,
  };
  change(result);
  return { id: "modr-1", model: "omni-moderation-latest", results: [result] };
}

describe("reading OpenAI's answer", () => {
  it("is clean only when every check was applied to the picture and has a valid result", () => {
    expect(readOpenAi(openAi()).kind).toBe("clean");
  });
  it("is flagged when any of them is, even if another part is missing", () => {
    expect(readOpenAi(openAi((r) => (r.categories.sexual = true))).kind).toBe("flagged");
    expect(
      readOpenAi(
        openAi((r) => {
          r.categories["violence/graphic"] = true;
          delete r.category_scores.sexual;
        }),
      ).kind,
    ).toBe("flagged");
  });
  it("marks a flag that came with an incomplete answer, so it is not taken as proof that the service works", () => {
    expect(readOpenAi(openAi((r) => (r.categories.sexual = true))).partial).toBe(false);
    expect(readOpenAi({ results: [{ categories: { sexual: true } }] })).toMatchObject({ kind: "flagged", partial: true });
    expect(readAzure(azure({ Sexual: 4 }))).toMatchObject({ kind: "flagged", partial: true });
    expect(readAzure(azure({ Sexual: 4, Violence: 0, SelfHarm: 0 })).partial).toBe(false);
    expect(readSightengine({ status: "success", nudity: { erotica: 0.9 } })).toMatchObject({ kind: "flagged", partial: true });
  });
  it("is a fault when a check is missing, was only applied to text, or its number is not a number", () => {
    expect(readOpenAi(openAi((r) => delete r.categories.violence)).kind).toBe("fault");
    expect(readOpenAi(openAi((r) => (r.category_applied_input_types.sexual = ["text"]))).kind).toBe("fault");
    expect(readOpenAi(openAi((r) => (r.category_applied_input_types["self-harm"] = []))).kind).toBe("fault");
    expect(readOpenAi(openAi((r) => (r.category_scores.violence = "low"))).kind).toBe("fault");
    expect(readOpenAi(openAi((r) => (r.category_scores.sexual = Number.NaN))).kind).toBe("fault");
    expect(readOpenAi({ results: [] }).kind).toBe("fault");
    expect(readOpenAi({}).kind).toBe("fault");
  });
  it("does not take a flag for something it only checks in text as a flag for the picture", () => {
    expect(readOpenAi(openAi((r) => (r.categories.harassment = true))).kind).toBe("clean");
  });
});

const azure = (levels: Record<string, unknown>) => ({ categoriesAnalysis: Object.entries(levels).map(([category, severity]) => ({ category, severity })) });

describe("reading Microsoft's answer", () => {
  it("is clean when all three are there by name, below their levels", () => {
    expect(readAzure(azure({ Sexual: 0, Violence: 2, SelfHarm: 0 })).kind).toBe("clean");
    // The order in the list does not matter.
    expect(readAzure(azure({ SelfHarm: 2, Sexual: 0, Violence: 0 })).kind).toBe("clean");
  });
  it("flags sexual from level 2, violence and self-harm from level 4", () => {
    expect(readAzure(azure({ Sexual: 2, Violence: 0, SelfHarm: 0 })).kind).toBe("flagged");
    expect(readAzure(azure({ Sexual: 0, Violence: 4, SelfHarm: 0 })).kind).toBe("flagged");
    expect(readAzure(azure({ Sexual: 0, Violence: 0, SelfHarm: 6 })).kind).toBe("flagged");
    // A flag counts even when another result is missing.
    expect(readAzure(azure({ Sexual: 4 })).kind).toBe("flagged");
  });
  it("is a fault when one is missing or its level is not one of the four: a missing one is not zero", () => {
    expect(readAzure(azure({ Sexual: 0, SelfHarm: 0 })).kind).toBe("fault");
    expect(readAzure(azure({ Sexual: 0, Violence: 3, SelfHarm: 0 })).kind).toBe("fault");
    expect(readAzure(azure({ Sexual: "0", Violence: 0, SelfHarm: 0 })).kind).toBe("fault");
    expect(readAzure({}).kind).toBe("fault");
  });
  it("never passes over a second level for the same name", () => {
    const twice = (first: number, second: number) => ({ categoriesAnalysis: [{ category: "Sexual", severity: first }, { category: "Violence", severity: 0 }, { category: "SelfHarm", severity: 0 }, { category: "Sexual", severity: second }] });
    expect(readAzure(twice(0, 6))).toMatchObject({ kind: "flagged", partial: true });
    expect(readAzure(twice(0, 0)).kind).toBe("fault");
  });
  it("reads its own words for not now", () => {
    expect(azureRefusal(429, { error: { code: "TooManyRequests", message: "slow down" } })?.kind).toBe("out");
    expect(azureRefusal(403, { error: { code: "403", message: "Out of call volume quota for ContentSafety F0 pricing tier." } })?.kind).toBe("out");
    // A refused key is left to the HTTP code, which makes it a fault.
    expect(azureRefusal(401, { error: { code: "401", message: "Access denied due to invalid subscription key." } })).toBeNull();
  });
});

type Sight = { status: string; nudity: Record<string, unknown>; gore: { prob: unknown }; violence?: { prob: unknown }; "self-harm": { prob: unknown } };
const sightengine = (change: (answer: Sight) => void = () => {}) => {
  const answer: Sight = {
    status: "success",
    nudity: { sexual_activity: 0.01, sexual_display: 0.01, erotica: 0.01, very_suggestive: 0.3, none: 0.9 },
    gore: { prob: 0.01 },
    violence: { prob: 0.01 },
    "self-harm": { prob: 0.01 },
  };
  change(answer);
  return answer;
};

describe("reading Sightengine's answer", () => {
  it("is clean when it says success and every model's result is there", () => {
    expect(readSightengine(sightengine()).kind).toBe("clean");
  });
  it("flags nudity, gore, violence and self-harm above 0.5", () => {
    expect(readSightengine(sightengine((a) => (a.nudity.erotica = 0.51))).kind).toBe("flagged");
    expect(readSightengine(sightengine((a) => (a.gore.prob = 0.9))).kind).toBe("flagged");
    expect(readSightengine(sightengine((a) => (a.violence = { prob: 0.7 }))).kind).toBe("flagged");
    expect(readSightengine(sightengine((a) => (a["self-harm"].prob = 0.6))).kind).toBe("flagged");
    expect(readSightengine(sightengine((a) => (a.nudity.erotica = 0.5))).kind).toBe("clean");
  });
  it("is a fault when a model's result is missing or not a number", () => {
    expect(readSightengine(sightengine((a) => delete a.violence)).kind).toBe("fault");
    expect(readSightengine(sightengine((a) => (a.gore.prob = "none"))).kind).toBe("fault");
    expect(readSightengine(sightengine((a) => delete a.nudity.sexual_display)).kind).toBe("fault");
  });
  it("reads a limit as out and a refused key as a fault, whatever the HTTP code", () => {
    expect(sightengineRefusal(400, { status: "failure", error: { type: "usage_limit", code: 32, message: "Daily usage limit reached" } })?.kind).toBe("out");
    expect(sightengineRefusal(429, { status: "failure", error: { type: "usage_limit", code: 33, message: "Too many requests" } })?.kind).toBe("out");
    expect(sightengineRefusal(500, { status: "failure", error: { type: "server_error", code: 950, message: "Server error" } })?.kind).toBe("out");
    expect(sightengineRefusal(401, { status: "failure", error: { type: "credentials_error", code: 1, message: "Incorrect API user or API secret" } })?.kind).toBe("fault");
    expect(sightengineRefusal(400, { status: "failure", error: { type: "usage_limit", code: 35, message: "Unpaid invoices" } })?.kind).toBe("fault");
    expect(sightengineRefusal(400, { status: "failure", error: { type: "media_error", code: 10, message: "Not an image" } })?.kind).toBe("fault");
    expect(readSightengine({ status: "failure", error: { type: "usage_limit", code: 30, message: "Usage limit reached" } }).kind).toBe("out");
    expect(readSightengine({ status: "failure" }).kind).toBe("fault");
  });
});

const own = (porn: number, hentai: number, sexy: number) => [
  { className: "Neutral", probability: 1 - porn - hentai - sexy },
  { className: "Drawing", probability: 0 },
  { className: "Porn", probability: porn },
  { className: "Hentai", probability: hentai },
  { className: "Sexy", probability: sexy },
];

describe("reading Connect's own checker", () => {
  it("flags explicit at 0.5 together, or suggestive at 0.8", () => {
    expect(readOwn(own(0.01, 0.01, 0.1)).kind).toBe("clean");
    expect(readOwn(own(0.3, 0.2, 0)).kind).toBe("flagged");
    expect(readOwn(own(0, 0, 0.8)).kind).toBe("flagged");
    expect(readOwn(own(0, 0, 0.79)).kind).toBe("clean");
  });
  it("never lets a number that is not a share, or a class given twice, hide a finding", () => {
    const odd = [
      { className: "Porn", probability: 0.9 },
      { className: "Hentai", probability: -0.6 },
      { className: "Sexy", probability: 0 },
      { className: "Drawing", probability: 0 },
      { className: "Neutral", probability: 0.7 },
    ];
    expect(readOwn(odd)).toMatchObject({ kind: "flagged", partial: true });
    expect(readOwn([...own(0, 0, 0), { className: "Porn", probability: 0 }]).kind).toBe("fault");
    expect(readOwn([{ className: "Porn", probability: 1 }])).toMatchObject({ kind: "flagged", partial: true });
    expect(readOwn(own(0.1, 0.1, 0.1).map((entry) => (entry.className === "Sexy" ? { ...entry, probability: 1.5 } : entry))).kind).toBe("fault");
  });
  it("is a fault when one of its five numbers is missing", () => {
    expect(readOwn(own(0, 0, 0).slice(1)).kind).toBe("fault");
    expect(readOwn(null).kind).toBe("fault");
    expect(readOwn([{ className: "Porn", probability: Number.NaN }]).kind).toBe("fault");
  });
});

describe("asking a service", () => {
  const reply = (status: number, body: unknown) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const clean = (): Answer => ({ kind: "clean", detail: "" });
  it("turns no connection and no answer in time into out", async () => {
    expect((await askService(async () => Promise.reject(new TypeError("fetch failed")), clean)).kind).toBe("out");
    expect((await askService(async () => Promise.reject(new DOMException("timed out", "TimeoutError")), clean)).kind).toBe("out");
  });
  it("turns too many and trouble on its side into out, and every other refusal into a fault", async () => {
    expect((await askService(reply(429, { error: { message: "rate limit" } }), clean)).kind).toBe("out");
    expect((await askService(reply(503, "<html>busy</html>"), clean)).kind).toBe("out");
    expect((await askService(reply(401, { error: { message: "bad key" } }), clean)).kind).toBe("fault");
    expect((await askService(reply(400, { error: { message: "bad picture" } }), clean)).kind).toBe("fault");
  });
  it("takes an answer that stops arriving on the way as no answer in time, not as a fault", async () => {
    const stalls = async () => ({ ok: true, status: 200, json: async () => Promise.reject(new DOMException("timed out", "TimeoutError")) }) as unknown as Response;
    expect((await askService(stalls, clean)).kind).toBe("out");
    const breaks = async () => ({ ok: true, status: 200, json: async () => Promise.reject(new TypeError("terminated")) }) as unknown as Response;
    expect((await askService(breaks, clean)).kind).toBe("out");
  });
  it("is a fault when a good answer cannot be read", async () => {
    expect((await askService(reply(200, "not json"), clean)).kind).toBe("fault");
    expect((await askService(reply(200, null), readOpenAi)).kind).toBe("fault");
    expect((await askService(reply(200, {}), clean)).kind).toBe("clean");
  });
});

describe("the order of the queue", () => {
  const calls: string[] = [];
  const service = (name: string, kind: Answer["kind"], more: Partial<ServiceTurn> = {}): ServiceTurn => ({
    name,
    cooling: false,
    worked: true,
    check: async () => {
      calls.push(name);
      return { kind, detail: `${name} said ${kind}` };
    },
    ...more,
  });
  const ownSays = (kind: Answer["kind"]) => async () => {
    calls.push("own");
    return { kind, detail: `own said ${kind}` } as Answer;
  };
  const run = async (services: ServiceTurn[], own: (() => Promise<Answer>) | null = ownSays("clean")) => {
    calls.length = 0;
    const { outcome } = await askInOrder(services, own);
    return { outcome, calls: [...calls] };
  };

  it("stops at the first clean answer: shown, fully checked", async () => {
    const { outcome, calls } = await run([service("openai", "clean"), service("azure", "clean")]);
    expect(outcome).toMatchObject({ kind: "shown", level: "full", by: "openai" });
    expect(calls).toEqual(["openai"]);
  });
  it("stops at a flag: refused, and nobody else is asked", async () => {
    const { outcome, calls } = await run([service("openai", "flagged"), service("azure", "clean")]);
    expect(outcome).toMatchObject({ kind: "refused", by: "openai" });
    expect(calls).toEqual(["openai"]);
  });
  it("moves on when a service is out", async () => {
    const { outcome, calls } = await run([service("openai", "out"), service("azure", "out"), service("sightengine", "clean")]);
    expect(outcome).toMatchObject({ kind: "shown", level: "full", by: "sightengine" });
    expect(calls).toEqual(["openai", "azure", "sightengine"]);
  });
  it("waits on a fault: no next service, and never the own checker", async () => {
    const { outcome, calls } = await run([service("openai", "out"), service("azure", "fault"), service("sightengine", "clean")]);
    expect(outcome.kind).toBe("wait");
    expect(calls).toEqual(["openai", "azure"]);
  });
  it("asks the own checker only when every service is out: shown for nudity only, or refused", async () => {
    const all = [service("openai", "out"), service("azure", "out"), service("sightengine", "out")];
    expect((await run(all)).outcome).toMatchObject({ kind: "shown", level: "nudity_only", by: "own" });
    expect((await run(all, ownSays("flagged"))).outcome).toMatchObject({ kind: "refused", by: "own" });
    expect((await run(all, ownSays("fault"))).outcome.kind).toBe("wait");
    expect((await run(all, ownSays("out"))).outcome.kind).toBe("wait");
  });
  it("does not ask a service that is still in its five minutes, and counts it as out", async () => {
    const { outcome, calls } = await run([service("openai", "clean", { cooling: true }), service("azure", "out")]);
    expect(outcome).toMatchObject({ kind: "shown", level: "nudity_only" });
    expect(calls).toEqual(["azure", "own"]);
  });
  it("never asks the own checker when no service has a key", async () => {
    const { outcome, calls } = await run([]);
    expect(outcome.kind).toBe("wait");
    expect(calls).toEqual([]);
  });
  it("never asks the own checker when no service has worked yet with its key", async () => {
    const { outcome, calls } = await run([service("openai", "out", { worked: false }), service("azure", "out", { worked: false })]);
    expect(outcome.kind).toBe("wait");
    expect(calls).toEqual(["openai", "azure"]);
  });
  it("asks it when one service has worked and another, which never has, is out too", async () => {
    const { outcome } = await run([service("openai", "out", { worked: false }), service("azure", "out")]);
    expect(outcome).toMatchObject({ kind: "shown", level: "nudity_only" });
  });
  it("gives a picture that is shown for nudity only its full check, without the own checker", async () => {
    expect((await run([service("openai", "clean")], null)).outcome).toMatchObject({ kind: "shown", level: "full" });
    expect((await run([service("openai", "flagged")], null)).outcome.kind).toBe("refused");
    const out = await run([service("openai", "out")], null);
    expect(out.outcome.kind).toBe("wait");
    expect(out.calls).toEqual(["openai"]);
    expect((await run([service("openai", "fault")], null)).outcome.kind).toBe("wait");
  });
  it("asks before every request whether the picture may still be sent, and sends it to nobody once it may not", async () => {
    calls.length = 0;
    let allowed = true;
    const held = service("openai", "out");
    const first = { ...held, check: async () => ((allowed = false), held.check()) };
    const { outcome } = await askInOrder([first, service("azure", "clean")], ownSays("clean"), async () => allowed);
    expect(outcome.kind).toBe("wait");
    expect(calls).toEqual(["openai"]);
    calls.length = 0;
    expect((await askInOrder([service("openai", "clean")], null, async () => false)).outcome.kind).toBe("wait");
    expect(calls).toEqual([]);
    // Also not to the own checker.
    let left = 1;
    await askInOrder([service("openai", "out")], ownSays("clean"), async () => left-- > 0);
    expect(calls).toEqual(["openai"]);
  });
  it("waits 1 minute, then 5, then 15", () => {
    expect([1, 2, 3, 9].map(waitMinutes)).toEqual([1, 5, 15, 15]);
  });
});
