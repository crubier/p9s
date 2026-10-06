import { betterAuth } from "better-auth";
import { pool } from "./db";

// On Vercel, every deployment answers on its own URL, its branch's, and the production domain
const vercelOrigins = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
  .filter(Boolean)
  .map((host) => `https://${host}`);

// Vercel also answers on aliases that no variable names, like the team's: a page of the host it posts to is trusted.
// The host comes from the headers, which pages cannot set
const ownOrigin = (request: Request) => {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${protocol}://${host}`;
};

const timestamps = { createdAt: "created_at", updatedAt: "updated_at" };

// The tables of sql/schema.sql, which name columns in snake case
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? vercelOrigins[0],
  trustedOrigins: (request) => [...vercelOrigins, ...(request ? [ownOrigin(request)] : [])],
  database: pool,
  emailAndPassword: { enabled: true },
  user: { fields: { emailVerified: "email_verified", ...timestamps } },
  session: {
    fields: { expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", userId: "user_id", ...timestamps },
    // Every GraphQL request reads the session: a signed cookie saves the query for a few minutes
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  account: {
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      ...timestamps,
    },
  },
  verification: { fields: { expiresAt: "expires_at", ...timestamps } },
});
