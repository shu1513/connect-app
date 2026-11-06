import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { haveIBeenPwned, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { outsideLoginProblem, UNUSED_LOGIN_PATHS } from "./auth-rules";
import { sendEmailInBackground } from "./email";

const APP_NAME = "Connect";
const ONE_HOUR = 3600;

/** Google sign-in is offered only when its keys are set in .env.local. */
export const googleSignInConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** While developing, also accept logins made through the temporary secure tunnel (and only that one). */
function developmentOrigins(): string[] {
  if (process.env.NODE_ENV === "production" || !process.env.PUBLIC_APP_URL) return [];
  try {
    return [new URL(process.env.PUBLIC_APP_URL).origin];
  } catch {
    return [];
  }
}

/**
 * Login setup.
 *
 * - Anyone can sign up, but a password account cannot log in until its email address is confirmed.
 * - Sign-up, password reset and "send again" answer the same way whether or not the address has an account.
 * - A Google login joins an existing account only when that account's email is already confirmed.
 *   Google is deliberately NOT a "trusted provider": that would skip this check.
 */
export const auth = betterAuth({
  appName: APP_NAME,
  database: drizzleAdapter(db, {
    provider: "pg",
    transaction: true,
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
      twoFactor: schema.twoFactor,
    },
  }),
  trustedOrigins: developmentOrigins(),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: ONE_HOUR,
    // A reset logs out every device, so whoever knew the old password is out.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      sendEmailInBackground({
        to: user.email,
        kind: "reset",
        subject: `Reset your ${APP_NAME} password`,
        text: `Someone asked to reset the password for this ${APP_NAME} account.\n\nTo choose a new password, open this link within one hour:\n${url}\n\nIf this was not you, ignore this email. Your password stays the same.`,
      });
    },
    // Someone tried to sign up with an address that already has an account. The screen
    // says nothing; the owner of the address is told here.
    onExistingUserSignUp: async ({ user }) => {
      sendEmailInBackground({
        to: user.email,
        kind: "notice",
        subject: `You already have a ${APP_NAME} account`,
        text: `Someone tried to create a ${APP_NAME} account with this email address, but it already has one.\n\nIf this was you, log in instead. If you forgot your password, or never finished signing up, use "Forgot password" on the login page.\n\nIf this was not you, you can ignore this email.`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    // Trying to log in before confirming sends the link again.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: ONE_HOUR,
    sendVerificationEmail: async ({ user, url }) => {
      sendEmailInBackground({
        to: user.email,
        kind: "confirm",
        subject: `Confirm your email address for ${APP_NAME}`,
        text: `Welcome to ${APP_NAME}.\n\nTo confirm this email address, open this link within one hour:\n${url}\n\nIf you did not sign up, ignore this email.`,
      });
    },
  },

  socialProviders: googleSignInConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          // Only Google accounts whose email Google itself has confirmed.
          requireEmailVerification: true,
        },
      }
    : {},

  user: {
    // Checked before an account is created or joined, and on every later Google login.
    validateUserInfo: async ({ user, source }) => outsideLoginProblem(user, source),
  },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [],
      allowDifferentEmails: false,
    },
  },

  session: {
    // Logged in for 30 days from last use.
    expiresIn: 30 * 24 * ONE_HOUR,
    updateAge: 24 * ONE_HOUR,
  },

  // Slows down repeated attempts, per network address. Kept in the database so it
  // works with more than one server. (Emails are also limited per address and kind, in email.ts.)
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 300, max: 10 },
      "/sign-up/email": { window: ONE_HOUR, max: 10 },
      "/request-password-reset": { window: ONE_HOUR, max: 5 },
      "/send-verification-email": { window: ONE_HOUR, max: 5 },
      "/reset-password": { window: ONE_HOUR, max: 10 },
      "/change-password": { window: ONE_HOUR, max: 10 },
    },
  },

  databaseHooks: {
    session: {
      create: {
        // A closed account cannot log in, by any method. An admin cannot log in with Google:
        // Google would skip the second step, so admins use their password and their code.
        before: async (session, ctx) => {
          const [owner] = await db
            .select({ closedAt: schema.user.closedAt })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId));
          if (owner?.closedAt) return false;
          if (ctx?.path?.startsWith("/callback")) {
            const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, session.userId));
            if (admin) return false;
          }
        },
      },
    },
  },

  hooks: {
    // Changing the password always logs out every other device, whatever the browser sends.
    before: createAuthMiddleware(async (ctx) => {
      // Parts of the login tool this app does not use are switched off.
      if (UNUSED_LOGIN_PATHS.some((path) => ctx.path === path || ctx.path.startsWith(`${path}/`))) throw new APIError("NOT_FOUND");
      if (ctx.path === "/change-password") {
        return { context: { ...ctx, body: { ...ctx.body, revokeOtherSessions: true } } };
      }
    }),
  },

  // Refuses passwords that appear in the public list of leaked passwords.
  plugins: [
    haveIBeenPwned({
      customPasswordCompromisedMessage: "This password has appeared in a data leak, so it is not safe. Please choose a different one.",
    }),
    // The second login step: a 6-digit code from an authenticator app. "Trust this device" is as good
    // as off (one second), so the code is asked for at every login.
    twoFactor({ issuer: "Connect", trustDeviceMaxAge: 1 }),
  ],

  // Problems during Google sign-in come back to the login page, which explains them.
  onAPIError: { errorURL: "/login" },
});
