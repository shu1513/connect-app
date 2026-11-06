/** Prints the test admin's current 6-digit login code (see secure-test-admin.ts). */
import { readFileSync } from "node:fs";
import { totpCode } from "./totp";

const line = readFileSync("test-accounts.local.md", "utf8").split("\n").find((l) => l.startsWith("admin TOTP secret:"));
if (!line) throw new Error("No secret saved. Run npx tsx scripts/secure-test-admin.ts first.");
console.log(totpCode(line.replace("admin TOTP secret:", "").trim()));
