/**
 * Creates the test accounts. Safe to run more than once: existing accounts are left alone.
 *
 * Passwords are generated here and written to test-accounts.local.md, which is
 * kept out of version history. They are never printed.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const ACCOUNTS = [
  { name: "Hana Host", email: "host@test.local" },
  { name: "Cory Customer", email: "customer@test.local" },
  { name: "Sam Stranger", email: "stranger@test.local" },
  { name: "Ada Admin", email: "admin@test.local" },
];

/** These accounts may use the admin page. */
const ADMIN_EMAILS = ["admin@test.local"];

const OUT_FILE = "test-accounts.local.md";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("The test accounts are never created in the live app.");
  requireLocalDatabase();
  const { auth } = await import("../src/lib/auth");
  const { db, schema } = await import("../src/db");

  const lines: string[] = existsSync(OUT_FILE)
    ? readFileSync(OUT_FILE, "utf8").split("\n")
    : [
        "# Test accounts",
        "",
        "For local testing only. This file stays on this computer.",
        "",
        "| Name | Email | Password |",
        "| --- | --- | --- |",
      ];

  // Sign-up is public, so an address on this list could have been registered by someone else
  // before this script ran. Only accounts made here (or already confirmed) are trusted.
  const now = new Date();
  let created = 0;
  for (const a of ACCOUNTS) {
    const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, a.email));
    if (existing) {
      if (!existing.emailVerified) console.warn(`Skipped ${a.email}: it already exists but was not made by this script. Remove it and run again.`);
      continue;
    }
    const password = randomBytes(12).toString("base64url");
    await auth.api.signUpEmail({ body: { name: a.name, email: a.email, password } });
    lines.push(`| ${a.name} | ${a.email} | ${password} |`);
    // Save straight away, so a later failure cannot lose this account's password.
    writeFileSync(OUT_FILE, lines.join("\n").replace(/\n*$/, "\n"));
    // Test accounts skip the email confirmation and the welcome step.
    await db
      .update(schema.user)
      .set({ emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" })
      .where(eq(schema.user.email, a.email));
    created++;
  }

  // Test accounts always stand on the current terms, so a changed version does not stop them.
  await db
    .update(schema.user)
    .set({ termsVersion: TERMS_VERSION, termsAcceptedAt: now, adultConfirmedAt: now })
    .where(and(inArray(schema.user.email, ACCOUNTS.map((a) => a.email)), eq(schema.user.emailVerified, true)));

  for (const email of ADMIN_EMAILS) {
    const [admin] = await db.select().from(schema.user).where(eq(schema.user.email, email));
    if (admin?.emailVerified) await db.insert(schema.admins).values({ userId: admin.id }).onConflictDoNothing();
  }

  console.log(`Accounts created: ${created}. Existing: ${ACCOUNTS.length - created}. Details are in ${OUT_FILE}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
