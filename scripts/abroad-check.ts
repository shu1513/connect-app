/**
 * Testing tool: hosts outside the United States (plans/27-hosts-abroad.md), against Stripe's test
 * mode and this computer's test database. No real money moves.
 *
 * It only ever acts on its own records. It makes its own people (their ids start "ab-"), never
 * touches the test host host@test.local or its payout account, and never runs the always-on
 * helper's jobs, which act on every call and payment in the database: its calls are settled by the
 * function that settles one call, its contribution's money is taken by the function that takes one
 * payment, and its collections are its own hosts'.
 *
 * What is real and what is pretended:
 *   real       applying as a host (the app's own function); opening a payout account for the
 *              host's country (the app's own function, at Stripe); the hold and the charge of a
 *              call; a contribution's hold and taking; "Collect earnings" (the app's own function)
 *              and the transfer it makes at Stripe.
 *   pretended  the founder's approval; that the two were in the call; the waiting (a later clock
 *              is handed to the functions); and, for the collections, the host's payout account:
 *              the account that payout setup opens cannot be activated by a script, since Stripe
 *              collects its details on its own form, so the collecting hosts get an account made
 *              here with the same two abilities and the same responsibilities, filled in with
 *              Stripe's own test values. The setup's own account is completed by hand, once, in
 *              the browser check.
 *
 * At the end it removes everything it made, here and at Stripe (also what an earlier run that was
 * stopped left behind). A test account at Stripe that could not be removed is a failed check.
 *
 * Usage: npx tsx scripts/abroad-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${!ok && detail !== "" ? `  (${(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 500)})` : ""}`);
  if (!ok) failures++;
}

/** Stripe's own test values for an activated account of a person in each country the collections are tried in. */
const TEST_HOSTS: Record<string, { currency: string; account_number: string; routing_number?: string; city: string; postal_code: string; state?: string; phone: string; extra?: Record<string, string> }> = {
  US: { currency: "usd", account_number: "000123456789", routing_number: "110000000", city: "San Francisco", postal_code: "94103", state: "CA", phone: "+14155550123", extra: { ssn_last_4: "0000", id_number: "000000000" } },
  GB: { currency: "gbp", account_number: "00012345", routing_number: "108800", city: "London", postal_code: "SW1A 1AA", phone: "+442071234567" },
  DE: { currency: "eur", account_number: "DE89370400440532013000", city: "Berlin", postal_code: "10115", phone: "+4930123456" },
  CH: { currency: "chf", account_number: "CH9300762011623852957", city: "Zurich", postal_code: "8001", phone: "+41446681800" },
  CA: { currency: "cad", account_number: "000123456789", routing_number: "11000-000", city: "Toronto", postal_code: "M5V 2T6", state: "ON", phone: "+14165550123" },
};

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
  const { settleOrdinaryCharges } = await import("../src/lib/payments/take");
  const { collectEarnings } = await import("../src/lib/payments/collect");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { ensurePayoutAccount, refreshPayoutsReady, getHostSettings, PayoutSetupError } = await import("../src/lib/payments/hosts");
  const { payoutAccountRequest } = await import("../src/lib/payments/host-account");
  const { createHostProfile, ProfileError } = await import("../src/lib/profiles/profiles");
  const { HOST_COUNTRIES } = await import("../src/lib/profiles/countries");
  const { startProject, runningProjectOf } = await import("../src/lib/projects/projects");
  const { projectsOnFor } = await import("../src/lib/safety/switches");
  const C = await import("../src/lib/contributions/charge");
  const pays = schema.contributionPayments;

  const MIN = 60_000;
  const RUN = randomUUID().slice(0, 8);
  const RETURN = "https://example.com/return";
  type Person = { id: string; name: string; email: string };
  let made = 0;
  /** Every test account this run opened at Stripe, noted the moment its id is known. */
  const atStripe = new Set<string>();

  async function person(kind: string): Promise<Person> {
    const id = `ab-${RUN}-${++made}-${kind}`;
    const stamp = new Date();
    const row = { id, name: `Abroad check ${kind} ${made}`, email: `abroadcheck-${RUN}-${made}@example.test` };
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
    return row;
  }
  /** Applies as a host through the app's own function. Pretended: the founder's approval. */
  async function applyFrom(who: Person, country: string): Promise<void> {
    await createHostProfile(who.id, { handle: `ab${RUN}${made}`, displayName: `Host ${made}`, about: "", pricePer15Cents: 2000, country });
    await db.update(schema.hostProfiles).set({ status: "approved" }).where(eq(schema.hostProfiles.userId, who.id));
  }
  const refusal = async (work: Promise<unknown>): Promise<string | null> => {
    try {
      await work;
      return null;
    } catch (error) {
      if (error instanceof PayoutSetupError || error instanceof ProfileError || error instanceof MoneyError) return error.message;
      throw error;
    }
  };
  /** What Stripe says about an account: its country and what it was asked to be able to do. */
  const seenAtStripe = async (accountId: string) => {
    const account = (await stripe().v2.core.accounts.retrieve(accountId, { include: ["identity", "configuration.recipient", "configuration.merchant"] } as never)) as unknown as {
      applied_configurations?: string[];
      identity?: { country?: string } | null;
    };
    return { country: account.identity?.country?.toUpperCase() ?? null, configurations: [...(account.applied_configurations ?? [])].sort().join(",") };
  };
  const linkOf = async (who: Person) => (await getHostSettings(who.id)).stripeAccountId;
  /** Removes a test account at Stripe. One that cannot be removed is a failed check, with its id. */
  async function removeAtStripe(accountId: string) {
    await stripe()
      .accounts.del(accountId)
      .then(
        () => atStripe.delete(accountId),
        (error: unknown) => {
          // Already gone is fine.
          if ((error as { code?: string }).code === "resource_missing" || /does not exist|No such account/i.test(String((error as Error).message))) atStripe.delete(accountId);
          else check(`clean-up: the test account ${accountId} at Stripe could be removed`, false, String((error as Error).message));
        },
      );
  }

  /**
   * An account Stripe has activated, for a host in that country: the same two abilities (transfers and, abroad, card
   * payments) and the same responsibilities (we pay the fees and carry the losses) as the account payout setup opens,
   * with Stripe's test values in place of what the host would type on Stripe's form. Written beside the host as
   * payout setup would write it.
   */
  async function activatedAccount(host: Person, country: string): Promise<string> {
    const test = TEST_HOSTS[country];
    const account = await stripe().accounts.create({
      country,
      email: host.email,
      controller: { stripe_dashboard: { type: "none" }, fees: { payer: "application" }, losses: { payments: "application" }, requirement_collection: "application" },
      capabilities: { transfers: { requested: true }, ...(country === "US" ? {} : { card_payments: { requested: true } }) },
      business_type: "individual",
      business_profile: { mcc: "8999", url: "https://accessible.stripe.com", product_description: "Private one-to-one video calls with fans, booked and paid for on Connect." },
      individual: {
        first_name: "Jenny",
        last_name: "Rosen",
        dob: { day: 1, month: 1, year: 1901 },
        email: host.email,
        phone: test.phone,
        address: { line1: "address_full_match", city: test.city, postal_code: test.postal_code, country, ...(test.state ? { state: test.state } : {}) },
        ...(test.extra ?? {}),
      },
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "8.8.8.8" },
      external_account: { object: "bank_account", country, currency: test.currency, account_number: test.account_number, ...(test.routing_number ? { routing_number: test.routing_number } : {}) } as never,
    });
    atStripe.add(account.id);
    for (let i = 0; i < 20; i++) {
      if ((await stripe().accounts.retrieve(account.id)).capabilities?.transfers === "active") break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await db.insert(schema.hostSettings).values({ userId: host.id }).onConflictDoNothing();
    await db.update(schema.hostSettings).set({ stripeAccountId: account.id }).where(eq(schema.hostSettings.userId, host.id));
    return account.id;
  }

  /** A paid call of ten minutes with this host: held on a test card, both there the whole time, charged at its moment. Only this call is settled. */
  async function chargedCall(host: Person, customer: Person) {
    const startsAt = new Date(Math.ceil((Date.now() + 10 * MIN) / 1000) * 1000);
    const { call, payment } = await db.transaction(async (tx) => {
      const [newCall] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt: new Date(startsAt.getTime() + 10 * MIN), roomName: `abroadcheck-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
      await createPaymentForCall(tx, newCall);
      const [own] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, newCall.id));
      return { call: newCall, payment: own };
    });
    await startHold({ payment, call, customer, now: new Date() });
    const [withIntent] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
    await syncHold(payment.id, new Date());
    for (const who of [host.id, customer.id]) {
      const event = (type: string, seconds: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_abroadcheck", participantIdentity: who, participantSessionId: `PA_${who.slice(-6)}_${call.id.slice(0, 6)}`, providerTime: new Date(startsAt.getTime() + seconds * 1000), payload: "{}" });
      await db.insert(schema.attendanceEvents).values([event("participant_joined", 0), event("participant_left", 600)]);
    }
    await db.update(schema.calls).set({ closedAt: new Date(startsAt.getTime() + 11 * MIN) }).where(eq(schema.calls.id, call.id));
    await settleOrdinaryCharges(call.id, new Date(startsAt.getTime() + (24 * 60 + 3) * MIN));
    return (await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)))[0];
  }
  /** A contribution of $25.00 made once to this host's project: held on a test card, and taken at its own moment. Only this payment is acted on. */
  async function takenContribution(host: Person, giver: Person) {
    if (!(await runningProjectOf(host.id))) await startProject({ hostId: host.id, name: `A film about the sea ${RUN}`, description: "", now: new Date() });
    const project = (await runningProjectOf(host.id))!;
    const paymentId = await db.transaction(async (tx) => {
      const [contribution] = await tx.insert(schema.contributions).values({ projectId: project.id, hostId: host.id, contributorId: giver.id, kind: "once", amountCents: 2500, requestKey: randomUUID() }).returning();
      return (await C.writeDownPayment(tx, contribution, { number: 1, originKey: `first:${contribution.id}`, cardStepExpiresAt: new Date(Date.now() + 30 * MIN) }, new Date())).id;
    });
    const intent = await C.intentFor(paymentId);
    await stripe().paymentIntents.confirm(intent!.intentId, { payment_method: "pm_card_visa", return_url: RETURN });
    const held = await C.syncPayment(paymentId, new Date());
    await C.takePayment(paymentId, held.takeAt!);
    const [share] = await db.select().from(schema.payments).where(eq(schema.payments.contributionPaymentId, paymentId));
    return share;
  }
  const reload = async (paymentId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)))[0];
  const ledger = async (paymentId: string, kind: string) =>
    (await db.select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amountCents}), 0)::int` }).from(schema.ledgerEntries).where(sql`${schema.ledgerEntries.paymentId} = ${paymentId} and ${schema.ledgerEntries.kind} = ${kind}`))[0].total;
  /** What Stripe has for a share that was sent: the transfer on our side, and its line on the host's side. */
  async function sentAtStripe(share: { stripeTransferId: string | null }, accountId: string) {
    const transfer = await stripe().transfers.retrieve(share.stripeTransferId!);
    const arrived = await stripe().charges.retrieve(typeof transfer.destination_payment === "string" ? transfer.destination_payment : transfer.destination_payment!.id, { expand: ["balance_transaction"] }, { stripeAccount: accountId });
    const line = arrived.balance_transaction as { amount: number; currency: string } | null;
    return { transfer, arrivedAmount: line?.amount ?? 0, arrivedCurrency: line?.currency ?? null };
  }

  // --------------------------------------------------------------------------
  // Cleaning up: only this script's own people (ids starting "ab-"), and their accounts at Stripe
  // --------------------------------------------------------------------------
  async function wipe() {
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, "ab-%"))).map((row) => row.id);
    if (ids.length === 0) {
      await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "abroadcheck-%"));
      return;
    }
    // Accounts at Stripe that are written beside these people (also those of an earlier run that was stopped).
    for (const row of await db.select({ id: schema.hostSettings.stripeAccountId }).from(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids))) if (row.id) atStripe.add(row.id);
    for (const id of [...atStripe]) await removeAtStripe(id);
    const contributionIds = (await db.select({ id: schema.contributions.id }).from(schema.contributions).where(or(inArray(schema.contributions.hostId, ids), inArray(schema.contributions.contributorId, ids)))).map((row) => row.id);
    const cpIds = contributionIds.length > 0 ? (await db.select({ id: pays.id }).from(pays).where(inArray(pays.contributionId, contributionIds))).map((row) => row.id) : [];
    const calls = (await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)))).map((row) => row.id);
    const shares = [
      ...(cpIds.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.contributionPaymentId, cpIds)) : []),
      ...(calls.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.callId, calls)) : []),
    ].map((row) => row.id);
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    const steps: Array<() => Promise<unknown>> = [
      () => db.delete(schema.collectionItems).where(inArray(schema.collectionItems.collectionId, db.select({ id: schema.collections.id }).from(schema.collections).where(inArray(schema.collections.hostId, ids)))),
      () => db.delete(schema.collections).where(inArray(schema.collections.hostId, ids)),
      async () => shares.length > 0 && (await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, shares))),
      async () => shares.length > 0 && (await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, shares))),
      async () => shares.length > 0 && (await db.delete(schema.payments).where(inArray(schema.payments.id, shares))),
      async () => cpIds.length > 0 && (await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.contributionPaymentId, cpIds))),
      async () => cpIds.length > 0 && (await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.contributionPaymentId, cpIds))),
      async () => cpIds.length > 0 && (await db.delete(pays).where(inArray(pays.id, cpIds))),
      async () => contributionIds.length > 0 && (await db.delete(schema.contributionCards).where(inArray(schema.contributionCards.contributionId, contributionIds))),
      async () => contributionIds.length > 0 && (await db.delete(schema.contributionAgreements).where(inArray(schema.contributionAgreements.contributionId, contributionIds))),
      async () => contributionIds.length > 0 && (await db.delete(schema.contributions).where(inArray(schema.contributions.id, contributionIds))),
      async () => calls.length > 0 && (await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, calls))),
      async () => calls.length > 0 && (await db.delete(schema.calls).where(inArray(schema.calls.id, calls))),
      async () => projectIds.length > 0 && (await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds))),
      () => db.delete(schema.projects).where(inArray(schema.projects.hostId, ids)),
      () => db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids)),
      () => db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids)),
      () => db.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids)),
      () => db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "abroadcheck-%")),
      () => db.delete(schema.user).where(inArray(schema.user.id, ids)),
    ];
    for (const step of steps) await step().catch((error) => check("clean-up: each step could remove what it is for", false, error instanceof Error ? error.message.split("\n")[0] : String(error)));
  }

  await wipe();
  try {
    // ------------------------------------------------------------------------
    console.log("\n1. A payout account can be opened for a host in every country of the list");
    console.log("   (This shows that Stripe opens the account there. That money can be sent there is shown in part 3, for four of them.)");
    const wrong: string[] = [];
    let usConfigurations = "";
    let gbConfigurations = "";
    for (const { code } of HOST_COUNTRIES) {
      const host = await person(`host-${code.toLowerCase()}`);
      await applyFrom(host, code);
      try {
        const accountId = await ensurePayoutAccount(host);
        atStripe.add(accountId);
        const seen = await seenAtStripe(accountId);
        if (seen.country !== code || (await linkOf(host)) !== accountId) wrong.push(`${code}: Stripe says ${seen.country}`);
        if (code === "US") usConfigurations = seen.configurations;
        if (code === "GB") {
          gbConfigurations = seen.configurations;
          check("pressing \"Set up payouts\" again opens no second account", (await ensurePayoutAccount(host)) === accountId);
        }
        await removeAtStripe(accountId);
      } catch (error) {
        wrong.push(`${code}: ${String((error as Error).message).slice(0, 160)}`);
      }
    }
    check(`all ${HOST_COUNTRIES.length} countries: Stripe opens the account, in that country, and it is written beside its host`, wrong.length === 0, wrong);
    check("a host in the United States still gets an account that only receives transfers, as before", usConfigurations === "recipient", usConfigurations);
    check("a host abroad gets one that also asks for card payments, which Stripe demands of it", gbConfigurations === "merchant,recipient", gbConfigurations);

    // ------------------------------------------------------------------------
    console.log("\n2. A payout account is never linked, set up or paid in another country than the host's profile");
    const noProfile = await person("no-profile");
    check("payout setup is refused for someone who has not applied to host, and nothing is opened", /host profile first/.test((await refusal(ensurePayoutAccount(noProfile))) ?? "") && (await linkOf(noProfile)) === null);
    check("a host cannot apply from a country that is not in the list, nor without one", (await refusal(applyFrom(await person("au"), "AU"))) !== null && (await refusal(applyFrom(await person("none"), ""))) !== null);

    // Someone who pressed the button before applying, which was possible until now: a US account, and no profile.
    const early = await person("early");
    const earlyAccount = (await stripe().v2.core.accounts.create(payoutAccountRequest(early, "US", null).params as never)) as unknown as { id: string };
    atStripe.add(earlyAccount.id);
    await db.insert(schema.hostSettings).values({ userId: early.id, stripeAccountId: earlyAccount.id });
    check("someone who already has a US payout account cannot apply from the United Kingdom", /United States/.test((await refusal(applyFrom(early, "GB"))) ?? "") && (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, early.id))).length === 0);
    await applyFrom(early, "US");
    check("but can from the United States, and keeps that account", (await ensurePayoutAccount(early)) === earlyAccount.id);

    // A profile that says the United Kingdom beside a US account (written straight in: no button leads here).
    const mismatched = await person("mismatched");
    await applyFrom(mismatched, "GB");
    const usAccount = (await stripe().v2.core.accounts.create(payoutAccountRequest(mismatched, "US", null).params as never)) as unknown as { id: string };
    atStripe.add(usAccount.id);
    await db.insert(schema.hostSettings).values({ userId: mismatched.id, stripeAccountId: usAccount.id, payoutsReady: true }).onConflictDoUpdate({ target: schema.hostSettings.userId, set: { stripeAccountId: usAccount.id, payoutsReady: true } });
    check("payout setup refuses an account in another country than the profile's", /different country/.test((await refusal(ensurePayoutAccount(mismatched))) ?? ""));
    check("such a host counts as not ready, and that is written down", (await refreshPayoutsReady(mismatched.id)) === false && (await getHostSettings(mismatched.id)).payoutsReady === false);
    check("and cannot collect", /not ready/.test((await refusal(collectEarnings({ collectionId: randomUUID(), hostId: mismatched.id, startedBy: mismatched.id }))) ?? ""));

    // Two presses at the same moment.
    const twice = await person("twice");
    await applyFrom(twice, "GB");
    const both = await Promise.allSettled([ensurePayoutAccount(twice), ensurePayoutAccount(twice)]);
    const opened = [...new Set(both.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])))];
    for (const id of opened) atStripe.add(id);
    check("two setups started at the same moment leave one account, and it is the one written beside the host", opened.length === 1 && (await linkOf(twice)) === opened[0], both.map((result) => (result.status === "fulfilled" ? result.value : String((result.reason as Error).message).slice(0, 120))));

    // An account that was opened at Stripe for the United States under this person's label and never saved; then they apply from the UK.
    const lost = await person("lost");
    const request = payoutAccountRequest(lost, "US", null);
    const orphan = (await stripe().v2.core.accounts.create(request.params as never, { idempotencyKey: request.idempotencyKey })) as unknown as { id: string };
    atStripe.add(orphan.id);
    await applyFrom(lost, "GB");
    const retried = await ensurePayoutAccount(lost).then(
      (id) => ({ id, error: null as string | null }),
      (error: unknown) => ({ id: null as string | null, error: String((error as Error).message).slice(0, 200) }),
    );
    if (retried.id) atStripe.add(retried.id);
    const linked = await linkOf(lost);
    check("after an account was opened for the United States and its id lost, applying from the UK never links the US account", linked !== orphan.id && (linked === null || (await seenAtStripe(linked)).country === "GB"), retried);

    // ------------------------------------------------------------------------
    console.log("\n3. A real collection reaches a host abroad, in their own money");
    const customer = await person("customer");
    const collectAt = (host: Person, now: Date) => collectEarnings({ collectionId: randomUUID(), hostId: host.id, startedBy: host.id, now }).then(() => null, (error: unknown) => error as Error);
    for (const country of ["GB", "DE", "CH", "CA", "US"]) {
      const host = await person(`collecting-${country.toLowerCase()}`);
      await applyFrom(host, country);
      const accountId = await activatedAccount(host, country);
      check(`${country}: Stripe has activated the test account, and the host counts as ready (the account is in the profile's country)`, (await refreshPayoutsReady(host.id)) === true);
      const callShare = await chargedCall(host, customer);
      check(`${country}: (a 10-minute call at $20.00 per 15 minutes was charged: $13.33, the host's share $12.38)`, callShare.chargedCents === 1333 && callShare.originalHostShareCents === 1238, `${callShare.status} ${callShare.chargedCents}`);
      // The UK host also has a contribution's share, so that a second kind of share crosses a border once.
      let contributionShare = null as Awaited<ReturnType<typeof takenContribution>> | null;
      if (country === "GB") {
        const on = await projectsOnFor(host.id);
        check("GB: (the founder's projects switch covers this host, so a contribution can be made)", on, "run this script while projects are switched on");
        if (on) contributionShare = await takenContribution(host, await person("giver"));
      }
      const due = Math.max(callShare.transferDueAt!.getTime(), contributionShare?.transferDueAt?.getTime() ?? 0);
      const pressed = await collectAt(host, new Date(due + MIN));
      const sentCall = await reload(callShare.id);
      const call = sentCall.stripeTransferId ? await sentAtStripe(sentCall, accountId) : null;
      const accountCurrency = TEST_HOSTS[country].currency;
      if (!contributionShare) {
        // $12.38 less the 25-cent collection charge.
        check(`${country}: "Collect earnings" is accepted, and in our books the share is sent: $12.13 after the 25-cent collection charge, exactly as for a US host`, pressed === null && sentCall.transferStatus === "sent" && sentCall.transferCents === 1213 && sentCall.payoutFeeCents === 25 && (await ledger(sentCall.id, "host_transfer")) === -1213 && (await ledger(sentCall.id, "payout_fee")) === 25, `${pressed?.message} ${sentCall.transferStatus} ${sentCall.transferCents}`);
      } else {
        const sentContribution = await reload(contributionShare.id);
        const contribution = sentContribution.stripeTransferId ? await sentAtStripe(sentContribution, accountId) : null;
        const [contributionPayment] = await db.select().from(pays).where(eq(pays.id, contributionShare.contributionPaymentId!));
        check(`${country}: one collection sends both shares, each with its own transfer, with one 25-cent collection charge between them`, pressed === null && sentCall.transferStatus === "sent" && sentContribution.transferStatus === "sent" && sentCall.stripeTransferId !== sentContribution.stripeTransferId && (sentCall.transferCents ?? 0) + (sentContribution.transferCents ?? 0) === 1238 + (contributionShare.originalHostShareCents ?? 0) - 25 && (sentCall.payoutFeeCents ?? 0) + (sentContribution.payoutFeeCents ?? 0) === 25, `${pressed?.message} ${sentCall.transferStatus} ${sentContribution.transferStatus}`);
        check(`${country}: the contribution's transfer is in dollars, to the host's account, from the contribution's own charge, and arrives in ${accountCurrency}`, contribution?.transfer.currency === "usd" && contribution.transfer.amount === sentContribution.transferCents && contribution.transfer.destination === accountId && contribution.transfer.source_transaction === contributionPayment.stripeChargeId && contribution.arrivedCurrency === accountCurrency && contribution.arrivedAmount > 0, { currency: contribution?.arrivedCurrency, amount: contribution?.arrivedAmount });
      }
      check(`${country}: at Stripe the call's share is one transfer in dollars, of the amount in our books, to the host's account, from the call's own charge`, call?.transfer.currency === "usd" && call.transfer.amount === sentCall.transferCents && call.transfer.destination === accountId && call.transfer.source_transaction === sentCall.stripeChargeId, { amount: call?.transfer.amount, destination: call?.transfer.destination });
      check(`${country}: on the host's side that transfer is a line in ${accountCurrency}`, call?.arrivedCurrency === accountCurrency && (call?.arrivedAmount ?? 0) > 0, { currency: call?.arrivedCurrency, amount: call?.arrivedAmount });
    }
  } finally {
    await wipe().catch((error) => check("afterwards: what this run made could be removed", false, String(error)));
  }

  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.user).where(like(schema.user.id, "ab-%"));
  check("afterwards: nothing this script made is left here, and no test account of it is left at Stripe", left.n === 0 && atStripe.size === 0, { people: left.n, accounts: [...atStripe] });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
