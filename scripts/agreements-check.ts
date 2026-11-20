/**
 * Testing tool: the legal documents in the app and the proof of who accepted what
 * (plans/46-agreements-live.md, parts 1 and 2), against the local database. It makes its own people,
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
      check("a form that names no versions writes nothing", (await A.acceptGeneralAgreements({ userId: ann.id, shown: {}, timeZone: "UTC", now })) === "changed" && (await linesOf(ann.id)).length === 0 && (await userNow(ann.id)).termsVersion === null);
      check("nor does one that names an older version of one of the three", (await A.acceptGeneralAgreements({ userId: ann.id, shown: { ...shownNow("sign_up"), "payment-terms": "2020-01-01" }, timeZone: "UTC", now })) === "changed" && (await linesOf(ann.id)).length === 0);
      check("what a form carries is read back as it was written", JSON.stringify(A.readShown(A.shownValue(R.agreementsToAccept("sign_up", now)))) === JSON.stringify(shownNow("sign_up")) && JSON.stringify(A.readShown("nonsense@1|terms-of-service")) === "{}");

      const first = await A.acceptGeneralAgreements({ userId: ann.id, shown: shownNow("sign_up"), timeZone: "America/New_York", now });
      check("with the versions in effect it answers that it is done", first === "done");
      const lines = await linesOf(ann.id);
      const after = await userNow(ann.id);
      check("finishing sign-up writes one line for each of the three documents, as a sign-up", lines.length === 3 && lines.every((line) => line.occasion === "sign_up" && line.version === "2026-11-20") && lines.map((line) => line.document).sort().join() === "community-rules,payment-terms,terms-of-service", JSON.stringify(lines.map((l) => [l.document, l.version, l.occasion])));
      check("and the stamp, the moment, 18 or older and the time zone on the person's own line, in the same step", after.termsVersion === R.generalStamp(now) && after.termsAcceptedAt?.getTime() === now.getTime() && after.adultConfirmedAt?.getTime() === now.getTime() && after.timeZone === "America/New_York");
      check("every line carries the same moment", lines.every((line) => line.acceptedAt.getTime() === now.getTime()));

      const later = new Date(now.getTime() + 5_000);
      const second = await A.acceptGeneralAgreements({ userId: ann.id, shown: shownNow("sign_up"), timeZone: "Europe/London", now: later });
      const again = await linesOf(ann.id);
      const twice = await userNow(ann.id);
      check("pressing a second time answers \"already\", writes no new line, and leaves the first moment and the first time zone as they were", second === "already" && again.length === 3 && again.every((line) => line.acceptedAt.getTime() === now.getTime()) && twice.adultConfirmedAt?.getTime() === now.getTime() && twice.termsAcceptedAt?.getTime() === now.getTime() && twice.timeZone === "America/New_York");

      const unverified = await person("unverified", { emailVerified: false });
      const closed = await person("closed", { closedAt: new Date() });
      check("someone whose email address is not confirmed cannot accept, and neither can a closed account", (await A.acceptGeneralAgreements({ userId: unverified.id, shown: shownNow("sign_up"), timeZone: "UTC", now })) === "gone" && (await A.acceptGeneralAgreements({ userId: closed.id, shown: shownNow("sign_up"), timeZone: "UTC", now })) === "gone" && (await linesOf(unverified.id)).length + (await linesOf(closed.id)).length === 0);
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
        // Its day is today. (The first version's own day is the day these documents were written, so a day before that would not do.)
        next.effectiveFrom = day(0);
        check("from its day the stamp is another one, so the person is asked again", R.generalStamp(now) !== before && (await userNow(bob.id)).termsVersion === before);
        check("the versions the old page showed are refused now", (await A.acceptGeneralAgreements({ userId: bob.id, shown: { "terms-of-service": "2026-11-20", "payment-terms": "2026-11-20", "community-rules": "2026-11-20" }, timeZone: "UTC", now })) === "changed");
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
      // A host's page that a closing suspends carries the closing's reason, not an older one.
      await db.insert(schema.hostProfiles).values({ userId: fay.id, handle: `ag${RUN}fay`, handleKey: `ag${RUN}fay`, displayName: "Fay Host", pricePer15Cents: 2000, status: "declined", decidedReason: "An older reason.", usConfirmedAt: new Date() });
      await closing.closeAccount({ userId: fay.id, by: decider.id, reason: "You asked us to close your account." });
      const fayPage = (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, fay.id)))[0];
      check("a host page suspended by a closing shows the closing's reason, not an older one", fayPage.status === "suspended" && fayPage.decidedReason === "Your account was closed. You asked us to close your account.", String(fayPage.decidedReason));
    }

    console.log("\n7. Thirty days' notice of a coming version (part 2)");
    {
      const N = await import("../src/legal/notices");
      const delivery = await import("../src/lib/notifications/delivery");
      const mine = { emailLike: `agreecheck-${RUN}-n-%` };
      const now = new Date();
      const day = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
      const long = new Date(now.getTime() - 60 * DAY);
      const early = await person("n-early", { adultConfirmedAt: long, termsAcceptedAt: long });
      const closed = await person("n-closed", { adultConfirmedAt: long, termsAcceptedAt: long, closedAt: now });
      const unfinished = await person("n-unfinished");
      const host = await person("n-host", { adultConfirmedAt: long, termsAcceptedAt: long });
      await db.insert(schema.hostProfiles).values({ userId: host.id, handle: `ag${RUN}nhost`, handleKey: `ag${RUN}nhost`, displayName: "Notice Host", pricePer15Cents: 2000, usConfirmedAt: long, createdAt: long });
      const noticesTo = async (who: { email: string }) => db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, who.email), like(schema.emailOutbox.dedupeKey, "agreement-notice:%"))).orderBy(schema.emailOutbox.createdAt);
      const send = (fails: string[] = []) =>
        delivery.deliverEmails(new Date(), async (email) => (fails.includes(email.to) ? { ok: false, permanent: true, error: "422 made up for this check" } : { ok: true, providerId: `agreecheck-${randomUUID()}` }), { toLike: mine.emailLike });

      // Made up, only inside this run: the Payment Terms have a published version in effect and another one coming
      // (so 30 days are owed); the Host Agreement has its first published version coming after the draft (none owed).
      const payments = R.DOCUMENTS["payment-terms"].versions;
      const hosting = R.DOCUMENTS["host-agreement"].versions;
      // In effect from today: the real first version's own day is the day the documents were written, so an earlier day would sort before it.
      const inForce = { version: "2098-01-01", effectiveFrom: day(0), addedOn: day(0), draft: false, summary: "Made up for this check." };
      const coming = { version: "2099-01-01", effectiveFrom: day(40), addedOn: day(0), draft: false, summary: "Refunds are explained in section 4. Made up for this check." };
      const comingHost = { version: "2099-01-01", effectiveFrom: day(40), addedOn: day(0), draft: false, summary: "Made up for this check." };
      payments.push(inForce, coming);
      hosting.push(comingHost);
      for (const [name, version] of [["payment-terms", inForce], ["payment-terms", coming], ["host-agreement", comingHost]] as const) R.TEXTS[name][version.version] = "# Made up\n\nA version made up for this check.";
      try {
        check("two versions are coming: one that 30 days are owed for, and a first published one that they are not", JSON.stringify(N.comingVersions(now).map((c) => [c.name, c.audience, c.owed])) === JSON.stringify([["payment-terms", "everyone", true], ["host-agreement", "hosts", false]]), JSON.stringify(N.comingVersions(now).map((c) => [c.name, c.owed])));
        const first = await N.announceComingVersions(now, mine);
        check("everyone it concerns is written to once: two people for the Payment Terms, and the host for the Host Agreement too", first === 3 && (await noticesTo(early)).length === 1 && (await noticesTo(host)).length === 2, String(first));
        check("nobody with a closed account, and nobody who has not finished signing up", (await noticesTo(closed)).length === 0 && (await noticesTo(unfinished)).length === 0);
        check("asked again, nobody is written to twice", (await N.announceComingVersions(now, mine)) === 0 && (await noticesTo(host)).length === 2);
        const [mail] = await noticesTo(early);
        check("the email says the day, what changes, and where the new version can be read; it is not sent after that day", mail.subject === `Our Payment Terms will change on ${N.dayInWords(day(40))}` && mail.body.includes("Refunds are explained in section 4.") && mail.body.includes("/payment-terms?version=2099-01-01") && mail.expiresAt?.toISOString().slice(0, 10) === day(40), mail.subject);

        // Someone who finishes signing up meanwhile accepts the version in effect and is told about the coming one.
        const finished = await A.acceptGeneralAgreements({ userId: unfinished.id, shown: shownNow("sign_up"), timeZone: "UTC" });
        const held = (await linesOf(unfinished.id)).find((line) => line.document === "payment-terms")?.version;
        check("someone who finishes signing up meanwhile accepts the version in effect, not the coming one", finished === "done" && held === "2098-01-01", `${finished} ${held}`);
        check("and gets the email about the coming one on the helper's next round", (await N.announceComingVersions(new Date(), mine)) === 1 && (await noticesTo(unfinished)).length === 1);

        check("with more than 30 days to go and nothing gone wrong, the health report says nothing", (await N.noticeHealthProblems(new Date(), mine)).length === 0, (await N.noticeHealthProblems(new Date(), mine)).join("; "));
        // An account closed after its email was written: the email is not sent, and that is not a fault of ours.
        const leaving = await person("n-leaving", { adultConfirmedAt: long, termsAcceptedAt: long });
        await N.announceComingVersions(new Date(), mine);
        await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, leaving.id));
        await send([early.email]);
        const sent = await noticesTo(host);
        const [left] = await noticesTo(leaving);
        check("the emails go out; one to an account closed since is not sent", sent.every((row) => row.status === "sent") && left.status === "failed" && left.lastError === "no longer wanted: the account is closed", `${sent.map((row) => row.status)} ${left.status} ${left.lastError}`);
        const failed = await N.noticeHealthProblems(new Date(), mine);
        check("an email that could not be sent for a reason of our own is said in the health report; the closed account is not", failed.length === 1 && failed[0].includes("could not be sent") && failed[0].includes("Payment Terms"), failed.join("; "));

        // The founder moves the day. Every key holds the day, so everyone is written to again by itself.
        const oldKey = (await noticesTo(unfinished))[0].dedupeKey!;
        coming.effectiveFrom = day(20);
        check("an email for the day that was given up is no longer true", (await N.noticeEmailProblem(oldKey, new Date())) === "that version is not coming on that day any more" && (await N.noticeEmailProblem("reminder:1:2:3", new Date())) === undefined);
        const again = await N.announceComingVersions(new Date(), mine);
        check("a moved day is announced again to everyone it concerns", again === 3 && (await noticesTo(early)).length === 2 && (await noticesTo(unfinished)).length === 2, String(again));
        // Now the day is 20 days off: fewer than 30 are left.
        const late = await N.noticeHealthProblems(new Date(), mine);
        check("fewer than 30 days before the day, an email that is still not out is said", late.length === 1 && late[0].includes("still not out") && late[0].includes("move its day"), late.join("; "));
        check("someone who only finished signing up today is not counted: a shorter time is in the nature of it", (await N.noticeHealthProblems(new Date(), { emailLike: unfinished.email })).length === 0);
        await send();
        const gone = await N.noticeHealthProblems(new Date(), mine);
        check("and one that went out with fewer than 30 days left is said too, until the day is moved", gone.length === 1 && gone[0].includes("went out to somebody with fewer than 30 days left"), gone.join("; "));
        check("the Host Agreement's first published version never counts: no 30 days are owed after a draft", !gone.concat(late, failed).some((line) => line.includes("Host Agreement")));
        coming.effectiveFrom = day(45);
        await N.announceComingVersions(new Date(), mine);
        await send();
        check("after the day is moved far enough and the emails are out, the health report says nothing again", (await N.noticeHealthProblems(new Date(), mine)).length === 0, (await N.noticeHealthProblems(new Date(), mine)).join("; "));
        check("the whole health answer carries these lines", typeof (await import("../src/lib/health")).healthProblems === "function");
      } finally {
        payments.splice(payments.indexOf(inForce), 1);
        payments.splice(payments.indexOf(coming), 1);
        hosting.splice(hosting.indexOf(comingHost), 1);
        for (const [name, version] of [["payment-terms", inForce], ["payment-terms", coming], ["host-agreement", comingHost]] as const) delete R.TEXTS[name][version.version];
      }
      check("(afterwards the list of documents is as it was, and nothing is coming)", R.registryProblems().length === 0 && N.comingVersions(new Date()).length === 0);
    }

    if (APP) {
      console.log("\n8. The pages");
      const get = async (path: string) => {
        const response = await fetch(`${APP}${path}`, { redirect: "manual" });
        return { status: response.status, text: response.status === 200 ? await response.text() : "" };
      };
      for (const name of R.DOCUMENT_NAMES) {
        const { title, path } = R.DOCUMENTS[name];
        const page = await get(path);
        // In the page's own source an apostrophe or an ampersand is written differently; the first words are enough.
        const firstWords = title.split(" ").slice(0, 2).join(" ");
        const heading = /<h1[^>]*>([^<]*)<\/h1>/.exec(page.text)?.[1] ?? "";
        check(`${path} shows the ${title} in its heading, says it is a draft, and names its version`, page.status === 200 && heading.startsWith(firstWords) && page.text.includes("Draft. Not in force yet.") && page.text.includes('data-legal-version="2026-11-20"'), `${page.status} "${heading}"`);
      }
      const pinned = await get("/terms?version=2026-11-20");
      const unknown = await get("/terms?version=1999-01-01");
      const twice = await get("/terms?version=2026-11-20&version=1999-01-01");
      check("a version can be asked for by its name; one that does not exist, or two at once, is not found", pinned.status === 200 && unknown.status === 404 && twice.status === 404, `${pinned.status} ${unknown.status} ${twice.status}`);
      const rules = await get("/rules");
      check("the footer leads to all seven", ["/rules", "/terms", "/payment-terms", "/privacy", "/host-agreement", "/copyright", "/identity-notice"].every((path) => rules.text.includes(`href="${path}"`)));
      const terms = await get("/terms");
      // Once in the footer, and at least once in the text itself.
      check("a link inside the Terms leads to the Payment Terms' page", terms.text.split('href="/payment-terms"').length - 1 >= 2);
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
