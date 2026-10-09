import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createIdentity } from "@p9s/postgres";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { withUser } from "../identity.ts";

interface Database { note: { name: string } }

const identity = createIdentity({
  engine: { users: ["app_user"], authentication: { getCurrentUserId: "current_user_id", setting: "app.user_id" } },
  tables: [],
});

const database = async () => {
  const db = new Kysely<Database>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create role app_user`.execute(db);
  await sql`create table note (name text)`.execute(db);
  await sql`grant select, insert on note to app_user`.execute(db);
  return db;
};

const whoAmI = sql<{ role: string, user_id: string | null, trace: string | null }>`select current_user as role, current_setting('app.user_id', true) as user_id, current_setting('app.trace', true) as trace`;

describe("withUser", () => {
  test("runs the transaction as the user, with nothing left after it", async () => {
    const db = await database();
    const { rows } = await withUser(db, identity, 7, trx => whoAmI.execute(trx), { settings: { "app.trace": "t1" } });
    expect(rows).toEqual([{ role: "app_user", user_id: "7", trace: "t1" }]);
    const { rows: after } = await whoAmI.execute(db);
    expect(after[0]?.role).toBe("postgres");
    expect(after[0]?.user_id || null).toBeNull();
  });

  test("commits when fn returns, rolls back when it throws, refuses writes when read only", async () => {
    const db = await database();
    await withUser(db, identity, 1, trx => trx.insertInto("note").values({ name: "kept" }).execute());
    await expect(withUser(db, identity, 1, async trx => {
      await trx.insertInto("note").values({ name: "dropped" }).execute();
      throw new Error("the request failed");
    })).rejects.toThrow("the request failed");
    await expect(withUser(db, identity, 1, trx => trx.insertInto("note").values({ name: "read only" }).execute(), { readOnly: true }))
      .rejects.toThrow();
    expect(await db.selectFrom("note").select("name").execute()).toEqual([{ name: "kept" }]);
  });
});
