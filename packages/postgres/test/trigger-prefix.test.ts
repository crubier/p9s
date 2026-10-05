import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { createMigration } from '../generation';
import { setupTests } from '@p9s/postgres-testing';
import { FIRST_GENERATED_ID, blogMigrationConfig, cacheMismatches, noMismatches, setupBlogTables, type TestContext } from './helpers';

const tables = ["resource_group", "role_group", "blog_post", "blog_comment", "api_key", "resource_edge", "role_edge", "assignment_edge"];

const migrate = (context: TestContext, triggerPrefix?: string) => {
  const config = blogMigrationConfig(context);
  return context.exec(createMigration({ ...config, engine: { ...config.engine, naming: triggerPrefix === undefined ? {} : { triggerPrefix } } }));
};

const setupBlogWithoutPrefix = async (context: TestContext) => {
  await setupBlogTables(context);
  await migrate(context);
  await context.exec(sql`
    select setval('resource_id_seq', ${raw(String(FIRST_GENERATED_ID))});
    select setval('role_id_seq', ${raw(String(FIRST_GENERATED_ID))});`);
};

const triggers = async (context: TestContext) => {
  const [rows] = await context.runTestQuery(sql`
    select "tgrelid"::regclass::text || ': ' || "tgname" as "trigger" from pg_trigger
    where "tgrelid" in (${raw(tables.map(table => `'${table}'::regclass`).join(", "))}) and not "tgisinternal"
    order by 1`);
  return rows.map((row: { trigger: string }) => row.trigger) as string[];
};

// An application trigger that runs after inserts on blog_post, and notes whether p9s already gave the post its edge
const addApplicationTrigger = (context: TestContext) => context.exec(sql`
  create table "app_log" ("post_has_edge" boolean);
  create function "app_log_function"() returns trigger language plpgsql as $$
  begin
    insert into "app_log" select exists (select from "resource_edge" join "p9s_new_rows" on "resource_edge"."child_id" = "p9s_new_rows"."resource_id");
    return null;
  end $$;
  create trigger "m_app_log" after insert on "blog_post" referencing new table as "p9s_new_rows" for each statement execute function "app_log_function"();`);

const postHasEdgeWhenAppTriggerRuns = async (context: TestContext) => {
  await context.exec(sql`delete from "app_log"; insert into "blog_post" ("group_id") values (1);`);
  const [[{ post_has_edge }]] = await context.runTestQuery(sql`select "post_has_edge" from "app_log"`);
  return post_has_edge;
};

describe('trigger prefix', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  test('orders p9s triggers with the triggers of the application', async () => {
    await setupBlogWithoutPrefix(context);
    await context.exec(sql`insert into "resource_group" ("id") values (1)`);
    await addApplicationTrigger(context);
    // "10_blog_post_resource_insert_trigger" runs before "m_app_log", "z_10_..." after it
    expect(await postHasEdgeWhenAppTriggerRuns(context)).toBe(true);
    await migrate(context, "z_");
    expect(await postHasEdgeWhenAppTriggerRuns(context)).toBe(false);
    expect((await triggers(context)).filter(name => !name.includes(": z_"))).toEqual(["blog_post: m_app_log"]);
  });

  test('changing the prefix renames the p9s triggers instead of adding new ones', async () => {
    await setupBlogWithoutPrefix(context);
    await addApplicationTrigger(context);
    const before = await triggers(context);
    expect(before.length).toBeGreaterThan(20);

    await migrate(context, "p9s_");
    const renamed = await triggers(context);
    expect(renamed).toEqual(before.map(name => name.replace(/: (\d\d_)/, ": p9s_$1")).sort());

    // Back to no prefix, and a second run changes nothing
    await migrate(context, "");
    await migrate(context);
    expect(await triggers(context)).toEqual(before);

    await context.exec(sql`
      insert into "resource_group" ("id", "parent_id") values (1, null), (2, 1);
      insert into "blog_post" ("group_id") values (2);
      update "resource_group" set "parent_id" = null where "id" = 2;`);
    expect(await cacheMismatches(context, "none")).toEqual(noMismatches);
  });
});
