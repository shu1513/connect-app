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
      const done = { adultConfirmedAt: long, termsAcceptedAt: long };
      const early = await person("n-early", done);
      const closed = await person("n-closed", { ...done, closedAt: now });
      const unfinished = await person("n-unfinished");
      const applicant = await person("n-applicant", done);
      const host = await person("n-host", done);
      const founder = await person("n-founder");
      await db.insert(schema.hostProfiles).values({ userId: host.id, handle: `ag${RUN}nhost`, handleKey: `ag${RUN}nhost`, displayName: "Notice Host", pricePer15Cents: 2000, usConfirmedAt: long, createdAt: long });
      const noticesTo = async (who: { email: string }) => db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, who.email), like(schema.emailOutbox.dedupeKey, "agreement-notice:%"))).orderBy(schema.emailOutbox.createdAt, schema.emailOutbox.dedupeKey);
      const asked: string[] = [];
      /** Sends what is waiting for this run's people, with a stand-in for the sending service that refuses some addresses and notes every email it is handed. */
      const send = async (refuse: string[] = []) => {
        asked.length = 0;
        for (let round = 0; round < 5; round++) {
          const sent = await delivery.deliverEmails(new Date(), async (email) => (asked.push(`${email.to} ${email.subject}`), refuse.includes(email.to) ? { ok: false, permanent: true, error: "422 made up for this check" } : { ok: true, providerId: `agreecheck-${randomUUID()}` }), { toLike: mine.emailLike });
          if (sent === 0 && round > 0) break;
        }
      };
      const lines = async (people = mine) => (await N.noticeProblems(new Date(), people)).map((problem) => `${problem.kind} ${problem.coming.name} ${problem.coming.version.version}`).sort();

      // Made up, only inside this run. The Payment Terms: a published version in effect, and two more coming, one
      // behind the other (30 days are owed for each). The Host Agreement: its first published version coming after
      // the draft (none owed).
      const payments = R.DOCUMENTS["payment-terms"].versions;
      const hosting = R.DOCUMENTS["host-agreement"].versions;
      // In effect from today: the real first version's own day is the day the documents were written, so an earlier day would sort before it.
      const inForce = { version: "2098-01-01", effectiveFrom: day(0), addedOn: day(0), draft: false, summary: "Made up for this check." };
      const coming = { version: "2099-01-01", effectiveFrom: day(40), addedOn: day(0), draft: false, summary: "Refunds are explained in section 4. Made up for this check." };
      const later = { version: "2099-02-01", effectiveFrom: day(80), addedOn: day(0), draft: false, summary: "Made up for this check, the second change." };
      const comingHost = { version: "2099-01-01", effectiveFrom: day(40), addedOn: day(0), draft: false, summary: "Made up for this check." };
      payments.push(inForce, coming, later);
      hosting.push(comingHost);
      const madeUp = [["payment-terms", inForce], ["payment-terms", coming], ["payment-terms", later], ["host-agreement", comingHost]] as const;
      for (const [name, version] of madeUp) R.TEXTS[name][version.version] = "# Made up\n\nA version made up for this check.";
      try {
        check("every coming version is found, also the second change behind the first; 30 days are owed for those, and not for a first published version", JSON.stringify(N.comingVersions(now).map((c) => [c.name, c.version.version, c.owed])) === JSON.stringify([["payment-terms", "2099-01-01", true], ["payment-terms", "2099-02-01", true], ["host-agreement", "2099-01-01", false]]), JSON.stringify(N.comingVersions(now).map((c) => [c.name, c.version.version, c.owed])));

        // The helper's rounds, one person a round for each version, to see that a backlog drains.
        const rounds: number[] = [];
        for (let i = 0; i < 10; i++) {
          const written = await N.announceComingVersions(now, mine, 1);
          if (written === 0) break;
          rounds.push(written);
        }
        check("the helper writes to everyone concerned, over several rounds: three people twice for the Payment Terms, and the host for the Host Agreement", rounds.reduce((sum, n) => sum + n, 0) === 7 && rounds.length === 3 && (await noticesTo(early)).length === 2 && (await noticesTo(host)).length === 3 && (await noticesTo(applicant)).length === 2, rounds.join("+"));
        check("nobody with a closed account, and nobody who has not finished signing up", (await noticesTo(closed)).length === 0 && (await noticesTo(unfinished)).length === 0);
        check("asked again, nobody is written to twice", (await N.announceComingVersions(now, mine)) === 0 && (await noticesTo(host)).length === 3);
        const mail = (await noticesTo(early)).find((row) => row.dedupeKey === `agreement-notice:payment-terms:2099-01-01:${day(40)}:${early.id}`);
        check("the email says the day, what changes, and where both versions can be read, each by its own name", Boolean(mail) && mail!.subject === `Our Payment Terms will change on ${N.dayInWords(day(40))}` && mail!.body.includes("Refunds are explained in section 4.") && mail!.body.includes("/payment-terms?version=2099-01-01") && mail!.body.includes("/payment-terms?version=2098-01-01"), mail?.subject);
        check("its time runs out at the start of that day in UTC, to the second", mail?.expiresAt?.toISOString() === `${day(40)}T00:00:00.000Z`, mail?.expiresAt?.toISOString());

        // Someone who finishes signing up meanwhile: written to in that same step, with no helper round in between.
        const finished = await A.acceptGeneralAgreements({ userId: unfinished.id, shown: shownNow("sign_up"), timeZone: "UTC" });
        const held = (await linesOf(unfinished.id)).find((line) => line.document === "payment-terms")?.version;
        check("someone who finishes signing up meanwhile accepts the version in effect, not a coming one", finished === "done" && held === "2098-01-01", `${finished} ${held}`);
        check("and is written to about both coming versions in that same step", (await noticesTo(unfinished)).length === 2);
        // The same for someone who applies to host.
        await P.createHostProfile(applicant.id, { handle: `ag${RUN}napp`, displayName: "Notice Applicant", about: "", pricePer15Cents: 2000, country: "US", languages: ["en"], sellerKind: "private", agreements: A.hostAgreementShown(new Date()) });
        check("someone who applies to host meanwhile is written to about the coming Host Agreement in that same step", (await noticesTo(applicant)).filter((row) => row.dedupeKey?.startsWith("agreement-notice:host-agreement:")).length === 1);
        check("with more than 30 days to go and nothing gone wrong, nothing is said", (await lines()).length === 0, (await lines()).join("; "));

        // An account closed after its email was written: the email is not sent, and that alone is not a fault of ours.
        const leaving = await person("n-leaving", done);
        await N.announceComingVersions(new Date(), mine);
        await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, leaving.id));
        // An email whose time ran out a moment ago (as at the midnight its day begins) is not handed to the sending service.
        const latecomer = await person("n-latecomer", done);
        await N.announceComingVersions(new Date(), mine);
        await db.update(schema.emailOutbox).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.emailOutbox.to, latecomer.email));
        await send();
        const left = await noticesTo(leaving);
        const lateRows = await noticesTo(latecomer);
        check("the emails go out; the ones to an account closed since do not, and that is not said as a problem", (await noticesTo(host)).every((row) => row.status === "sent") && left.length === 2 && left.every((row) => row.status === "failed" && row.lastError === "no longer wanted: the account is closed") && !asked.some((line) => line.startsWith(leaving.email)), `${left.map((row) => row.lastError)}`);
        check("an email whose time has run out is never handed to the sending service", lateRows.length === 2 && lateRows.every((row) => row.status === "failed" && row.lastError === "expired before it could be sent") && !asked.some((line) => line.startsWith(latecomer.email)), `${lateRows.map((row) => `${row.status} ${row.lastError}`)}`);
        await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, latecomer.id));
        check("so far nothing is said: everyone open was written to in time", (await lines()).length === 0, (await lines()).join("; "));

        // The sending service refuses two people's emails outright.
        const refusedOne = await person("n-refused", done);
        const refusedHost = await person("n-refused-host", done);
        await db.insert(schema.hostProfiles).values({ userId: refusedHost.id, handle: `ag${RUN}nref`, handleKey: `ag${RUN}nref`, displayName: "Refused Host", pricePer15Cents: 2000, usConfirmedAt: long, createdAt: long });
        await N.announceComingVersions(new Date(), mine);
        await send([refusedOne.email, refusedHost.email]);
        check("an email the sending service refused is said, for each version the 30 days are owed for; the Host Agreement's, for which none are owed, is not", JSON.stringify(await lines()) === JSON.stringify(["failed payment-terms 2099-01-01", "failed payment-terms 2099-02-01"]), (await lines()).join("; "));
        const report = await N.noticeReport(new Date(), mine);
        const row = (name: string, version: string) => report.find((one) => one.name === name && one.version === version);
        // Three for us to look at: the two refused ones, and the one whose time ran out before it was sent. One not ours: the closed account.
        check("the founder's page counts them: for the Payment Terms, and for the Host Agreement too", row("payment-terms", "2099-01-01")?.failedOurs === 3 && row("payment-terms", "2099-01-01")?.notOurs === 1 && row("host-agreement", "2099-01-01")?.failedOurs === 1 && row("host-agreement", "2099-01-01")?.owed === false && row("payment-terms", "2099-01-01")?.sentInTime === 4, JSON.stringify(row("payment-terms", "2099-01-01")));
        const told = await N.tellFounderAboutNotices(new Date(), mine, [founder]);
        const founderMail = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, founder.email));
        check("the founder is written to once for each problem, and not again on the next round", told === 2 && founderMail.length === 2 && founderMail.every((one) => one.body.includes("could not be sent") && one.body.includes("/admin/outbox")) && (await N.tellFounderAboutNotices(new Date(), mine, [founder])) === 0, String(told));
        const back = await N.sendRefusedNoticesAgain(new Date(), mine);
        check("the founder's button puts exactly the refused ones back in the queue, and not the ones given up for another reason", back === 5 && (await noticesTo(leaving)).every((one) => one.status === "failed") && (await noticesTo(latecomer)).every((one) => one.status === "failed"), String(back));
        await send();
        check("sent again, they go out, and nothing is said any more", (await noticesTo(refusedHost)).every((one) => one.status === "sent") && (await noticesTo(refusedOne)).every((one) => one.status === "sent") && (await lines()).length === 0, (await lines()).join("; "));

        // A helper still running older code gives a good email up as "not coming on that day". The next round takes it up again.
        const [given] = await noticesTo(early);
        await db.update(schema.emailOutbox).set({ status: "failed", lastError: `no longer wanted: ${N.NOT_COMING}` }).where(eq(schema.emailOutbox.id, given.id));
        const tookUp = await N.announceComingVersions(new Date(), mine);
        check("an email wrongly given up while its version is still coming on that day is taken up again", tookUp === 1 && (await noticesTo(early)).find((one) => one.id === given.id)?.status === "queued", String(tookUp));
        await send();

        // The founder moves the day. Every key holds the day, so everyone is written to again by itself.
        const oldKey = (await noticesTo(unfinished)).find((one) => one.dedupeKey?.includes(":2099-01-01:"))!.dedupeKey!;
        coming.effectiveFrom = day(20);
        check("an email for the day that was given up is no longer true", (await N.noticeEmailProblem(oldKey, new Date())) === N.NOT_COMING && (await N.noticeEmailProblem("reminder:1:2:3", new Date())) === undefined);
        // Two helpers at the same moment.
        const [one, two] = await Promise.all([N.announceComingVersions(new Date(), mine), N.announceComingVersions(new Date(), mine)]);
        const replacements = await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `agreement-notice:payment-terms:2099-01-01:${day(20)}:ag-${RUN}-n-%`));
        check("a moved day is announced again to everyone it concerns, once each, also when two helpers run at the same moment", one + two === 6 && replacements.length === 6 && replacements.every((mail) => mail.status === "queued"), `${one}+${two} ${replacements.length}`);
        // Now the day is 20 days off: fewer than 30 are left.
        check("fewer than 30 days before the day, an email that is still not out is said", JSON.stringify(await lines()) === JSON.stringify(["not_out payment-terms 2099-01-01"]), (await lines()).join("; "));
        check("someone who only finished signing up today is not counted: a shorter time is in the nature of it", (await lines({ emailLike: unfinished.email })).length === 0);
        await send();
        check("and one that went out with fewer than 30 days left is said too, until the day is moved", replacements.length === 6 && (await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `agreement-notice:payment-terms:2099-01-01:${day(20)}:ag-${RUN}-n-%`))).every((mail) => mail.status === "sent") && JSON.stringify(await lines()) === JSON.stringify(["late payment-terms 2099-01-01"]), (await lines()).join("; "));
        // Moved back to a day that was announced before: those emails went out earlier, and people were last told another day.
        coming.effectiveFrom = day(40);
        check("a day moved back to one announced before is said: people were last told another day", (await N.announceComingVersions(new Date(), mine)) === 0 && JSON.stringify(await lines()) === JSON.stringify(["other_day payment-terms 2099-01-01"]), (await lines()).join("; "));
        coming.effectiveFrom = day(45);
        await N.announceComingVersions(new Date(), mine);
        await send();
        check("after the day is moved to a new one, far enough off, and the emails are out, nothing is said again", (await lines()).length === 0, (await lines()).join("; "));
        check("the health address, which watches money, says nothing about notices", !(await (await import("../src/lib/health")).healthProblems(new Date())).some((line) => line.includes("notice")));
      } finally {
        for (const version of [inForce, coming, later]) payments.splice(payments.indexOf(version), 1);
        hosting.splice(hosting.indexOf(comingHost), 1);
        for (const [name, version] of madeUp) delete R.TEXTS[name][version.version];
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
