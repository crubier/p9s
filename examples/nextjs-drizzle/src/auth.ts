import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { account, session, user, verification } from "./schema";

// On Vercel, every deployment answers on its own URL, its branch's, and the production domain
const vercelOrigins = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
  .filter(Boolean)
  .map((host) => `https://${host}`);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? vercelOrigins[0],
  trustedOrigins: vercelOrigins,
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});
