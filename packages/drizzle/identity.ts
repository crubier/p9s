import { sql } from "drizzle-orm";
import type { Identity, RunOptions, UserId } from "@p9s/postgres";

// What a Postgres database of Drizzle has, as a shape rather than its class, so that a database made with another copy
// of drizzle-orm in node_modules fits too
export interface Transactional<Tx> {
  transaction<T>(fn: (tx: Tx) => Promise<T>, config?: { accessMode?: "read only" | "read write" }): Promise<T>;
}

// Runs fn in a Drizzle transaction as the user: every query of tx goes through the policies, and the settings end with
// the transaction, so a pooled connection never keeps the identity of a previous request
export const withUser = <Tx extends { execute(query: any): unknown }, T>(
  db: Transactional<Tx>,
  identity: Identity,
  userId: UserId,
  fn: (tx: Tx) => Promise<T>,
  options: RunOptions = {},
): Promise<T> =>
  db.transaction(async (tx) => {
    const settings = identity.settings(userId, options).map(([name, value]) => sql`set_config(${name}, ${value}, true)`);
    await tx.execute(sql`select ${sql.join(settings, sql`, `)}`);
    return fn(tx);
  }, { accessMode: options.readOnly ? "read only" : "read write" });
