import { sql, type Kysely, type Transaction } from "kysely";
import type { Identity, RunOptions, UserId } from "@p9s/postgres";

// Runs fn in a Kysely transaction as the user: every query of trx goes through the policies, and the settings end with
// the transaction, so a pooled connection never keeps the identity of a previous request
export const withUser = <DB, T>(
  db: Kysely<DB>,
  identity: Identity,
  userId: UserId,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: RunOptions = {},
): Promise<T> =>
  db.transaction().execute(async trx => {
    // With transaction_read_only rather than the access mode of the transaction, which some dialects leave out
    const settings = identity.settings(userId, options).map(([name, value]) => sql`set_config(${name}, ${value}, true)`);
    await sql`select ${sql.join(settings)}`.execute(trx);
    return fn(trx);
  });
