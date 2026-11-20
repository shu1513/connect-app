import type { AppHostPage, AppSearch } from "../../../src/lib/app-door/types";
import { byDay, isHostPage, isSearch } from "./host-rules";

const found: AppSearch = {
  typed: "maya",
  searched: true,
  hint: null,
  hosts: [{ handle: "maya", name: "Maya Makes", about: "I make things.", price: "$25.00 per 15 minutes", languages: ["English"], socials: [{ label: "Instagram", name: "mayamakes" }], rating: { average: 4.8, count: 21 }, photoId: null }],
  more: null,
};

const page: AppHostPage = {
  handle: "maya",
  name: "Maya Makes",
  about: "I make things.",
  photoId: null,
  languages: ["English"],
  rating: null,
  socials: [{ label: "Instagram", name: "mayamakes", url: "https://instagram.com/mayamakes" }],
  own: false,
  shareUrl: "https://connect.example/h/maya",
  follow: "none",
  price: "$25.00 per 15 minutes",
  callWords: "A private one-to-one video call. Free to cancel any time before the call starts.",
  verifiedOnly: false,
  confirmId: false,
  now: null,
  ask: { title: "Ask for a call", titleNotNow: "Ask for a call", closed: null, words: "This sends a request.", lengths: [{ minutes: 30, words: "30 minutes, $50.00" }], chosen: 30, starts: ["2026-11-21T20:00:00.000Z"], noTimes: null },
  membership: null,
};

describe("the server's answers for search and a host's page", () => {
  it("are taken when they have what the screens read", () => {
    expect(isSearch(found)).toBe(true);
    expect(isSearch({ ...found, hosts: [], hint: "Nobody found." })).toBe(true);
    expect(isHostPage(page)).toBe(true);
    expect(isHostPage({ ...page, follow: null, now: { lengths: [{ minutes: 15, words: "15 minutes" }], answerMinutes: 2, paid: false, freshSeconds: 90 } })).toBe(true);
    expect(
      isHostPage({
        ...page,
        membership: { invitedUntil: "2026-12-01T00:00:00.000Z", state: { status: "paused", words: "Your membership is paused." }, member: { left: "1 hour left", until: "2026-12-01T00:00:00.000Z", price: "$15.00 per 15 minutes", held: null, tooLittle: false, canBook: true, lengths: [{ minutes: 30, words: "30 minutes" }], chosen: 30, times: [{ startsAt: "2026-11-21T20:00:00.000Z", membersOnly: true }] } },
      }),
    ).toBe(true);
  });

  it("are not taken when a part the screens read is missing or wrong", () => {
    for (const bad of [{}, null, [], { ...found, hosts: [{ handle: "maya" }] }, { ...found, searched: "yes" }, { ...found, hosts: [{ ...found.hosts[0], languages: "English" }] }]) expect(isSearch(bad)).toBe(false);
    for (const bad of [
      {},
      null,
      { ...page, ask: undefined },
      { ...page, ask: { ...page.ask, starts: ["tomorrow"] } },
      { ...page, ask: { ...page.ask, lengths: [{ minutes: "30" }] } },
      { ...page, follow: "maybe" },
      { ...page, socials: [{ label: "Instagram" }] },
      { ...page, now: { lengths: [] } },
      { ...page, membership: { invitedUntil: null, state: null, member: { left: "1 hour left" } } },
      { ...page, price: 25 },
    ]) {
      expect(isHostPage(bad)).toBe(false);
    }
  });
});

describe("open times, by the phone's own days", () => {
  const starts = ["2026-11-21T07:30:00.000Z", "2026-11-21T03:00:00.000Z", "2026-11-21T08:15:00.000Z", "2026-11-22T20:00:00.000Z"];

  it("puts each time under the day it falls on where the phone is, in order", () => {
    // Los Angeles: 03:00 UTC is the evening before, 07:30 too (23:30), 08:15 is a quarter past midnight.
    expect(byDay(starts, "America/Los_Angeles")).toEqual([
      { day: "2026-11-20", starts: ["2026-11-21T03:00:00.000Z", "2026-11-21T07:30:00.000Z"] },
      { day: "2026-11-21", starts: ["2026-11-21T08:15:00.000Z"] },
      { day: "2026-11-22", starts: ["2026-11-22T20:00:00.000Z"] },
    ]);
    // Tokyo is a day ahead for all of them.
    expect(byDay(starts, "Asia/Tokyo").map((d) => [d.day, d.starts.length])).toEqual([
      ["2026-11-21", 3],
      ["2026-11-23", 1],
    ]);
  });

  it("is empty for no times", () => {
    expect(byDay([], "UTC")).toEqual([]);
  });
});
