import type { PoolClient } from "pg";
import { pool } from "./db";
import { ADMIN, COMMENTER, EDITOR, MANAGER, MEMBER } from "./p9s";

// Acme: Alice administers it, Bob is in Engineering, Carol in Design, and Dave, a contractor, only sees one task
export const PEOPLE = ["alice", "bob", "carol", "dave"] as const;
export type Person = (typeof PEOPLE)[number];

const one = async <T>(client: PoolClient, text: string, values: unknown[] = []) => (await client.query(text, values)).rows[0] as T;

export const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // As the owner, which bypasses RLS: rows without parent, like organizations, have no one above them to check
    const org = await one<{ id: string; resource_id: string; role_id: string }>(client,
      `insert into organization (name) values ('Acme') returning id, resource_id, role_id`);
    const people = {} as Record<Person, { id: string; roleId: string }>;
    for (const name of PEOPLE) {
      const row = await one<{ id: string; role_id: string }>(client,
        `insert into person (org_id, name, email) values ($1, $2, $3) returning id, role_id`,
        [org.id, name[0]!.toUpperCase() + name.slice(1), `${name}@acme.test`]);
      people[name] = { id: row.id, roleId: row.role_id };
    }
    const team = async (name: string, members: Person[]) => {
      const row = await one<{ id: string; role_id: string }>(client, `insert into team (org_id, name) values ($1, $2) returning id, role_id`, [org.id, name]);
      for (const member of members) {
        await client.query(`insert into role_edge (parent_id, child_id, permission) values ($1, $2, b'11111111')`, [row.role_id, people[member].roleId]);
      }
      return row;
    };
    const engineering = await team("Engineering", ["bob"]);
    const design = await team("Design", ["carol"]);

    const project = (name: string) => one<{ id: string; resource_id: string }>(client,
      `insert into project (org_id, name) values ($1, $2) returning id, resource_id`, [org.id, name]);
    const task = (projectId: string, title: string, assignee?: Person) => one<{ id: string; resource_id: string }>(client,
      `insert into task (project_id, title, assignee_id) values ($1, $2, $3) returning id, resource_id`, [projectId, title, assignee ? people[assignee].id : null]);
    const website = await project("Website");
    const brand = await project("Brand");
    const hiring = await project("Hiring");
    const login = await task(website.id, "Fix the login bug", "bob");
    await task(website.id, "New landing page", "carol");
    await task(brand.id, "Logo refresh", "carol");
    await task(hiring.id, "Interview plan", "alice");
    await client.query(`insert into comment (task_id, author_id, body) values ($1, $2, 'Reproduced on Safari')`, [login.id, people.bob.id]);

    const assign = (resourceId: string, roleId: string, permission: string) =>
      client.query(`insert into assignment_edge (resource_id, role_id, permission) values ($1, $2, $3::bit(8))`, [resourceId, roleId, permission]);
    // Everyone at Acme sees its people and teams, admins see and manage everything
    await assign(org.resource_id, org.role_id, MEMBER);
    await assign(org.resource_id, people.alice.roleId, ADMIN);
    await assign(website.resource_id, engineering.role_id, EDITOR);
    await assign(website.resource_id, design.role_id, COMMENTER);
    await assign(brand.resource_id, design.role_id, MANAGER);
    await assign(login.resource_id, people.dave.roleId, COMMENTER);
    await client.query("commit");
    return { org, people, projects: { website, brand, hiring }, tasks: { login } };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

if (import.meta.main) {
  await seed();
  await pool.end();
  console.log("Seeded Acme: alice, bob, carol and dave at acme.test");
}
