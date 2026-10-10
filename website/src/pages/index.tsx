import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import { CodeWindow, type CodeTab } from '@site/src/components/landing/CodeWindow';
import { PermissionGraph } from '@site/src/components/landing/PermissionGraph';
import { Logo } from '@site/src/components/landing/Logo';
import { stacks } from '@site/src/components/landing/stacks';
import {
  siElixir,
  siGo,
  siNeon,
  siPhp,
  siPostgresql,
  siPython,
  siRuby,
  siRust,
  siSupabase,
  siTypescript,
} from 'simple-icons';
import {
  ArrowIcon,
  BitsIcon,
  BoltIcon,
  CodeIcon,
  EyeOffIcon,
  GitHubIcon,
  GraphQLIcon,
  LayersIcon,
  LinkIcon,
  MigrationIcon,
  ShareIcon,
  ShieldIcon,
  TreeIcon,
} from '@site/src/components/landing/icons';
import styles from '@site/src/components/landing/landing.module.css';

const heroTabs: CodeTab[] = [
  {
    label: 'p9s.config.json',
    language: 'json',
    code: `
{
  "$schema": "https://p9s.vercel.app/p9s.config.schema.json",
  "engine": {
    "users": ["app_user"],
    "authentication": { "setting": "app.user_id", "key": { "table": "member", "column": "id" } },
    "grantPrivileges": true,
    "permission": { "bitmap": { "size": 8, "names": { "read": 0, "edit": 2, "share": 5 } } }
  },
  "tables": [
    { "name": "team", "isRole": true, "roleId": "role_id" },
    { "name": "member", "isRole": true, "roleId": "role_id" },
    { "name": "folder", "isResource": true, "resourceId": "resource_id",
      "resourceParent": { "column": "parent_id", "table": "folder", "key": "id" },
      "permission": { "app_user": { "select": 0, "update": 2, "share": 5 } } },
    { "name": "document", "isResource": true, "resourceId": "resource_id",
      "resourceParent": { "column": "folder_id", "table": "folder", "key": "id" },
      "permission": { "app_user": { "select": 0, "update": 2, "share": 5 } } }
  ],
  "links": [
    { "name": "team_member", "kind": "role",
      "parent": { "column": "team_id", "table": "team", "key": "id" },
      "child": { "column": "member_id", "table": "member", "key": "id" } },
    { "name": "folder_share", "kind": "assignment",
      "resource": { "column": "folder_id", "table": "folder", "key": "id" },
      "role": { "column": "team_id", "table": "team", "key": "id" },
      "permission": { "column": "access",
        "values": { "viewer": ["read"], "editor": ["read", "edit", "share"] } } }
  ]
}`,
    caption: 'Your tables, and the memberships and shares you already keep, with completion in any editor',
  },
  {
    label: 'terminal',
    language: 'bash',
    code: `
$ npx @p9s/cli postgres migrate
Migrated: p9s 0.1.0, migration f23b1ec9a7e2d56e

# Once more: nothing to do
$ npx @p9s/cli postgres migrate
Up to date: p9s 0.1.0, migration f23b1ec9a7e2d56e

# Or as a migration of Alembic, Django, Rails, goose, sqlx, Ecto or Laravel
$ npx @p9s/cli postgres generate --format rails
Migration written to: db/migrate/20261010002809_p9s_f23b1ec9.rb

# No Node? The same CLI, as a single binary
$ curl -fsSL -o p9s https://github.com/crubier/p9s/releases/latest/download/p9s-linux-x64
$ chmod +x p9s && ./p9s postgres status
Up to date: p9s 0.1.0, migration f23b1ec9a7e2d56e`,
    caption: 'One command, one transaction: your existing shares come along',
  },
  {
    label: 'p9s.sql',
    language: 'sql',
    code: `
-- Generated: a policy per table, operation and user role
create policy "document_app_user_select_policy" on "document"
as permissive for select to "app_user"
using (
  exists (
    select from "current_resource_access_0" as "access"
    where "access"."resource_id" = "document"."resource_id"
  )
);

-- Triggers keep every transitive permission cached, so the
-- policies above are index lookups, not recursive queries
create trigger "10_resource_edge_insert_trigger"
after insert on "resource_edge" referencing new table as "p9s_new_rows"
for each statement execute function "resource_edge_insert_trigger_function"();`,
    caption: 'One migration you can read, review, commit and run again',
  },
  {
    label: 'query.sql',
    language: 'sql',
    code: `
-- Bob's request: who he is, for this transaction
select set_config('role', 'app_user', true),
       set_config('app.user_id', :bob, true);

-- Plain SQL. RLS returns what Bob can read, nothing else
select title from document order by updated_at desc limit 50;

update document set title = 'Hiring plan v2' where id = :hiring_plan;
-- UPDATE 0: Bob can read it, not edit it

select (permission_flags(resource_permission(resource_id))).*
from document where id = :hiring_plan;
--  bitmap   | read | edit | share
--  10001000 | t    | f    | f`,
    caption: 'The packages of every stack run this for you: Postgres checks every row',
  },
  {
    label: 'GraphQL',
    language: 'graphql',
    code: `
# PostGraphile, with engine.postgraphile: true
{
  allDocuments(first: 50, orderBy: UPDATED_AT_DESC) {
    totalCount
    nodes {
      title
      permission { read edit share }
      comments { nodes { body } }
    }
  }
}`,
    caption: 'A GraphQL API without a single resolver, filtered by RLS',
  },
];

const anywhereTabs: CodeTab[] = [
  {
    label: 'Drizzle',
    language: 'typescript',
    code: `
import { createIdentity } from "@p9s/postgres";
import { withUser } from "@p9s/drizzle";
import config from "./p9s.config.json";

const users = createIdentity(config);

// A server action: no permission check in sight, and none forgotten.
// Every query of the transaction runs as the member, through RLS
export async function renameDocument(id: string, title: string) {
  const member = await currentMember();
  const [renamed] = await withUser(db, users, member.id, (tx) =>
    tx.update(document).set({ title }).where(eq(document.id, id)).returning());
  if (!renamed) throw new Forbidden(); // readable, not editable: no row
  return renamed;
}`,
  },
  {
    label: 'Sharing',
    language: 'sql',
    code: `
-- Users share what they have the share bit on, with bits they have
select resource_share(:folder, :erin, b'10001000');

-- Who has access, and where it comes from, for anyone who can read it
select role_id, assigned_resource_id, permission
from resource_access where resource_id = :folder;

-- Revoking is checked the same way
select resource_unshare(:folder, :erin);`,
  },
  {
    label: 'GraphQL',
    language: 'graphql',
    code: `
query Folder($id: UUID!) {
  folderByRowId(rowId: $id) {
    name
    permission { bitmap read edit share }
    documents { nodes { title permission { edit } } }
  }
}

mutation Share($folder: UUID!, $team: UUID!) {
  resourceShare(input: {
    theResourceId: $folder, theRoleId: $team, thePermission: "10001000"
  }) { clientMutationId }
}`,
  },
];

type Feature = { icon: ReactNode; title: string; body: ReactNode; to?: string };

const features: Feature[] = [
  {
    icon: <BoltIcon />,
    title: 'Smart recursive caching',
    body: (
      <>
        Every transitive permission is cached and kept exact on each write, so a policy is an index lookup. Pages and
        counts take about a millisecond through RLS.
      </>
    ),
    to: '/docs/benchmarks',
  },
  {
    icon: <TreeIcon />,
    title: 'Trees of the rows you have',
    body: (
      <>
        Folders in folders, members in teams in organizations. Your tables are the nodes, a parent column is the edge:
        creating, moving or deleting a row is a plain <code>insert</code>, <code>update</code> or <code>delete</code>.
      </>
    ),
    to: '/docs/configuration/overview#parent-columns',
  },
  {
    icon: <ShieldIcon />,
    title: 'Enforced by Postgres',
    body: (
      <>
        A <code>select</code>, <code>insert</code>, <code>update</code> and <code>delete</code> policy per table. Your
        ORM, psql, a GraphQL server and the 2 a.m. migration script all get the same answer.
      </>
    ),
    to: '/docs/configuration/security-model',
  },
  {
    icon: <ShareIcon />,
    title: 'Sharing without escalation',
    body: (
      <>
        Users share what they have the <code>share</code> bit on, with bits they have, and nothing more. They can take
        back what an editor gave, not what the admins gave.
      </>
    ),
    to: '/docs/configuration/security-model#sharing',
  },
  {
    icon: <BitsIcon />,
    title: 'Bits, with names',
    body: (
      <>
        Up to 1024 permission bits per edge: AND along a path, OR across paths. Name them, and SQL and GraphQL answer{' '}
        <code>{'{ read: true, edit: false }'}</code>.
      </>
    ),
    to: '/docs/configuration/postgraphile',
  },
  {
    icon: <EyeOffIcon />,
    title: 'The graph stays private',
    body: (
      <>
        Users never read edges or assignments. They see their own part of the graph through views: what they can
        access, and who else can access what they read.
      </>
    ),
    to: '/docs/configuration/security-model#what-users-see-of-the-graph',
  },
  {
    icon: <LayersIcon />,
    title: 'Leaves, keys and soft delete',
    body: (
      <>
        Comments take the permissions of their document, API keys act as their member, and a soft-deleted folder hides
        what is below it until it comes back.
      </>
    ),
    to: '/docs/configuration/overview#leaf-tables',
  },
  {
    icon: <CodeIcon />,
    title: 'One command, no Node needed',
    body: (
      <>
        <code>p9s postgres migrate</code> runs in one transaction and again does nothing. The CLI also ships as a
        single binary for Linux, macOS and Windows. Plain SQL: no extension, no service.
      </>
    ),
    to: '/docs/packages/cli',
  },
  {
    icon: <LinkIcon />,
    title: 'Keeps the shares you have',
    body: (
      <>
        Name your tables of memberships and shares, and the migration brings their rows into the graph. Your app keeps
        writing them, and p9s checks a share gives no more than its author has.
      </>
    ),
    to: '/docs/integrations/adopting#the-config',
  },
  {
    icon: <MigrationIcon />,
    title: 'Runs with your migrations',
    body: (
      <>
        <code>--format</code> writes the migration for Alembic, Django, Rails, goose, sqlx, Ecto or Laravel, so p9s
        runs with the others, in their order.
      </>
    ),
    to: '/docs/packages/cli#in-the-format-of-a-migration-tool',
  },
  {
    icon: <GraphQLIcon />,
    title: 'GraphQL ready',
    body: (
      <>
        With <code>postgraphile: true</code>, PostGraphile serves the graph: node views with their keys, a permission
        field on every type, and the internals hidden.
      </>
    ),
    to: '/docs/configuration/postgraphile',
  },
  {
    icon: <Logo icon={siSupabase} size={22} />,
    title: 'Supabase preset',
    body: (
      <>
        <code>authenticated</code>, <code>auth.uid()</code> and <code>service_role</code> out of the box, so
        supabase-js and PostgREST read and write through the policies of the graph.
      </>
    ),
    to: '/docs/integrations/supabase',
  },
];

type Comparison = {
  label: string;
  unit: 'ms' | 'tx/s';
  p9s: [name: string, value: number];
  other: [name: string, value: number];
};

const comparisons: { title: string; rows: Comparison[] }[] = [
  {
    title: 'Reads through RLS, against a policy that walks the trees',
    rows: [
      { label: 'First page of 50 rows', unit: 'ms', p9s: ['p9s', 1.2], other: ['Recursive policy', 25] },
      { label: 'Count the visible rows', unit: 'ms', p9s: ['p9s', 0.87], other: ['Recursive policy', 34] },
    ],
  },
  {
    title: 'Writes of comments, as a leaf table and as nodes of the graph',
    rows: [
      { label: 'Create 1,000 comments at once', unit: 'ms', p9s: ['Leaf table', 11], other: ['Graph nodes', 47] },
      {
        label: 'Comment while the graph moves, 4 clients',
        unit: 'tx/s',
        p9s: ['Leaf table', 4200],
        other: ['Graph nodes', 84],
      },
    ],
  },
];

const heroStats = [
  { value: '1.2 ms', label: 'for a page of 50 rows, through RLS' },
  { value: '39×', label: 'faster counts than a recursive policy' },
  { value: '12', label: 'stacks, each adopted and tested end to end' },
];

const cacheFacts = [
  {
    title: 'Recursive, once',
    body: 'Triggers walk the trees when they change, not when you read them, and store every transitive permission for the policies to look up.',
  },
  {
    title: 'Never stale',
    body: 'Triggers update the caches in the transaction that writes, so a share, a revoke or a move applies to the very next query.',
  },
  {
    title: 'Writes pay for what they change',
    body: 'Adding a row takes 0.2 ms and moving one 0.4 ms: a write updates the cache rows it changes, and no others.',
  },
];

function ComparisonBars({ row }: { row: Comparison }) {
  const [, p9s] = row.p9s;
  const [, other] = row.other;
  const max = Math.max(p9s, other);
  const factor = Math.round(row.unit === 'ms' ? other / p9s : p9s / other);
  const bars = [
    { name: row.p9s[0], value: p9s, className: styles.barP9s },
    { name: row.other[0], value: other, className: styles.barBaseline },
  ];
  return (
    <div className={styles.barGroup}>
      <div className={styles.barLabel}>
        {row.label}
        <span className={styles.barFactor}>
          {factor}× {row.unit === 'ms' ? 'faster' : 'the throughput'}
        </span>
      </div>
      {bars.map((bar) => (
        <div key={bar.name} className={styles.barRow}>
          <span className={styles.barName}>{bar.name}</span>
          <span className={styles.barTrack}>
            <span className={clsx(styles.bar, bar.className)} style={{ width: `${Math.max(2, (bar.value / max) * 100)}%` }} />
          </span>
          <span className={styles.barValue}>
            {bar.value.toLocaleString('en-US')} {row.unit}
          </span>
        </div>
      ))}
    </div>
  );
}

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroGlow} aria-hidden />
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>Open source · PostgreSQL 14+ · Any stack</span>
          <h1 className={styles.heroTitle}>
            Permissions that live <span className={styles.gradient}>in your database</span>
          </h1>
          <p className={styles.heroLead}>
            p9s turns the rows you already have into a permission graph: folders in spaces, members in teams, documents
            shared with anyone. Postgres enforces it with Row Level Security on every query, and smart recursive caching
            makes each policy an index lookup. One command adopts it in the app you have, whatever it is written in.
          </p>
          <div className={styles.actions}>
            <Link className={clsx(styles.button, styles.buttonPrimary)} to="/docs/intro">
              Get started <ArrowIcon />
            </Link>
            <Link className={clsx(styles.button, styles.buttonGhost)} to="#demos">
              Try the live demos
            </Link>
          </div>
          <dl className={styles.heroStats}>
            {heroStats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.value}</dt>
                <dd>{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>
        <CodeWindow tabs={heroTabs} className={styles.heroWindow} />
      </div>
    </header>
  );
}

const worksWith = [
  { icon: siPostgresql, name: 'PostgreSQL 14+' },
  { icon: siTypescript, name: 'TypeScript' },
  { icon: siPython, name: 'Python' },
  { icon: siRuby, name: 'Ruby' },
  { icon: siGo, name: 'Go' },
  { icon: siRust, name: 'Rust' },
  { icon: siElixir, name: 'Elixir' },
  { icon: siPhp, name: 'PHP' },
  { icon: siSupabase, name: 'Supabase' },
  { icon: siNeon, name: 'Neon' },
];

function WorksWith() {
  return (
    <section className={styles.strip}>
      <div className={clsx('container', styles.stripInner)}>
        <span className={styles.stripLabel}>Works with</span>
        {worksWith.map(({ icon, name }) => (
          <span key={name} className={styles.stripItem}>
            <Logo icon={icon} size={20} />
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

function Adopt() {
  const [selected, setSelected] = useState(0);
  const stack = stacks[selected]!;
  const steps = [
    {
      title: 'Describe your tables',
      body: (
        <>
          <code>p9s.config.json</code> names your roles and resources, and the tables where you already keep
          memberships and shares. Its JSON Schema gives completion and checks in any editor.
        </>
      ),
    },
    {
      title: 'Run one command',
      body: (
        <>
          <code>npx @p9s/cli postgres migrate</code>, or the standalone binary: one transaction, and your users keep
          the access they had. Or generate it as a migration of Alembic, Django, Rails, goose, sqlx, Ecto or Laravel.
        </>
      ),
    },
    {
      title: 'Run each request as its user',
      body: (
        <>
          One line in your framework: a middleware, a controller concern, an extractor or a transaction helper.{' '}
          <code>npx @p9s/cli adopt</code> adds the package and hooks it in for you.
        </>
      ),
    },
    {
      title: 'Delete your permission code',
      body: (
        <>
          The queries stay the same. Postgres filters every read, refuses every write the user may not make, and your
          app answers 403.
        </>
      ),
    },
  ];
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>Adopt it in the app you have</span>
          <h2 className={styles.sectionTitle}>Your stack, your migrations, one command</h2>
          <p className={styles.sectionLead}>
            Keep your schema, your ORM and your migration tool. Each stack has a small package, a guide, and an example
            app tested in CI: the code before p9s, the one command, and the patch that deletes its permission code, with
            every user getting the same answers before and after.
          </p>
        </div>
        <nav className={styles.stackPicker} aria-label="Guides of each stack">
          {stacks.map((item, index) => (
            <Link
              key={item.name}
              to={item.to}
              className={clsx(styles.stackButton, index === selected && styles.stackButtonActive)}
              onMouseEnter={() => setSelected(index)}
              onFocus={() => setSelected(index)}>
              <Logo icon={item.icon} brand size={26} />
              <span className={styles.stackName}>{item.name}</span>
              <span className={styles.stackLanguage}>{item.language}</span>
            </Link>
          ))}
        </nav>
        <div className={styles.split}>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber}>{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <CodeWindow
            key={stack.name}
            className={styles.stackWindow}
            tabs={[
              {
                label: stack.file,
                language: stack.prism,
                code: stack.code,
                caption: (
                  <span className={styles.stackCaption}>
                    <code>{stack.install}</code>
                    <Link to={stack.to}>
                      The {stack.name} guide <ArrowIcon />
                    </Link>
                  </span>
                ),
              },
            ]}
          />
        </div>
        <p className={styles.barNote}>
          Another stack? Any client runs one statement at the start of each transaction,{' '}
          <Link to="/docs/integrations/other-stacks">see how</Link>.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: 'Your rows form two trees',
      body: 'Resources, like spaces, folders and documents, and roles, like organizations, teams and members. Parent columns are the edges, and a node can have several parents.',
    },
    {
      title: 'Assignments connect them',
      body: 'Share a space with a team, with a bitmap of what it allows. A path gives the AND of its bits, and a role gets the OR of all its paths.',
    },
    {
      title: 'Postgres does the rest',
      body: 'Smart recursive caching: triggers keep every transitive permission cached, so policies are index lookups instead of recursive queries. Application code asks resource_permission.',
    },
  ];
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>How it works</span>
          <h2 className={styles.sectionTitle}>Share a space with a team, and Bob can edit the documents in it</h2>
          <p className={styles.sectionLead}>
            The access model of Google Drive, Notion or GitHub organizations, as a few tables, triggers and policies in
            your own schema.
          </p>
        </div>
        <div className={styles.how}>
          <div className={styles.graphCard}>
            <PermissionGraph />
          </div>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber}>{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>Features</span>
          <h2 className={styles.sectionTitle}>Everything a multi-tenant app needs from its permissions</h2>
        </div>
        <div className={styles.features}>
          {features.map((feature) => (
            <Link key={feature.title} to={feature.to} className={styles.feature}>
              <span className={styles.featureIcon}>{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Numbers() {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>Performance</span>
          <h2 className={styles.sectionTitle}>Millisecond permissions, with smart recursive caching</h2>
          <p className={styles.sectionLead}>
            Hierarchical permissions are where RLS usually gets slow: a policy that walks the trees runs recursive queries
            for every row it checks. p9s caches the result of that recursion and keeps it exact on every write, so you
            write plain queries and each policy is an index lookup. Rows that nothing is below, like comments, can be leaf
            tables that need no cache rows at all.
          </p>
        </div>
        <div className={styles.numbers}>
          {comparisons.map((card) => (
            <div key={card.title} className={styles.barsCard}>
              <h3 className={styles.barsTitle}>{card.title}</h3>
              {card.rows.map((row) => (
                <ComparisonBars key={row.label} row={row} />
              ))}
            </div>
          ))}
        </div>
        <ul className={styles.cacheFacts}>
          {cacheFacts.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
        <p className={styles.barNote}>
          Median, Postgres 14 on an Apple M2 Max: 37,000 resources, 584 roles, assignments at every level, and 58,000
          comments. <Link to="/docs/benchmarks">All the benchmarks</Link>
        </p>
      </div>
    </section>
  );
}

function Anywhere() {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <div className={styles.split}>
          <div>
            <span className={styles.kicker}>In your code</span>
            <h2 className={styles.sectionTitle}>Write your app as if everyone could see everything</h2>
            <p className={styles.sectionLead}>
              Set who the request is for, then query as usual. A row the member cannot read does not exist for them, an
              update of a row they cannot edit changes nothing, and an insert where they cannot create fails.
            </p>
            <ul className={styles.checks}>
              <li>Shares, revocations and access lists, checked by the same rules</li>
              <li>Searches, pages and counts that stay fast through the policies</li>
              <li>Graph writers for the changes only your server makes</li>
            </ul>
          </div>
          <CodeWindow tabs={anywhereTabs} />
        </div>
      </div>
    </section>
  );
}

function Demos() {
  const { siteConfig } = useDocusaurusContext();
  useBrokenLinks().collectAnchor('demos');
  const demos = [
    {
      href: siteConfig.customFields!.nextjsDemo as string,
      image: useBaseUrl('/img/demo-nextjs.png'),
      stack: 'Next.js · Drizzle · Better Auth',
      title: 'A team workspace',
      body: 'Organizations, teams, nested folders, documents, comments, sharing, API keys, an audit log, and admins acting as members. Server actions run every query through RLS.',
      source: 'examples/apps/nextjs-drizzle',
    },
    {
      href: siteConfig.customFields!.postgraphileDemo as string,
      image: useBaseUrl('/img/demo-postgraphile.png'),
      stack: 'PostGraphile 5 · React · GraphiQL',
      title: 'The same app, on GraphQL',
      body: 'No resolvers: the API is the schema. Every page opens its own query in GraphiQL, which runs as whoever is signed in.',
      source: 'examples/apps/postgraphile',
    },
  ];
  return (
    <section id="demos" className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>Live demos</span>
          <h2 className={styles.sectionTitle}>180,000 documents, 3,000 people, one policy per table</h2>
          <p className={styles.sectionLead}>
            Sign in as anyone: every account uses the password <code>password1234</code>. A member of Globex reads about
            100,000 documents, and sees nothing of the other organizations.
          </p>
        </div>
        <div className={styles.demos}>
          {demos.map((demo) => (
            <div key={demo.title} className={styles.demo}>
              <a href={demo.href} className={styles.demoShot} target="_blank" rel="noreferrer">
                <img src={demo.image} alt={`${demo.title}: ${demo.stack}`} loading="lazy" />
              </a>
              <div className={styles.demoBody}>
                <span className={styles.demoStack}>{demo.stack}</span>
                <h3>{demo.title}</h3>
                <p>{demo.body}</p>
                <div className={styles.demoLinks}>
                  <a className={clsx(styles.button, styles.buttonPrimary, styles.buttonSmall)} href={demo.href} target="_blank" rel="noreferrer">
                    Open the demo <ArrowIcon />
                  </a>
                  <a className={styles.textLink} href={`${siteConfig.customFields!.github as string}/tree/main/${demo.source}`} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CallToAction() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <section className={styles.cta}>
      <div className={styles.heroGlow} aria-hidden />
      <div className={clsx('container', styles.ctaInner)}>
        <h2>Put your permissions where your data is</h2>
        <p>
          Open source, and fast from the first query. Describe your tables, run one command, and let Postgres say no in a
          millisecond, in whatever stack you write.
        </p>
        <div className={styles.actions}>
          <Link className={clsx(styles.button, styles.buttonPrimary)} to="/docs/intro">
            Read the docs <ArrowIcon />
          </Link>
          <a className={clsx(styles.button, styles.buttonGhost)} href={siteConfig.customFields!.github as string}>
            <GitHubIcon /> GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Hierarchical permissions for Postgres"
      description="Open source hierarchical permissions for Postgres: p9s turns your tables into a permission graph, and Row Level Security enforces it on every query, in about a millisecond thanks to smart recursive caching. One command adopts it in TypeScript, Python, Ruby, Go, Rust, Elixir or PHP apps.">
      <Hero />
      <main>
        <WorksWith />
        <HowItWorks />
        <Numbers />
        <Adopt />
        <Anywhere />
        <Features />
        <Demos />
        <CallToAction />
      </main>
    </Layout>
  );
}
