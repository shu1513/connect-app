/**
 * For testing tools that create accounts or run money jobs: they must only
 * ever touch a database on this computer, never a shared or live one.
 */
export function requireLocalDatabase(): void {
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    // handled below
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("This script only runs against a database on this computer (DATABASE_URL must point to localhost).");
  }
}
