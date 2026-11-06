/**
 * Testing tool: sets up the second login step for admin@test.local the way the
 * admin page does, and saves the authenticator secret in test-accounts.local.md
 * (kept out of version history). Then `npx tsx scripts/admin-code.ts` prints
 * the current 6-digit code for logging in by hand.
 *
 * Usage: npx tsx scripts/secure-test-admin.ts   (the app must be running)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";
import { secretOf, totpCode } from "./totp";

const BASE = "http://localhost:3000";
const FILE = "test-accounts.local.md";

async function main() {
  requireLocalDatabase();
  if (process.env.NODE_ENV === "production") throw new Error("Testing tool only.");
  const { db, schema } = await import("../src/db");
  const text = readFileSync(FILE, "utf8");
  const row = text.split("\n").find((line) => line.includes("admin@test.local"));
  const password = row?.split("|").map((c) => c.trim())[3];
  if (!password) throw new Error(`No admin password in ${FILE}. Run npm run seed first.`);
  if (/admin TOTP secret/.test(text)) {
    console.log("The test admin already has a secret saved. Nothing to do.");
    process.exit(0);
  }

  const jar = new Map<string, string>();
  const call = async (path: string, body: unknown) => {
    const response = await fetch(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      if (pair.slice(at + 1)) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
    }
    return { status: response.status, json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  };

  const signIn = await call("/sign-in/email", { email: "admin@test.local", password });
  if (signIn.status !== 200) throw new Error(`Could not log in as the test admin (${signIn.status}).`);
  const enabled = await call("/two-factor/enable", { password, issuer: "Connect" });
  if (enabled.status !== 200 || !enabled.json?.totpURI) throw new Error(`Could not start the second step (${enabled.status}): ${JSON.stringify(enabled.json)}`);
  const secret = secretOf(String(enabled.json.totpURI));
  const verified = await call("/two-factor/verify-totp", { code: totpCode(secret), trustDevice: false });
  if (verified.status !== 200) throw new Error(`The code was not accepted (${verified.status}).`);

  const [admin] = await db.select().from(schema.user).where(eq(schema.user.email, "admin@test.local"));
  await db.transaction(async (tx) => {
    await tx.update(schema.admins).set({ securedAt: new Date() }).where(eq(schema.admins.userId, admin.id));
    await tx.delete(schema.session).where(eq(schema.session.userId, admin.id));
  });
  writeFileSync(FILE, `${text.replace(/\n*$/, "\n")}\nadmin TOTP secret: ${secret}\nadmin backup codes: ${(enabled.json.backupCodes as string[]).join(" ")}\n`);
  console.log(`Done. The secret and backup codes are in ${FILE}. Current code: ${totpCode(secret)}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
