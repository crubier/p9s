import { withUser } from "@p9s/drizzle";
import { createIdentity } from "@p9s/postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { DatabaseError, Pool } from "pg";
import { p9sConfig } from "./p9s";
import * as schema from "./schema";

// One pool per process, kept across hot reloads in development
const globalForDb = globalThis as unknown as { p9sExamplePool?: Pool };
export const pool = (globalForDb.p9sExamplePool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

// Connects as the owner of the tables, which bypasses RLS: for Better Auth, and for the few lookups and writes the
// server makes on its own behalf, like finding the member of the signed-in user
export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}

export const DENIED = "You don't have permission to do that.";
export const READ_ONLY = "You are viewing as someone else: nothing can be changed.";

// Drizzle wraps the errors of the driver
const databaseError = (error: unknown) =>
  error instanceof DatabaseError ? error : error instanceof Error && error.cause instanceof DatabaseError ? error.cause : undefined;

// Who a transaction runs for: a member or an API key, maybe impersonated by an admin
export interface Identity {
  roleId: string;
  impersonator?: { memberId: string; readOnly: boolean };
}

const users = createIdentity(p9sConfig);

// Runs `fn` in a transaction as app_user, on behalf of a member or an API key: every query goes through RLS, and
// nothing of the identity stays on the pooled connection after it. When an admin views as someone, Postgres refuses
// every write of the transaction, and when they act as someone, the audit triggers record who they are. The queries
// of the app are short: with JIT, Postgres would compile some for longer than they run
export const asRole = async <T>(identity: Identity | string, fn: (tx: Tx) => Promise<T>) => {
  const { roleId, impersonator } = typeof identity === "string" ? { roleId: identity, impersonator: undefined } : identity;
  try {
    return await withUser(db, users, roleId, fn, {
      readOnly: impersonator?.readOnly,
      settings: { "app.impersonator_member_id": impersonator?.memberId, jit: "off" },
    });
  } catch (error) {
    const code = databaseError(error)?.code;
    // A row that RLS rejects, on insert or as the new value of an update
    if (code === "42501") throw new ForbiddenError(DENIED, { cause: error });
    if (code === "25006") throw new ForbiddenError(READ_ONLY, { cause: error });
    throw error;
  }
};

// Switches the rest of the transaction to the graph writer role, to write edges and assignments. app_backend has no
// RLS policy, so it cannot read business rows: read what you need as app_user first
export const switchToGraphWriter = (tx: Tx) => tx.execute(sql`select set_config('role', 'app_backend', true)`);

// app_user only sees its own part of the graph: who else is in a team, or who else has access to something, is read
// as the graph writer, after checking as app_user that the actor may know
export const readGraph = async <T>(tx: Tx, query: ReturnType<typeof sql>) => {
  await switchToGraphWriter(tx);
  const found = await rows<T>(tx, query);
  await tx.execute(sql`select set_config('role', 'app_user', true)`);
  return found;
};

export const rows = async <T>(tx: Tx | Db, query: ReturnType<typeof sql>) => (await tx.execute(query)).rows as T[];

// Turns the errors raised by RLS and p9s into messages for the user
export const describeError = (error: unknown): string => {
  if (error instanceof ForbiddenError || error instanceof NotFoundError) return error.message;
  const cause = databaseError(error);
  if (cause?.code === "54000") return "That would nest folders too deeply.";
  if (cause?.code === "23505") return "That already exists.";
  if (cause) return cause.message;
  return error instanceof Error ? error.message : String(error);
};
