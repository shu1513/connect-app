/**
 * Testing tool: the legal documents in the app and the proof of who accepted what
 * (plans/46-agreements-live.md, part 1), against the local database. It makes its own people,
 * touches no other account, needs neither Stripe nor the video service, and removes what it made.
 *
 * Usage: npx tsx scripts/agreements-check.ts
 *
 * With --app=http://localhost:3000 it also asks the running app for the seven document pages.
 * What only a browser shows (the welcome step and the Hosting page as a logged-in person sees
 * them) is not covered here; it is tried by hand.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

const APP = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? null;
const RUN = randomUUID().slice(0, 8);
const DAY = 24 * 3_600_000;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const A = await import("../src/legal/accept");
  const R = await import("../src/legal/registry");
  const P = await import("../src/lib/profiles/profiles");
  const closing = await import("../src/lib/profiles/closing");

  const made: string[] = [];
  const emailOf = (name: string) => `agreecheck-${RUN}-${name}@example.test`;
  async function person(name: string, extra: Partial<typeof schema.user.$inferInsert> = {}) {
    const id = `ag-${RUN}-${name}`;
    await db.insert(schema.user).values({ id, name: `Person ${name}`, email: emailOf(name), emailVerified: true, ...extra });
    made.push(id);
    return { id, name: `Person ${name}`, email: emailOf(name) };
  }
  const userNow = async (id: string) => (await db.select().from(schema.user).where(eq(schema.user.id, id)))[0];
  const linesOf = async (id: string) => db.select().from(schema.agreementAcceptances).where(eq(schema.agreementAcceptances.userId, id)).orderBy(schema.agreementAcceptances.acceptedAt, schema.agreementAcceptances.document);
  const mailTo = async (name: string, subject: string) => db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, emailOf(name)), like(schema.emailOutbox.subject, `%${subject}%`)));
  const refusal = async (attempt: Promise<unknown>): Promise<string | null> => attempt.then(() => null, (error: Error) => error.message);
  const shownNow = (occasion: "sign_up" | "hosting", now = new Date()) => Object.fromEntries(R.agreementsToAccept(occasion, now).map((a) => [a.name, a.version]));

  try {
    console.log("\n1. Finishing sign-up");
    {
      const ann = await person("ann");
      const now = new Date();
      check("a form that names no versions writes nothing", (await refusal(A.acceptGeneralAgreements({ userId: ann.id, shown: {}, timeZone: "UTC", now }))) === A.STALE_AGREEMENTS && (await linesOf(ann.id)).length === 0 && (await userNow(ann.id)).termsVersion === null);
      check("nor does one that names an older version of one of the three", (await refusal(A.acceptGeneralAgreements({ userId: ann.id, shown: { ...shownNow("sign_up"), "payment-terms": "2020-01-01" }, timeZone: "UTC", now }))) === A.STALE_AGREEMENTS && (await linesOf(ann.id)).length === 0);
      check("what a form carries is read back as it was written", JSON.stringify(A.readShown(A.shownValue(R.agreementsToAccept("sign_up", now)))) === JSON.stringify(shownNow("sign_up")) && JSON.stringify(A.readShown("nonsense@1|terms-of-service")) === "{}");

      await A.acceptGeneralAgreements({ userId: ann.id, shown: shownNow("sign_up"), timeZone: "America/New_York", now });
      const lines = await linesOf(ann.id);
      const after = await userNow(ann.id);
      check("finishing sign-up writes one line for each of the three documents, as a sign-up", lines.length === 3 && lines.every((line) => line.occasion === "sign_up" && line.version === "2026-11-20") && lines.map((line) => line.document).sort().join() === "community-rules,payment-terms,terms-of-service", JSON.stringify(lines.map((l) => [l.document, l.version, l.occasion])));
      check("and the stamp, the moment, 18 or older and the time zone on the person's own line, in the same step", after.termsVersion === R.generalStamp(now) && after.termsAcceptedAt?.getTime() === now.getTime() && after.adultConfirmedAt?.getTime() === now.getTime() && after.timeZone === "America/New_York");
      check("every line carries the same moment", lines.every((line) => line.acceptedAt.getTime() === now.getTime()));

      const later = new Date(now.getTime() + 5_000);
      await A.acceptGeneralAgreements({ userId: ann.id, shown: shownNow("sign_up"), timeZone: "America/New_York", now: later });
      const again = await linesOf(ann.id);
      check("pressing a second time writes no new line and leaves the first moment as it was", again.length === 3 && again.every((line) => line.acceptedAt.getTime() === now.getTime()) && (await userNow(ann.id)).adultConfirmedAt?.getTime() === now.getTime());

      const unverified = await person("unverified", { emailVerified: false });
      const closed = await person("closed", { closedAt: new Date() });
      check("someone whose email address is not confirmed cannot accept, and neither can a closed account", (await refusal(A.acceptGeneralAgreements({ userId: unverified.id, shown: shownNow("sign_up"), timeZone: "UTC", now }))) !== null && (await refusal(A.acceptGeneralAgreements({ userId: closed.id, shown: shownNow("sign_up"), timeZone: "UTC", now }))) !== null && (await linesOf(unverified.id)).length + (await linesOf(closed.id)).length === 0);
    }

    console.log("\n2. A new version");
    {
      const bob = await person("bob");
      const now = new Date();
      await A.acceptGeneralAgreements({ userId: bob.id, shown: shownNow("sign_up"), timeZone: "UTC", now });
      const before = R.generalStamp(now);
      const day = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
      const versions = R.DOCUMENTS["terms-of-service"].versions;
      const texts = R.TEXTS["terms-of-service"];
      // A made-up next version of the Terms, only inside this run: first still to come, then in effect.
      const next = { version: "2099-01-01", effectiveFrom: day(40), addedOn: day(0), draft: true, summary: "A change made up for this check." };
      versions.push(next);
      texts[next.version] = "# Terms of Service\n\nA version made up for this check.";
      try {
        check("a version whose day has not come changes nothing yet: the stamp stays, and it is named as coming", R.generalStamp(now) === before && R.comingVersion("terms-of-service", now)?.version === "2099-01-01" && R.currentVersion("terms-of-service", now).version === "2026-11-20");
        next.effectiveFrom = day(-1);
        check("from its day the stamp is another one, so the person is asked again", R.generalStamp(now) !== before && (await userNow(bob.id)).termsVersion === before);
        check("the versions the old page showed are refused now", (await refusal(A.acceptGeneralAgreements({ userId: bob.id, shown: { "terms-of-service": "2026-11-20", "payment-terms": "2026-11-20", "community-rules": "2026-11-20" }, timeZone: "UTC", now }))) === A.STALE_AGREEMENTS);
        const later = new Date(now.getTime() + 60_000);
        await A.acceptGeneralAgreements({ userId: bob.id, shown: shownNow("sign_up", later), timeZone: "UTC", now: later });
        const lines = await linesOf(bob.id);
        const added = lines.filter((line) => line.version === "2099-01-01");
        check("accepting it adds one line for the new version, as a new version, and keeps the three old lines with their moment", lines.length === 4 && added.length === 1 && added[0].document === "terms-of-service" && added[0].occasion === "new_version" && lines.filter((line) => line.version === "2026-11-20").every((line) => line.acceptedAt.getTime() === now.getTime() && line.occasion === "sign_up"));
        const after = await userNow(bob.id);
        check("the stamp is the new one, and the day they first said 18 or older stays", after.termsVersion === R.generalStamp(later) && after.adultConfirmedAt?.getTime() === now.getTime() && after.termsAcceptedAt?.getTime() === later.getTime());
      } finally {
        versions.pop();
        delete texts[next.version];
      }
      check("(afterwards the list of documents is as it was)", R.registryProblems().length === 0 && R.generalStamp(now) === before);
    }

    console.log("\n3. Applying to host");
    const decider = await person("decider");
    {
      const cara = await person("cara");
      const details = { handle: `ag${RUN}cara`, displayName: "Cara Check", about: "", pricePer15Cents: 2000, country: "US", languages: ["en"] };
      const profileOf = async (id: string) => (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, id)))[0];
      check("without the tick for the Host Agreement an application is refused, and no profile is made", /tick the box/.test((await refusal(P.createHostProfile(cara.id, { ...details, sellerKind: "private", agreements: null }))) ?? "") && !(await profileOf(cara.id)));
      check("without saying business or private it is refused too", /business or as a private person/.test((await refusal(P.createHostProfile(cara.id, { ...details, sellerKind: "", agreements: shownNow("hosting") }))) ?? "") && !(await profileOf(cara.id)));
      check("and with a Host Agreement version that is not the one in effect: no profile and no line", (await refusal(P.createHostProfile(cara.id, { ...details, sellerKind: "private", agreements: { "host-agreement": "2020-01-01" } }))) === A.STALE_AGREEMENTS && !(await profileOf(cara.id)) && (await linesOf(cara.id)).length === 0);
      await P.createHostProfile(cara.id, { ...details, sellerKind: "business", agreements: shownNow("hosting") });
      const lines = await linesOf(cara.id);
      check("with both, the profile is made with her answer, and the Host Agreement's line is written with it", (await profileOf(cara.id))?.sellerKind === "business" && lines.length === 1 && lines[0].document === "host-agreement" && lines[0].occasion === "host_application" && (await A.holdsHostAgreement(cara.id, new Date())));
      check("her page says how she offers calls", (await P.sellerLine(cara.id, "Cara Check")) === "Cara Check offers calls as a business.");
      await P.updateHostProfile(cara.id, { displayName: "Cara Check", about: "", pricePer15Cents: 2000, languages: ["en"], sellerKind: "private" });
      check("she can change her answer, and a form that does not ask leaves it alone", /private person, not as a business/.test((await P.sellerLine(cara.id, "Cara Check")) ?? "") && (await P.updateHostProfile(cara.id, { displayName: "Cara Check", about: "", pricePer15Cents: 2000, languages: ["en"] }).then(() => profileOf(cara.id)))?.sellerKind === "private");

      // A host from before all this: made directly, as she was then.
      const old = await person("old");
      await db.insert(schema.hostProfiles).values({ userId: old.id, handle: `ag${RUN}old`, handleKey: `ag${RUN}old`, displayName: "Old Host", pricePer15Cents: 2000, status: "approved", usConfirmedAt: new Date() });
      check("a host from before has said nothing: her page says nothing about it, and she does not hold the Host Agreement", (await P.sellerLine(old.id, "Old Host")) === null && !(await A.holdsHostAgreement(old.id, new Date())));
      check("the box on her Hosting page needs both answers", /tick the box/.test((await refusal(P.answerHostBox(old.id, { sellerKind: "private", agreements: null }))) ?? "") && /business or as a private person/.test((await refusal(P.answerHostBox(old.id, { sellerKind: "", agreements: shownNow("hosting") }))) ?? ""));
      await P.answerHostBox(old.id, { sellerKind: "private", agreements: shownNow("hosting") });
      const oldLines = await linesOf(old.id);
      check("answering it writes her line and her answer", oldLines.length === 1 && oldLines[0].occasion === "host_new_version" && (await A.holdsHostAgreement(old.id, new Date())) && (await profileOf(old.id))?.sellerKind === "private");

      console.log("\n4. The reason for a decision");
      check("declining without a rule and a sentence is refused", /Choose the rule/.test((await refusal(P.decideProfile({ userId: cara.id, decision: "declined", by: decider.id }))) ?? "") && /Choose the rule/.test((await refusal(P.decideProfile({ userId: cara.id, decision: "declined", by: decider.id, reason: { ruleKey: "impersonation", note: "  " } }))) ?? "") && (await profileOf(cara.id))?.status === "pending");
      await P.decideProfile({ userId: cara.id, decision: "declined", by: decider.id, reason: { ruleKey: "impersonation", note: "The name on the page is not the name on the confirmed account." } });
      const declined = await profileOf(cara.id);
      const told = await mailTo("cara", "was not approved");
      const reason = "No pretending to be someone else. The name on the page is not the name on the confirmed account.";
      check("with them, the reason is saved with the decision", declined?.status === "declined" && declined.decidedReason === reason, String(declined?.decidedReason));
      check("and the host is told it by email, in the same step", told.length === 1 && told[0].body.includes(`The reason:\n\n${reason}`));
      await P.decideProfile({ userId: cara.id, decision: "declined", by: decider.id, reason: { ruleKey: "scam", note: "Another reason, given the second time." } });
      const repeated = await profileOf(cara.id);
      check("the same decision given again changes nothing: the first reason and its moment stay, and no second email goes out", repeated?.decidedReason === reason && repeated.decidedAt?.getTime() === declined?.decidedAt?.getTime() && (await mailTo("cara", "was not approved")).length === 1);
      await P.updateHostProfile(cara.id, { displayName: "Cara Check", about: "Changed, and sent in again.", pricePer15Cents: 2000, languages: ["en"] });
      check("a declined page that is sent in again is waiting again, and the reason goes with the decline", (await profileOf(cara.id))?.status === "pending" && (await profileOf(cara.id))?.decidedReason === null);
      await P.decideProfile({ userId: old.id, decision: "suspended", by: decider.id, reason: { ruleKey: "scam", note: "Asked customers for money outside Connect." } });
      const suspendedMail = await mailTo("old", "has been suspended");
      check("a suspension carries its reason too, on the page and in the email", (await profileOf(old.id))?.decidedReason === "No scams. Asked customers for money outside Connect." && suspendedMail.length === 1 && suspendedMail[0].body.includes("The reason:\n\nNo scams. Asked customers for money outside Connect."));
    }

    console.log("\n5. The identity check's notice");
    {
      const dan = await person("dan");
      const now = new Date();
      check("a page that showed no notice, or an older one, starts nothing", (await refusal(A.acceptIdentityNotice({ userId: dan.id, shown: {}, now }))) === A.STALE_AGREEMENTS && (await refusal(A.acceptIdentityNotice({ userId: dan.id, shown: { "identity-check-notice": "2020-01-01" }, now }))) === A.STALE_AGREEMENTS && (await linesOf(dan.id)).length === 0);
      const version = await A.acceptIdentityNotice({ userId: dan.id, shown: { "identity-check-notice": R.currentVersion("identity-check-notice", now).version }, now });
      const lines = await linesOf(dan.id);
      check("agreeing to the notice writes its line and gives back the version for the check's own line", version === "2026-11-20" && lines.length === 1 && lines[0].document === "identity-check-notice" && lines[0].occasion === "identity_check" && lines[0].acceptedAt.getTime() === now.getTime());
      await A.acceptIdentityNotice({ userId: dan.id, shown: { "identity-check-notice": version }, now: new Date(now.getTime() + 1000) });
      check("a second check under the same notice keeps the first line as it is", (await linesOf(dan.id)).length === 1 && (await linesOf(dan.id))[0].acceptedAt.getTime() === now.getTime());
      await db.insert(schema.identityChecks).values({ userId: dan.id, stripeSessionId: `vs_agreecheck_${randomUUID()}`, status: "started", noticeVersion: version });
      check("and each check's own line can hold the version it was started under", (await db.select().from(schema.identityChecks).where(eq(schema.identityChecks.userId, dan.id)))[0].noticeVersion === "2026-11-20");
    }

    console.log("\n6. Closing an account with a reason");
    {
      const eve = await person("eve");
      const fay = await person("fay");
      await closing.closeAccount({ userId: eve.id, by: decider.id, reason: "No scams. Took payment outside Connect, three reports." });
      const mail = await mailTo("eve", "has been closed");
      check("the reason is saved, and the person is told it by email in the same step", (await userNow(eve.id)).closedReason === "No scams. Took payment outside Connect, three reports." && mail.length === 1 && mail[0].body.includes("The reason:\n\nNo scams. Took payment outside Connect, three reports."));
      await closing.closeAccount({ userId: fay.id, by: decider.id });
      check("a closing without a reason (only check scripts close that way) sends nothing", (await userNow(fay.id)).closedAt !== null && (await mailTo("fay", "has been closed")).length === 0);
    }

    if (APP) {
      console.log("\n7. The pages");
      const get = async (path: string) => {
        const response = await fetch(`${APP}${path}`, { redirect: "manual" });
        return { status: response.status, text: response.status === 200 ? await response.text() : "" };
      };
      for (const name of R.DOCUMENT_NAMES) {
        const { title, path } = R.DOCUMENTS[name];
        const page = await get(path);
        // In the page's own source an apostrophe or an ampersand is written differently; the first words are enough.
        const firstWords = title.split(" ").slice(0, 2).join(" ");
        check(`${path} shows the ${title}, says it is a draft, and names its version`, page.status === 200 && page.text.includes(firstWords) && page.text.includes("Draft. Not in force yet.") && page.text.includes('data-legal-version="2026-11-20"'), String(page.status));
      }
      const pinned = await get("/terms?version=2026-11-20");
      const unknown = await get("/terms?version=1999-01-01");
      check("a version can be asked for by its name, and one that does not exist is not found", pinned.status === 200 && unknown.status === 404, `${pinned.status} ${unknown.status}`);
      const rules = await get("/rules");
      check("the footer leads to all seven", ["/rules", "/terms", "/payment-terms", "/privacy", "/host-agreement", "/copyright", "/identity-notice"].every((path) => rules.text.includes(`href="${path}"`)));
      const terms = await get("/terms");
      check("a link from the Terms to the Payment Terms leads to their page", terms.text.includes('href="/payment-terms"'));
    } else {
      console.log("\n(The pages were not asked for: start the app and add --app=http://localhost:3000.)");
    }
  } finally {
    await db.delete(schema.agreementAcceptances).where(inArray(schema.agreementAcceptances.userId, made));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, made));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `agreecheck-${RUN}-%`));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, made));
    await db.delete(schema.user).where(inArray(schema.user.id, made));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
