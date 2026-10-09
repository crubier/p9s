import { expect, describe, test, beforeAll, beforeEach, afterEach } from 'bun:test'
import { $ } from "bun";
import { PrismaPg } from "@prisma/adapter-pg";
import { query as sql, raw } from "pg-sql2";
import { createIdentity } from "@p9s/postgres";
import { setupTests, testDatabaseUrl } from '@p9s/postgres-testing';
import { createMigration } from '../../postgres/generation.ts';
import { FIRST_GENERATED_ID, bits, blogMigrationConfig, setupBlogTables } from '../../postgres/test/helpers.ts';
import { userClient, withUser } from '../identity.ts';
import type { PrismaClient } from "./generated/client.ts";

beforeAll(async () => {
  await $`bun run generate`.cwd(`${import.meta.dir}/..`).quiet();
});

describe.skipIf(!testDatabaseUrl)('Prisma as a user (real Postgres only)', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  const config = () => {
    const blog = blogMigrationConfig(context);
    return { ...blog, engine: { ...blog.engine, authentication: { getCurrentUserId: "app_user_id", setting: "app.user_id" } } };
  };

  // Posts 'first' and 'second' in group 1, which role 1 may read and write, 'other' in group 2, which role 2 may only read
  const load = async () => {
    await setupBlogTables(context);
    await context.exec(createMigration(config()));
    await context.exec(sql`
      select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});
      insert into "resource_group" ("id", "parent_id") values (1, null), (2, null);
      insert into "role_group" ("id", "parent_id") values (1, null), (2, null);
      insert into "blog_post" ("group_id", "name") values (1, 'first'), (1, 'second'), (2, 'other');
      insert into "assignment_edge" ("resource_id", "role_id", "permission") values (1, 1, ${bits("1111")}), (2, 2, ${bits("1000")});`);
    const { PrismaClient: Client } = await import("./generated/client.ts");
    const url = new URL(testDatabaseUrl!);
    url.username = context.database_admin_username;
    url.password = context.database_admin_password;
    url.pathname = `/${context.database_name}`;
    return new Client({ adapter: new PrismaPg({ connectionString: url.toString() }) }) as PrismaClient;
  };

  test('userClient runs every query as the user, and leaves nothing on the connection', async () => {
    const prisma = await load();
    try {
      const identity = createIdentity(config());
      const one = userClient(prisma, identity, 1);
      expect((await one.blogPost.findMany({ orderBy: { name: "asc" } })).map(post => post.name)).toEqual(["first", "second"]);
      expect(await userClient(prisma, identity, 2).blogPost.count()).toBe(1);
      await one.blogPost.create({ data: { name: "third", groupId: 1 } });
      await expect(Promise.resolve(userClient(prisma, identity, 2).blogPost.create({ data: { name: "refused", groupId: 2 } }))).rejects.toThrow();
      await expect(Promise.resolve(userClient(prisma, identity, 1, { readOnly: true }).blogPost.create({ data: { name: "read only", groupId: 1 } }))).rejects.toThrow(/read-only/);
      // The client it extends is still the owner, which the policies do not apply to
      expect(await prisma.blogPost.count()).toBe(4);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('withUser runs several queries in one transaction as the user, and rolls back when fn throws', async () => {
    const prisma = await load();
    try {
      const identity = createIdentity(config());
      const names = await withUser(prisma, identity, 1, async tx => {
        await tx.blogPost.create({ data: { name: "kept", groupId: 1 } });
        return (await tx.blogPost.findMany({ orderBy: { name: "asc" } })).map(post => post.name);
      });
      expect(names).toEqual(["first", "kept", "second"]);
      await expect(withUser(prisma, identity, 1, async tx => {
        await tx.blogPost.create({ data: { name: "dropped", groupId: 1 } });
        throw new Error("the request failed");
      })).rejects.toThrow("the request failed");
      await expect(withUser(prisma, identity, 1, tx => tx.blogPost.create({ data: { name: "read only", groupId: 1 } }), { readOnly: true })).rejects.toThrow(/read-only/);
      expect((await prisma.blogPost.findMany({ orderBy: { name: "asc" } })).map(post => post.name)).toEqual(["first", "kept", "other", "second"]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
