import { expect, describe, test, beforeEach, afterEach } from 'bun:test'
import { query as sql, raw } from "pg-sql2";
import { setupTests } from '@p9s/postgres-testing';
import { createMigration } from '../generation';
import { blogMigrationConfig, setupBlogTables, type TestContext } from './helpers';

// The objects of the application, which p9s leaves as they are
const APP_RELATIONS = ["resource_group", "role_group", "blog_post", "blog_comment", "api_key", "blog_post_id_seq", "blog_comment_id_seq", "api_key_id_seq"];
const APP_FUNCTIONS = ["current_role_id"];

// What a role may do with the tables, views, sequences and functions of p9s, privileges of PUBLIC included
const privilegesOf = async (context: TestContext, role: string) => {
  const [rows] = await context.runTestQuery(sql`
    select "the_privilege" from (
      select format('%s %s', "c"."relname", "p"."privilege") as "the_privilege"
      from pg_class "c", unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as "p" ("privilege")
      where "c"."relnamespace" = 'public'::regnamespace and "c"."relkind" in ('r', 'v', 'm', 'p') and "c"."relname" <> all(${raw(`array['${APP_RELATIONS.join("', '")}']`)})
      and has_table_privilege(${raw(`'${role}'`)}, "c"."oid", "p"."privilege")
      union all
      select format('%s %s', "c"."relname", "p"."privilege")
      from pg_class "c", unnest(array['USAGE', 'SELECT', 'UPDATE']) as "p" ("privilege")
      where "c"."relnamespace" = 'public'::regnamespace and "c"."relkind" = 'S' and "c"."relname" <> all(${raw(`array['${APP_RELATIONS.join("', '")}']`)})
      and has_sequence_privilege(${raw(`'${role}'`)}, "c"."oid", "p"."privilege")
      union all
      select format('%s execute', "f"."oid"::regprocedure)
      from pg_proc "f"
      where "f"."pronamespace" = 'public'::regnamespace and "f"."proname" <> all(${raw(`array['${APP_FUNCTIONS.join("', '")}']`)})
      and not exists (select from pg_depend "d" where "d"."objid" = "f"."oid" and "d"."deptype" = 'e')
      and has_function_privilege(${raw(`'${role}'`)}, "f"."oid", 'EXECUTE')
    ) as "the_privileges" order by 1`);
  return rows.map((row: { the_privilege: string }) => row.the_privilege) as string[];
};

describe('privileges of other roles on p9s objects', () => {
  const { setup, teardown, context } = setupTests();
  beforeEach(setup);
  afterEach(teardown);

  // The writer role of the tests stands for a role the config does not name, like anon on Supabase
  const configWithoutWriters = () => {
    const config = blogMigrationConfig(context);
    return { ...config, engine: { ...config.engine, graphWriters: [] } };
  };
  const roles = () => raw(`"${context.database_user_username}", "${context.database_writer_username}"`);

  test('default privileges of other roles do not reach the objects p9s creates', async () => {
    await setupBlogTables(context);
    await context.exec(sql`
      alter default privileges in schema "public" grant all on tables to ${roles()};
      alter default privileges in schema "public" grant all on sequences to ${roles()};
      alter default privileges in schema "public" grant execute on functions to ${roles()};`);
    await context.exec(createMigration(configWithoutWriters()));
    expect(await privilegesOf(context, context.database_writer_username)).toEqual([]);
    const user = await privilegesOf(context, context.database_user_username);
    expect(user.filter(privilege => /^(resource|role|assignment)_edge(_cache)? /.test(privilege))).toEqual([]);
    expect(user.filter(privilege => / (INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)$/.test(privilege) && !privilege.startsWith("current_assignment "))).toEqual([]);
    expect(user).not.toContain(`resource_edge_cache_backfill() execute`);
  });

  test('running the migration again takes back what was granted on p9s objects since', async () => {
    await setupBlogTables(context);
    await context.exec(createMigration(configWithoutWriters()));
    const user = await privilegesOf(context, context.database_user_username);
    expect(await privilegesOf(context, context.database_writer_username)).toEqual([]);
    await context.exec(sql`
      grant all on all tables in schema "public" to ${roles()};
      grant all on all sequences in schema "public" to ${roles()};
      grant execute on all functions in schema "public" to ${roles()};`);
    expect((await privilegesOf(context, context.database_writer_username)).length).toBeGreaterThan(0);
    await context.exec(createMigration(configWithoutWriters()));
    expect(await privilegesOf(context, context.database_writer_username)).toEqual([]);
    expect(await privilegesOf(context, context.database_user_username)).toEqual(user);
  });
});
