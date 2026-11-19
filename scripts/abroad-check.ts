/**
 * Testing tool: hosts outside the United States (plans/27-hosts-abroad.md), against Stripe's test
 * mode and this computer's test database. No real money moves.
 *
 * It only ever acts on its own records. It makes its own people (their ids start "ab-", their
 * email is "abroadcheck-<run>-<number>@example.test"), never touches the test host
 * host@test.local or its payout account, and never runs the always-on
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
 *              collects its details on its own form, so the collecting hosts get an account
 *              opened with what the app's own request builder gives, with a test web address
 *              and without a Stripe dashboard, which lets this script fill in Stripe's own test
 *              values (for the US one also what a business is, which Stripe's form would ask
 *              the host). The setup's own account is completed by hand, once, in the browser
 *              check.
 *
 * At the end it removes what it made here, and at Stripe the test accounts and test customers it
 * opened. The accounts are found again by their email address (exactly the form above), so also
 * one whose id never came back, and those of an earlier run that was stopped. What it made here
 * is removed in one step, and only if everything at Stripe could be removed first: otherwise it
 * all stays, the run fails, and the next run tries again. The test payments and transfers stay at
 * Stripe as history, as for every check script, and so does a test customer whose id Stripe gave
 * and that never got written down here. Like the others it needs the test database to itself, and
 * the Stripe test account too: its accounts there are found by their email address, so a run on
 * another database with the same Stripe test key would remove the accounts of a run that is still
 * going here. Projects must be switched on for every host (the founder's switch, "everyone"): the
 * UK host's contribution needs it, and the host is made by the run, so naming hosts is not enough.
 *
 * Usage: npx tsx scripts/abroad-check.ts
 *        npx tsx scripts/abroad-check.ts --setup-host=<email>
 *
 * The second form is for the one thing a script cannot do alone: a collection into an account
 * that payout setup itself opened. First a fresh test host, made for this and with nothing else
 * to their name, applies in the app from a country abroad, presses "Set up payouts" and fills in
 * Stripe's own form (in test mode, with Stripe's test values). Then this form of the script makes
 * one paid call for that host and collects it. The host, their profile and their account stay;
 * the call, its share and its collection are removed again. It refuses the shared test host, and
 * a host who already has calls, members, contributions or collections. (That the account was
 * opened by payout setup is the host's doing in the app; the script can only see that it looks
 * like one.)
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
  const setupHostEmail = process.argv.find((arg) => arg.startsWith("--setup-host="))?.slice("--setup-host=".length);

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
  /** The test accounts Stripe lists whose email address is one of these. */
  async function accountsAtStripe(wanted: (email: string) => boolean): Promise<string[]> {
    const found: string[] = [];
    for await (const account of stripe().accounts.list({ limit: 100 })) if (account.email && wanted(account.email)) found.push(account.id);
    return found;
  }
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
   * An account Stripe has activated, for a host in that country. It is opened with what the app's own request
   * builder gives (a test web address in place of Connect's, and no label against a second press), with one
   * difference: no Stripe dashboard goes with it, because only then may a script fill in what the host would type
   * on Stripe's form. Those details are Stripe's own test values; the US one is also told what the business is,
   * which Stripe's form would ask a US host. In the runs so far Stripe took about a minute to check a UK one.
   * Written beside the host as payout setup would write it. Without a bank account (the last argument), Stripe
   * is waited for only until it would accept our transfers: it can then not pay the host's bank.
   */
  async function activatedAccount(host: Person, country: string, withBank = true): Promise<string> {
    const test = TEST_HOSTS[country];
    const account = (await stripe().v2.core.accounts.create({ ...payoutAccountRequest(host, country, "https://accessible.stripe.com").params, dashboard: "none" } as never)) as unknown as { id: string };
    atStripe.add(account.id);
    await stripe().accounts.update(account.id, {
      business_type: "individual",
      ...(country === "US" ? { business_profile: { mcc: "8999", url: "https://accessible.stripe.com", product_description: "Private one-to-one video calls with fans, booked and paid for on Connect." } } : {}),
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
      ...(withBank ? { external_account: { object: "bank_account", country, currency: test.currency, account_number: test.account_number, ...(test.routing_number ? { routing_number: test.routing_number } : {}) } as never } : {}),
    });
    let transfers: string | undefined;
    let payouts: string | undefined;
    for (let i = 0; i < 60 && !(transfers === "active" && (payouts === "active" || !withBank)); i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 4000));
      const now = (await stripe().v2.core.accounts.retrieve(account.id, { include: ["configuration.recipient"] } as never)) as unknown as { configuration?: { recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string }; payouts?: { status?: string } } } } } };
      transfers = now.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
      payouts = now.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status;
    }
    if (transfers !== "active" || (withBank && payouts !== "active")) throw new Error(`Stripe did not activate the test account ${account.id} in ${country} within four minutes (transfers "${transfers}", payouts to the bank "${payouts}"), so nothing can be shown with it.`);
    if (!withBank && payouts === "active") throw new Error(`Stripe says the test account ${account.id} can pay a bank although it was given none, so the check that needs such an account cannot be made.`);
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
    const charged = (await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)))[0];
    if (charged.status !== "charged" || !charged.transferDueAt) throw new Error(`The test call's payment was not charged (it is "${charged.status}"), so there is no share to collect.`);
    return charged;
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
    if (!intent) throw new Error("The test contribution's payment could not be made ready at Stripe.");
    await stripe().paymentIntents.confirm(intent.intentId, { payment_method: "pm_card_visa", return_url: RETURN });
    const held = await C.syncPayment(paymentId, new Date());
    if (held.status !== "held" || !held.takeAt) throw new Error(`The test contribution was not held (it is "${held.status}").`);
    await C.takePayment(paymentId, held.takeAt);
    const [share] = await db.select().from(schema.payments).where(eq(schema.payments.contributionPaymentId, paymentId));
    if (!share?.transferDueAt) throw new Error("The test contribution's money was not taken, so there is no share to collect.");
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
  /** The email addresses this script gives its own people, and nothing else: "abroadcheck-", a run's eight letters, a number. */
  const OWN_EMAIL = /^abroadcheck-[0-9a-f]{8}-\d+@example\.test$/;
  /** The same form, as the database is asked for it: emails to this script's own people, and to nobody whose address merely begins alike. */
  const ownEmailRows = sql`${schema.emailOutbox.to} ~ '^abroadcheck-[0-9a-f]{8}-[0-9]+@example[.]test$'`;
  /** This script's test accounts at Stripe, found by their email: also one whose id never reached us, and those of a run that was stopped. */
  const ownAccountsAtStripe = () => accountsAtStripe((email) => OWN_EMAIL.test(email));
  /**
   * Removes what this script made: at Stripe its test accounts and test customers, here its people (ids starting
   * "ab-") and all that hangs on them. Here it is one step: everything goes, or nothing does and the next run tries
   * again. If something at Stripe could not be removed, nothing is removed here either, so that it can still be found.
   * Returns whether everything is gone.
   */
  async function wipe(): Promise<boolean> {
    const failedBefore = failures;
    const kept = () => {
      check("clean-up: this script's lines here are kept, so that the next run can find what is left", false);
      return false;
    };
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, "ab-%"))).map((row) => row.id);
    // What is to be removed here is worked out, and looked at, before anything is removed anywhere.
    const contributionIds = (await db.select({ id: schema.contributions.id }).from(schema.contributions).where(or(inArray(schema.contributions.hostId, ids), inArray(schema.contributions.contributorId, ids)))).map((row) => row.id);
    const cpIds = contributionIds.length > 0 ? (await db.select({ id: pays.id }).from(pays).where(inArray(pays.contributionId, contributionIds))).map((row) => row.id) : [];
    const calls = (await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)))).map((row) => row.id);
    const shares = [
      ...(cpIds.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.contributionPaymentId, cpIds)) : []),
      ...(calls.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.callId, calls)) : []),
    ].map((row) => row.id);
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    // The collections these shares went out in: those of this script's own hosts, and (after --setup-host) one of a host
    // who is not one of its people. Such a collection is only removed if every share in it is one of this script's.
    const collectionIds = [
      ...new Set([
        ...(await db.select({ id: schema.collections.id }).from(schema.collections).where(inArray(schema.collections.hostId, ids))).map((row) => row.id),
        ...(shares.length > 0 ? await db.select({ id: schema.collectionItems.collectionId }).from(schema.collectionItems).where(inArray(schema.collectionItems.paymentId, shares)) : []).map((row) => row.id),
      ]),
    ];
    const foreign = collectionIds.length > 0 ? (await db.select({ paymentId: schema.collectionItems.paymentId }).from(schema.collectionItems).where(inArray(schema.collectionItems.collectionId, collectionIds))).filter((item) => !shares.includes(item.paymentId)) : [];
    if (foreign.length > 0) {
      check("clean-up: a collection this script made holds only its own shares", false, `${foreign.length} share(s) of someone else are in it`);
      return kept();
    }

    for (const id of new Set([...atStripe, ...(await ownAccountsAtStripe())])) await removeAtStripe(id);
    // The test customers Stripe keeps for these people's cards. (Their payments stay at Stripe as history.)
    for (const row of await db.select({ id: schema.stripeCustomers.stripeCustomerId }).from(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids))) {
      await stripe()
        .customers.del(row.id)
        .catch((error: unknown) => {
          if (!/No such customer/i.test(String((error as Error).message))) check(`clean-up: the test customer ${row.id} at Stripe could be removed`, false, String((error as Error).message));
        });
    }
    if (failures > failedBefore) return kept();
    if (ids.length === 0) {
      await db.delete(schema.emailOutbox).where(ownEmailRows);
      return true;
    }

    await db.transaction(async (tx) => {
      if (collectionIds.length > 0) {
        await tx.delete(schema.collectionItems).where(inArray(schema.collectionItems.collectionId, collectionIds));
        await tx.delete(schema.collections).where(inArray(schema.collections.id, collectionIds));
      }
      if (shares.length > 0) {
        await tx.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, shares));
        await tx.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, shares));
        await tx.delete(schema.payments).where(inArray(schema.payments.id, shares));
      }
      if (cpIds.length > 0) {
        await tx.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.contributionPaymentId, cpIds));
        await tx.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.contributionPaymentId, cpIds));
        await tx.delete(schema.contributionRefunds).where(inArray(schema.contributionRefunds.contributionPaymentId, cpIds));
        await tx.delete(pays).where(inArray(pays.id, cpIds));
      }
      if (contributionIds.length > 0) {
        await tx.delete(schema.contributionCards).where(inArray(schema.contributionCards.contributionId, contributionIds));
        await tx.delete(schema.contributionAgreements).where(inArray(schema.contributionAgreements.contributionId, contributionIds));
        await tx.delete(schema.contributions).where(inArray(schema.contributions.id, contributionIds));
      }
      if (calls.length > 0) {
        await tx.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, calls));
        await tx.delete(schema.calls).where(inArray(schema.calls.id, calls));
      }
      if (projectIds.length > 0) await tx.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
      await tx.delete(schema.projects).where(inArray(schema.projects.hostId, ids));
      await tx.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
      await tx.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
      await tx.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids));
      await tx.delete(schema.emailOutbox).where(ownEmailRows);
      await tx.delete(schema.user).where(inArray(schema.user.id, ids));
    });
    return true;
  }

  // The host of --setup-host is looked at before anything is cleaned up, and must be a fresh one of its own.
  if (process.argv.some((arg) => arg === "--setup-host" || arg === "--setup-host=")) throw new Error("--setup-host needs the host's email: --setup-host=<email>.");
  if (setupHostEmail && (OWN_EMAIL.test(setupHostEmail) || setupHostEmail === "host@test.local")) throw new Error("--setup-host is for a fresh test host made for this one check: not the shared test host, and not one of this script's own addresses.");

  // What an earlier run left is removed first. If that cannot be done, nothing new is made on top of it.
  if (!(await wipe())) throw new Error("What an earlier run of this script left behind could not be removed (see above). Nothing new was started.");
  try {
    if (setupHostEmail) {
      // ----------------------------------------------------------------------
      console.log(`\nA collection into the account that payout setup itself opened, for ${setupHostEmail}`);
      const [host] = await db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.email, setupHostEmail));
      const [profile] = host ? await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, host.id)) : [];
      // (Read as it is: asking for a person's settings in the app's way would write an empty line for someone who has none.)
      const [theirSettings] = host ? await db.select({ accountId: schema.hostSettings.stripeAccountId }).from(schema.hostSettings).where(eq(schema.hostSettings.userId, host.id)) : [];
      const accountId = theirSettings?.accountId ?? null;
      if (!host || !profile || !accountId) throw new Error("That person has no host profile with a payout account. Apply as a host in the app and finish \"Set up payouts\" first.");
      // Only a host with nothing else to their name: "Collect earnings" sends everything of a host that is ready, and
      // this check must send, and afterwards remove, its own call's share and nothing of anyone else's.
      const [{ n: theirCalls }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.calls).where(eq(schema.calls.hostId, host.id));
      const [{ n: theirCollections }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.collections).where(eq(schema.collections.hostId, host.id));
      const [{ n: theirMembers }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(eq(schema.memberships.hostId, host.id));
      const [{ n: theirContributions }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contributions).where(eq(schema.contributions.hostId, host.id));
      if (theirCalls + theirCollections + theirMembers + theirContributions > 0) throw new Error("That host already has calls, members, contributions or collections. This check needs a fresh host made for it, so that it collects and removes only its own call.");
      const seen = await seenAtStripe(accountId);
      const abroad = profile.country !== "US";
      const asSetupOpensIt = seen.country === profile.country && seen.configurations === (abroad ? "merchant,recipient" : "recipient");
      check(`the account is in ${profile.country}, the profile's country, and ${abroad ? "also asks for card payments" : "only receives transfers"}, as payout setup opens it`, asSetupOpensIt, seen);
      const ready = await refreshPayoutsReady(host.id);
      check("its host finished Stripe's form: the host counts as ready", ready);
      if (!asSetupOpensIt || !ready) throw new Error("The host's payout account is not ready or not as payout setup opens it, so no call is made and nothing is collected.");
      const share = await chargedCall(host, await person("customer"));
      const pressed = await collectEarnings({ collectionId: randomUUID(), hostId: host.id, startedBy: host.id, now: new Date(share.transferDueAt!.getTime() + MIN) }).then(() => null, (error: unknown) => error as Error);
      const sent = await reload(share.id);
      // A 10-minute call at $20.00 per 15 minutes: $13.33 charged, the host's share $12.38, less the 25-cent collection charge.
      check("\"Collect earnings\" is accepted, and in our books the call's share is sent: $12.13 after the 25-cent collection charge", pressed === null && sent.transferStatus === "sent" && sent.transferCents === 1213 && sent.payoutFeeCents === 25 && (await ledger(sent.id, "host_transfer")) === -1213 && (await ledger(sent.id, "payout_fee")) === 25, `${pressed?.message} ${sent.transferStatus} ${sent.transferCents}`);
      const arrived = sent.stripeTransferId ? await sentAtStripe(sent, accountId) : null;
      const currency = (await stripe().accounts.retrieve(accountId)).default_currency;
      check("at Stripe it is a transfer in dollars, of the amount in our books, to that account, from the call's own charge", arrived?.transfer.currency === "usd" && arrived.transfer.amount === sent.transferCents && arrived.transfer.destination === accountId && arrived.transfer.source_transaction === sent.stripeChargeId, { amount: arrived?.transfer.amount });
      check(`and on the host's side it is a line in the account's own money (${currency})`, arrived?.arrivedCurrency === currency && (arrived?.arrivedAmount ?? 0) > 0, { currency: arrived?.arrivedCurrency, amount: arrived?.arrivedAmount });
    } else {
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

    // A US account that Stripe has activated: ready beside a US profile, and the very same account not ready beside
    // a profile that says the United Kingdom. So it is the country that makes the difference, nothing else.
    const usFirst = await person("us-first");
    await applyFrom(usFirst, "US");
    const activeUs = await activatedAccount(usFirst, "US");
    check("(a US account that Stripe has activated counts as ready beside a US profile)", (await refreshPayoutsReady(usFirst.id)) === true);
    // The same kind of account with no bank account: Stripe would accept our transfers, and could not pay them out.
    const noBank = await person("no-bank");
    await applyFrom(noBank, "US");
    await activatedAccount(noBank, "US", false);
    check("an account Stripe would send our transfers to, but that has no bank account to pay out to, is not ready", (await refreshPayoutsReady(noBank.id)) === false);
    // When Stripe's answer does not say which country the account is in, the host is not ready either. (The script
    // takes the country out of one answer, as a broken answer would have it.)
    const accounts = stripe().v2.core.accounts;
    const realRetrieve = accounts.retrieve;
    accounts.retrieve = (async (...args: Parameters<typeof realRetrieve>) => ({ ...(await realRetrieve.apply(accounts, args)), identity: null })) as unknown as typeof realRetrieve;
    let unnamed: { ready: boolean; setup: string | null };
    try {
      unnamed = { ready: await refreshPayoutsReady(usFirst.id), setup: await refusal(ensurePayoutAccount(usFirst)) };
    } finally {
      accounts.retrieve = realRetrieve;
    }
    check("an account whose country Stripe does not name is not ready, and payout setup does not go on with it", unnamed.ready === false && /could not confirm/.test(unnamed.setup ?? "") && (await refreshPayoutsReady(usFirst.id)) === true, unnamed);
    // The same account beside a profile that says the United Kingdom (written straight in: no button leads here).
    const mismatched = await person("mismatched");
    await applyFrom(mismatched, "GB");
    await db.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, usFirst.id));
    await db.insert(schema.hostSettings).values({ userId: mismatched.id, stripeAccountId: activeUs, payoutsReady: true }).onConflictDoUpdate({ target: schema.hostSettings.userId, set: { stripeAccountId: activeUs, payoutsReady: true } });
    check("payout setup refuses an account in another country than the profile's", /could not confirm/.test((await refusal(ensurePayoutAccount(mismatched))) ?? ""));
    check("that host counts as not ready although Stripe would pay the account, and that is written down", (await refreshPayoutsReady(mismatched.id)) === false && (await getHostSettings(mismatched.id)).payoutsReady === false);
    check("and cannot collect", /not ready/.test((await refusal(collectEarnings({ collectionId: randomUUID(), hostId: mismatched.id, startedBy: mismatched.id }))) ?? ""));

    // Two presses at the same moment.
    const twice = await person("twice");
    await applyFrom(twice, "GB");
    const both = await Promise.allSettled([ensurePayoutAccount(twice), ensurePayoutAccount(twice)]);
    const opened = [...new Set(both.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])))];
    for (const id of opened) atStripe.add(id);
    check("two setups started at the same moment: every press that went through got the same account, and it is the one written beside the host", opened.length === 1 && (await linkOf(twice)) === opened[0], both.map((result) => (result.status === "fulfilled" ? result.value : String((result.reason as Error).message).slice(0, 120))));
    // And Stripe's own list shows one account with this person's email, not a second one that nobody kept. Stripe's
    // list may take a moment to show a new account, so it is asked five times over about fifteen seconds and every
    // account it ever shows is counted. (What it has not shown by then, this cannot see.)
    const theirs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
      for (const id of await accountsAtStripe((email) => email === twice.email)) theirs.add(id);
    }
    for (const id of theirs) atStripe.add(id);
    check("and Stripe's list shows one account for them over the next fifteen seconds, not two", theirs.size === 1 && theirs.has(opened[0]), [...theirs]);

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
    check("after an account was opened for the United States and its id lost, applying from the UK opens their own account in the UK, and the US one is never linked", retried.id !== null && linked === retried.id && linked !== orphan.id && (await seenAtStripe(linked)).country === "GB", retried);

    // ------------------------------------------------------------------------
    console.log("\n3. A real collection reaches a host abroad, in their own money");
    const customer = await person("customer");
    const collectAt = (host: Person, now: Date) => collectEarnings({ collectionId: randomUUID(), hostId: host.id, startedBy: host.id, now }).then(() => null, (error: unknown) => error as Error);
    // (The five accounts are opened and filled in side by side: Stripe takes about a minute to check each.)
    const collecting: Array<{ country: string; host: Person }> = [];
    for (const country of ["GB", "DE", "CH", "CA", "US"]) {
      const host = await person(`collecting-${country.toLowerCase()}`);
      await applyFrom(host, country);
      collecting.push({ country, host });
    }
    // Every one of them is waited for, also when one fails: the clean-up must not start while another is still being opened.
    const opening = await Promise.allSettled(collecting.map(({ country, host }) => activatedAccount(host, country)));
    const notOpened = opening.flatMap((result, index) => (result.status === "rejected" ? [`${collecting[index].country}: ${String((result.reason as Error).message ?? result.reason).slice(0, 200)}`] : []));
    if (notOpened.length > 0) throw new Error(`A test account could not be opened and activated, so no collection is shown (${notOpened.join("; ")}).`);
    const theirAccounts = opening.map((result) => (result.status === "fulfilled" ? result.value : ""));
    for (const [index, { country, host }] of collecting.entries()) {
      const accountId = theirAccounts[index];
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
        check(`${country}: one collection sends both shares, each with its own transfer, with one 25-cent collection charge between them`, pressed === null && sentCall.transferStatus === "sent" && sentContribution.transferStatus === "sent" && sentCall.stripeTransferId !== sentContribution.stripeTransferId && (sentCall.transferCents ?? 0) + (sentContribution.transferCents ?? 0) === 1238 + (contributionShare.originalHostShareCents ?? 0) - 25 && (sentCall.payoutFeeCents ?? 0) + (sentContribution.payoutFeeCents ?? 0) === 25 && (await ledger(sentCall.id, "host_transfer")) === -(sentCall.transferCents ?? 0) && (await ledger(sentContribution.id, "host_transfer")) === -(sentContribution.transferCents ?? 0) && (await ledger(sentCall.id, "payout_fee")) + (await ledger(sentContribution.id, "payout_fee")) === 25, `${pressed?.message} ${sentCall.transferStatus} ${sentContribution.transferStatus}`);
        check(`${country}: the contribution's transfer is in dollars, to the host's account, from the contribution's own charge, and arrives in ${accountCurrency}`, contribution?.transfer.currency === "usd" && contribution.transfer.amount === sentContribution.transferCents && contribution.transfer.destination === accountId && contribution.transfer.source_transaction === contributionPayment.stripeChargeId && contribution.arrivedCurrency === accountCurrency && contribution.arrivedAmount > 0, { currency: contribution?.arrivedCurrency, amount: contribution?.arrivedAmount });
      }
      check(`${country}: at Stripe the call's share is a transfer in dollars, of the amount in our books, to the host's account, from the call's own charge`, call?.transfer.currency === "usd" && call.transfer.amount === sentCall.transferCents && call.transfer.destination === accountId && call.transfer.source_transaction === sentCall.stripeChargeId, { amount: call?.transfer.amount, destination: call?.transfer.destination });
      check(`${country}: on the host's side that transfer is a line in ${accountCurrency}`, call?.arrivedCurrency === accountCurrency && (call?.arrivedAmount ?? 0) > 0, { currency: call?.arrivedCurrency, amount: call?.arrivedAmount });
    }
    }
  } finally {
    await wipe().then(
      (gone) => gone || check("afterwards: what this run made could be removed", false),
      (error) => check("afterwards: what this run made could be removed", false, String(error)),
    );
  }

  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.user).where(like(schema.user.id, "ab-%"));
  const stillAtStripe = await ownAccountsAtStripe();
  check("afterwards: none of this script's people is left here, and Stripe lists no test account of it", left.n === 0 && atStripe.size === 0 && stillAtStripe.length === 0, { people: left.n, accounts: [...new Set([...atStripe, ...stillAtStripe])] });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
