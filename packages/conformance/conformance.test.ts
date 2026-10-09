// The conformance suite for createIdentity of @p9s/postgres, as every package of p9s runs it, see README.md
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { createIdentity, isRefused, type Queryable } from "@p9s/postgres";
import cases from "./cases.json";
import config from "./p9s.config.json";

const url = process.env.P9S_CONFORMANCE_DATABASE_URL;

describe.skipIf(!url)("conformance of @p9s/postgres", () => {
  const users = createIdentity(config);
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  afterAll(() => pool.end());

  test("the role and the setting come from the config", () => {
    expect([users.role, users.setting]).toEqual([cases.role, cases.setting]);
  });

  test("each user reads their rows, on one connection, in turns", async () => {
    for (const _ of [1, 2]) {
      for (const { user, ids } of cases.reads) {
        const rows = await users.run(pool, user, async client => (await client.query<{ id: number }>(cases.read)).rows, { readOnly: true });
        expect(rows.map(row => row.id)).toEqual(ids);
      }
    }
  });

  test("insert ... returning works", async () => {
    const [row] = await users.run(pool, cases.insert.user, async client => (await client.query<{ id: number, folder_id: number }>(cases.insert.sql)).rows);
    expect(row!.folder_id).toBe(cases.insert.folderId);
    expect(row!.id).toBeGreaterThan(3);
  });

  test("a refused write is an error", async () => {
    const error = await users.run(pool, cases.refused.user, client => client.query(cases.refused.sql)).catch((error: unknown) => error);
    expect(isRefused(error)).toBe(true);
  });

  test("a rolled back transaction leaves nothing on the connection", async () => {
    const who = async (client: Queryable) => (await client.query<{ role: string, user_id: string }>(cases.who)).rows[0]!;
    const inside = await users.run(pool, cases.whoUser, async client => {
      const row = await who(client);
      throw Object.assign(new Error("rolled back"), { row });
    }).catch((error: { row: unknown }) => error.row);
    expect(inside).toEqual({ role: cases.role, user_id: String(cases.whoUser) });

    const client = await pool.connect();
    try {
      const after = await who(client);
      expect(after.role).not.toBe(cases.role);
      expect(after.user_id).toBe("");
    } finally {
      client.release();
    }
  });
});
