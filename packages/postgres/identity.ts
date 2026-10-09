import { getCompleteConfig, type Config } from "@p9s/core";

// What a transaction needs to act as an application user: the database role the policies are for, and the setting
// that the current user function of the migration reads, from `engine.authentication.setting`. Both are set with
// set_config(..., true), so that they end with the transaction, and a pooled connection never keeps the identity of a
// previous request.

export interface UserOptions {
  // A role of engine.users or engine.graphWriters, the first of engine.users by default
  role?: string;
  // Other settings of the transaction, like those an audit trigger reads
  settings?: Record<string, string | number | boolean | null | undefined>;
}

export interface RunOptions extends UserOptions {
  readOnly?: boolean;
}

// What clients of node-postgres, Neon serverless and PGlite have. A pool of node-postgres also connects with a
// callback, and TypeScript infers from that last overload, so the client of run is this type for them
export interface Queryable {
  query<Row = any>(text: string, values?: any[]): Promise<{ rows: Row[] }>;
}

export interface PoolLike<Client extends Queryable> {
  connect(): Promise<Client & { release(error?: Error | boolean): void }>;
}

export type UserId = string | number | bigint | null | undefined;

export interface Identity {
  // The role transactions take by default, and the setting the current user function reads
  role: string;
  setting: string;
  // The settings of a transaction of the user, as [name, value] pairs, the role first
  settings(userId: UserId, options?: UserOptions): [string, string][];
  // The same as an object, for servers that set the settings of each request themselves, like the pgSettings of
  // PostGraphile, with transaction_read_only for a read only transaction
  pgSettings(userId: UserId, options?: RunOptions): Record<string, string>;
  // The statement to run first in a transaction: select set_config($1, $2, true), set_config($3, $4, true)...
  statement(userId: UserId, options?: UserOptions): { text: string; values: string[] };
  // Runs fn in a transaction on a connection of the pool, as the user: commits when it returns, rolls back when it
  // throws. No user, or null, reads as no one.
  run<Client extends Queryable, T>(pool: PoolLike<Client>, userId: UserId, fn: (client: Client) => Promise<T>, options?: RunOptions): Promise<T>;
}

// Whether an error is Postgres refusing a statement to the user, with insufficient_privilege: a row the policies do not
// let through, a statement the role has no privilege for, or a share of bits the user does not have. Clients wrap the
// error of Postgres: node-postgres gives it as is, Drizzle as its cause, and Prisma in its meta.
export const isRefused = (error: unknown): boolean => {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 8; depth++) {
    const { code, cause, meta } = current as { code?: unknown, cause?: unknown, meta?: { driverAdapterError?: { cause?: unknown } } };
    if (code === "42501") return true;
    current = meta?.driverAdapterError?.cause ?? cause;
  }
  return false;
};

export interface IdentityOptions {
  // The setting the current user function reads, when the migration does not create that function, like
  // request.jwt.claim.sub, which auth.uid() of Supabase reads. engine.authentication.setting by default.
  setting?: string;
}

// Only the engine of the config counts, so that a config read from JSON fits too, whose tables and links TypeScript
// types too loosely for Config
export interface IdentityConfig {
  engine?: {
    users?: readonly string[];
    graphWriters?: readonly string[];
    authentication?: { getCurrentUserId?: string; setting?: string };
  };
  [key: string]: unknown;
}

export const createIdentity = (config: IdentityConfig, options: IdentityOptions = {}): Identity => {
  const { engine } = getCompleteConfig({ engine: config.engine } as Config<string>);
  const setting = options.setting ?? engine.authentication.setting;
  if (!setting) {
    throw new Error("p9s: set engine.authentication.setting, like \"app.user_id\", for the migration to read the current user from it, or pass the setting the current user function reads");
  }
  const [role] = engine.users;
  if (!role) throw new Error("p9s: engine.users is empty");
  const roles = new Set<string>([...engine.users, ...engine.graphWriters]);

  const settings = (userId: UserId, options: UserOptions = {}): [string, string][] => {
    const chosen = options.role ?? role;
    if (!roles.has(chosen)) throw new Error(`p9s: ${chosen} is not a role of engine.users or engine.graphWriters`);
    return [
      ["role", chosen],
      [setting, userId == null ? "" : String(userId)],
      ...Object.entries(options.settings ?? {}).map(([name, value]): [string, string] => [name, value == null ? "" : String(value)]),
    ];
  };

  const pgSettings = (userId: UserId, options: RunOptions = {}) => ({
    ...Object.fromEntries(settings(userId, options)),
    ...(options.readOnly ? { transaction_read_only: "on" } : {}),
  });

  const statement = (userId: UserId, options: UserOptions = {}) => {
    const pairs = settings(userId, options);
    return {
      text: `select ${pairs.map((_, i) => `set_config($${2 * i + 1}, $${2 * i + 2}, true)`).join(", ")}`,
      values: pairs.flat(),
    };
  };

  const run = async <Client extends Queryable, T>(pool: PoolLike<Client>, userId: UserId, fn: (client: Client) => Promise<T>, options: RunOptions = {}) => {
    const { text, values } = statement(userId, options);
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
      await client.query(options.readOnly ? "begin read only" : "begin");
      await client.query(text, values);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      // A connection that cannot roll back is closed rather than given to another request
      await client.query("rollback").catch((rollbackError: Error) => { broken = rollbackError; });
      throw error;
    } finally {
      client.release(broken);
    }
  };

  return { role, setting, settings, pgSettings, statement, run };
};
