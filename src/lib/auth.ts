import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "@/db";

/**
 * Login setup. Public sign-up is switched off for now: accounts are created
 * by the seed script (scripts/seed.ts), which passes allowSignUp = true.
 */
export function createAuth(options: { allowSignUp?: boolean } = {}) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // While developing, also accept logins made through a temporary secure tunnel.
    trustedOrigins: process.env.NODE_ENV === "production" ? [] : ["https://*.trycloudflare.com"],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowSignUp,
      minPasswordLength: 12,
    },
  });
}

export const auth = createAuth();
