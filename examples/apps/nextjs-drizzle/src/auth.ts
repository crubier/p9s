import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { account, session, user, verification } from "./schema";

// On Vercel, every deployment answers on its own URL, its branch's, and the production domain
const vercelOrigins = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
  .filter(Boolean)
  .map((host) => `https://${host}`);

// Vercel also answers on aliases that no variable names, like the team's: a page of the host it posts to is trusted.
// Next makes the request's URL from its own hostname, so the host comes from the headers, which pages cannot set
const ownOrigin = (request: Request) => {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${protocol}://${host}`;
};

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? vercelOrigins[0],
  trustedOrigins: (request) => [...vercelOrigins, ...(request ? [ownOrigin(request)] : [])],
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: { enabled: true },
  plugins: [nextCookies()],
});
