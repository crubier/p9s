import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createIdentity } from "@p9s/postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { withUser } from "../identity.ts";

const identity = createIdentity({
  engine: { users: ["app_user"], authentication: { getCurrentUserId: "current_user_id", setting: "app.user_id" } },
  tables: [],
});

const database = async () => {
  const db = drizzle(new PGlite());
  await db.execute(sql`create role app_user`);
  await db.execute(sql`create table note (name text)`);
  await db.execute(sql`grant select, insert on note to app_user`);
  return db;
};

const whoAmI = sql`select current_user as role, current_setting('app.user_id', true) as user_id, current_setting('app.trace', true) as trace`;

describe("withUser", () => {
  test("runs the transaction as the user, with nothing left after it", async () => {
    const db = await database();
    const { rows } = await withUser(db, identity, 7, tx => tx.execute(whoAmI), { settings: { "app.trace": "t1" } });
    expect(rows).toEqual([{ role: "app_user", user_id: "7", trace: "t1" }]);
    const { rows: after } = await db.execute(whoAmI);
    expect(after[0]?.role).toBe("postgres");
    expect(after[0]?.user_id || null).toBeNull();
  });

  test("commits when fn returns, rolls back when it throws, refuses writes when read only", async () => {
    const db = await database();
    await withUser(db, identity, 1, tx => tx.execute(sql`insert into note values ('kept')`));
    await expect(withUser(db, identity, 1, async tx => {
      await tx.execute(sql`insert into note values ('dropped')`);
      throw new Error("the request failed");
    })).rejects.toThrow("the request failed");
    await expect(withUser(db, identity, 1, tx => tx.execute(sql`insert into note values ('read only')`), { readOnly: true }))
      .rejects.toThrow();
    const { rows } = await db.execute(sql`select name from note`);
    expect(rows).toEqual([{ name: "kept" }]);
  });
});
