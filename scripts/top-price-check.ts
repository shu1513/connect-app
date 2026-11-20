/**
 * Testing tool: a higher top price for one host (plans/48), against the local database, through
 * the app's own functions: the one a host's "Save" calls, the one a person applies with, and the
 * one the founder's form calls. It makes its own three people (two hosts and a founder), touches
 * no other account, needs neither Stripe nor the app running, and removes what it made (people
 * whose email starts "topprice-", also those of an earlier run that was stopped).
 *
 * Usage: npx tsx scripts/top-price-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  const shown = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${!ok && shown ? `  (${shown.slice(0, 500)})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const P = await import("../src/lib/profiles/profiles");

  const emailOf = (name: string) => `topprice-${RUN}-${name}@example.test`;
  const ids = { hana: randomUUID(), ben: randomUUID(), founder: randomUUID() };

  /** Takes away everything a run made, this one's or an earlier one's that was stopped. */
  async function cleanUp() {
    const people = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, "topprice-%@example.test"))).map((p) => p.id);
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "topprice-%@example.test"));
    if (people.length === 0) return;
    await db.delete(schema.adminActions).where(inArray(schema.adminActions.adminId, people));
    await db.delete(schema.membershipOffers).where(inArray(schema.membershipOffers.hostId, people));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, people));
    await db.delete(schema.user).where(inArray(schema.user.id, people));
  }

  const now = new Date();
  async function person(id: string, name: string) {
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email: emailOf(name), emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
  }
  async function host(id: string, name: string) {
    await person(id, name);
    const handle = `tp_${RUN}_${name}`;
    await db.insert(schema.hostProfiles).values({ userId: id, handle, handleKey: handle.replace(/_/g, ""), displayName: `Check ${name}`, pricePer15Cents: 2_000, status: "approved", languages: ["en"], usConfirmedAt: now });
  }
  const profileOf = async (id: string) => (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, id)))[0];
  /** A host presses "Save" with this price. Gives back the refusal in words, or null when it was saved. */
  async function save(id: string, name: string, pricePer15Cents: number, extra: Record<string, unknown> = {}): Promise<string | null> {
    try {
      await P.updateHostProfile(id, { displayName: `Check ${name}`, about: "", pricePer15Cents, languages: ["en"], ...extra });
      return null;
    } catch (error) {
      if (error instanceof P.ProfileError) return error.message;
      throw error;
    }
  }
  /** The founder's form. Gives back what happened, or the refusal in words. */
  async function setTop(id: string, topPricePer15Cents: number | null): Promise<Awaited<ReturnType<typeof P.setTopPrice>> | string> {
    try {
      return await P.setTopPrice({ userId: id, topPricePer15Cents, by: ids.founder });
    } catch (error) {
      if (error instanceof P.ProfileError) return error.message;
      throw error;
    }
  }
  const emailsTo = async (name: string) => db.select({ subject: schema.emailOutbox.subject, body: schema.emailOutbox.body }).from(schema.emailOutbox).where(eq(schema.emailOutbox.to, emailOf(name)));
  const recordOf = async (id: string) => db.select().from(schema.adminActions).where(and(eq(schema.adminActions.adminId, ids.founder), eq(schema.adminActions.targetUserId, id))).orderBy(schema.adminActions.createdAt);

  await cleanUp();
  try {
    await host(ids.hana, "hana");
    await host(ids.ben, "ben");
    await person(ids.founder, "founder");

    console.log("\nEvery host: at most $1,000 per 15 minutes, as before");
    check("a host saves exactly $1,000", (await save(ids.hana, "hana", 100_000)) === null);
    check("a host is refused one cent more, in words", (await save(ids.hana, "hana", 100_001)) === "Your price can be at most $1000.00 per 15 minutes.");
    check("a host is refused $2,500", /at most \$1000\.00/.test((await save(ids.hana, "hana", 250_000)) ?? ""));
    check("the refused price was not saved", (await profileOf(ids.hana)).pricePer15Cents === 100_000);
    let applied = "";
    try {
      await P.createHostProfile(ids.founder, { handle: `tp_${RUN}_new`, displayName: "Check new", about: "", pricePer15Cents: 100_001, country: "US", languages: ["en"], sellerKind: "private", agreements: null });
    } catch (error) {
      applied = error instanceof Error ? error.message : String(error);
    }
    check("someone who applies is refused above $1,000 too", applied === "Your price can be at most $1000.00 per 15 minutes.", applied);
    check("a host cannot give herself a top price: what her form sends is not taken", (await save(ids.hana, "hana", 100_000, { topPricePer15Cents: 250_000 })) === null && (await profileOf(ids.hana)).topPricePer15Cents === null);

    console.log("\nThe founder gives one host a higher top price");
    check("not above everyone's: refused", /must be more than that/.test(String(await setTop(ids.hana, 100_000))));
    check("above the founder's ceiling of $2,500: refused", /highest top price a host can be given is \$2500\.00/.test(String(await setTop(ids.hana, 250_001))));
    check("not an amount: refused", /in dollars/.test(String(await setTop(ids.hana, Number.NaN))));
    check("someone who is not a host: refused", /not found/.test(String(await setTop(ids.founder, 200_000))));
    check("nothing was written for the refusals", (await profileOf(ids.hana)).topPricePer15Cents === null && (await recordOf(ids.hana)).length === 0);
    const given = await setTop(ids.hana, 200_000);
    check("$2,000 for one host: done, her price untouched", typeof given !== "string" && given.topPricePer15Cents === 200_000 && given.priceLoweredFrom === null, given);
    check("it is on her profile", (await profileOf(ids.hana)).topPricePer15Cents === 200_000 && (await profileOf(ids.hana)).pricePer15Cents === 100_000);
    const firstNote = await recordOf(ids.hana);
    check("the founder's record has it", firstNote.length === 1 && firstNote[0].action === "top price set" && firstNote[0].detail === "Top price per 15 minutes: from $1000.00 to $2000.00.", firstNote);
    check("no email for a raise", (await emailsTo("hana")).length === 0);
    check("the same top price again: refused, nothing written", /already \$2000\.00/.test(String(await setTop(ids.hana, 200_000))) && (await recordOf(ids.hana)).length === 1);
    check("that host now saves $2,000", (await save(ids.hana, "hana", 200_000)) === null && (await profileOf(ids.hana)).pricePer15Cents === 200_000);
    check("and is refused one cent more", (await save(ids.hana, "hana", 200_001)) === "Your price can be at most $2000.00 per 15 minutes.");
    check("the other host is still refused above $1,000", (await save(ids.ben, "ben", 100_001)) === "Your price can be at most $1000.00 per 15 minutes." && (await profileOf(ids.ben)).topPricePer15Cents === null);

    console.log("\nThe founder lowers it: the host's price comes down at once");
    const lowered = await setTop(ids.hana, 150_000);
    check("lowered to $1,500: her price of $2,000 came down", typeof lowered !== "string" && lowered.topPricePer15Cents === 150_000 && lowered.priceLoweredFrom === 200_000, lowered);
    check("her price is $1,500 now", (await profileOf(ids.hana)).pricePer15Cents === 150_000 && (await profileOf(ids.hana)).topPricePer15Cents === 150_000);
    const mail = await emailsTo("hana");
    check("she is told by one email", mail.length === 1 && mail[0].subject === "Your price on Connect is now $1500.00 per 15 minutes" && mail[0].body.includes("Your price was $2000.00 per 15 minutes"), mail);
    const notes = await recordOf(ids.hana);
    check("the founder's record says both", notes.length === 2 && notes[1].detail === "Top price per 15 minutes: from $2000.00 to $1500.00. The host's price came down from $2000.00 to $1500.00.", notes);
    const raised = await setTop(ids.hana, 250_000);
    check("raised to the ceiling, $2,500: her price stays, no email", typeof raised !== "string" && raised.priceLoweredFrom === null && (await profileOf(ids.hana)).pricePer15Cents === 150_000 && (await emailsTo("hana")).length === 1);

    console.log("\nA regular price is never below a member's price");
    check("she saves $2,400", (await save(ids.hana, "hana", 240_000)) === null);
    await db.insert(schema.membershipOffers).values({ hostId: ids.hana, on: true, pricePer15Cents: 220_000, includedMinutes: 60 });
    const stopped = String(await setTop(ids.hana, 200_000));
    check("lowering below her member price is refused, in words", /has members at \$2200\.00/.test(stopped) && /You can lower the top price to \$2200\.00 now/.test(stopped), stopped);
    check("nothing was changed by it", (await profileOf(ids.hana)).pricePer15Cents === 240_000 && (await profileOf(ids.hana)).topPricePer15Cents === 250_000 && (await recordOf(ids.hana)).length === 3);
    check("taking the top price away is refused for the same reason", /has members at \$2200\.00/.test(String(await setTop(ids.hana, null))));
    const toFloor = await setTop(ids.hana, 220_000);
    check("lowering to the member price itself works", typeof toFloor !== "string" && toFloor.priceLoweredFrom === 240_000 && (await profileOf(ids.hana)).pricePer15Cents === 220_000);

    console.log("\nThe founder takes it away");
    await db.update(schema.membershipOffers).set({ on: false }).where(eq(schema.membershipOffers.hostId, ids.hana));
    const gone = await setTop(ids.hana, null);
    check("back to everyone's $1,000: her price came down to it", typeof gone !== "string" && gone.topPricePer15Cents === 100_000 && gone.priceLoweredFrom === 220_000, gone);
    const after = await profileOf(ids.hana);
    check("her profile has no top price of its own", after.topPricePer15Cents === null && after.pricePer15Cents === 100_000);
    const last = (await recordOf(ids.hana)).at(-1);
    check("the founder's record says it was removed", last?.action === "top price removed" && last.detail === "Top price per 15 minutes: from $2200.00 to $1000.00. The host's price came down from $2200.00 to $1000.00.", last);
    check("she is told by email each time her price came down", (await emailsTo("hana")).length === 3);
    check("she is refused above $1,000 again", (await save(ids.hana, "hana", 100_001)) === "Your price can be at most $1000.00 per 15 minutes.");
    check("taking it away twice: refused", /already \$1000\.00/.test(String(await setTop(ids.hana, null))));

    console.log("\nThe database's own word");
    for (const [label, cents] of [["above $2,500", 250_001], ["exactly $1,000", 100_000], ["below $1,000", 50_000]] as const) {
      let refused = false;
      try {
        await db.execute(sql`update host_profiles set top_price_per_15_cents = ${cents} where user_id = ${ids.ben}`);
      } catch {
        refused = true;
      }
      check(`a top price ${label} is refused by the database itself`, refused);
    }
    check("the other host was never touched", (await profileOf(ids.ben)).pricePer15Cents === 2_000 && (await profileOf(ids.ben)).topPricePer15Cents === null && (await emailsTo("ben")).length === 0);
  } finally {
    await cleanUp();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
