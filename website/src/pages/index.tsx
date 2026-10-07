import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import { CodeWindow, type CodeTab } from '@site/src/components/landing/CodeWindow';
import { PermissionGraph } from '@site/src/components/landing/PermissionGraph';
import {
  ArrowIcon,
  BitsIcon,
  BoltIcon,
  CodeIcon,
  EyeOffIcon,
  GitHubIcon,
  GraphQLIcon,
  LayersIcon,
  ShareIcon,
  ShieldIcon,
  TreeIcon,
} from '@site/src/components/landing/icons';
import styles from '@site/src/components/landing/landing.module.css';

const heroTabs: CodeTab[] = [
  {
    label: 'p9s.ts',
    language: 'typescript',
    code: `
import { createMigration } from "@p9s/postgres";

export const migration = createMigration({
  engine: {
    users: ["app_user"],
    authentication: { getCurrentUserId: "current_role_id" },
    permission: {
      bitmap: { size: 8, names: { read: 0, edit: 2, share: 5 } },
    },
  },
  tables: [
    { name: "team", isRole: true, roleId: "role_id" },
    { name: "member", isRole: true, roleId: "role_id",
      roleParent: { column: "team_id", table: "team", key: "id" } },
    { name: "folder", isResource: true, resourceId: "resource_id",
      resourceParent: { column: "parent_id", table: "folder", key: "id" },
      permission: { app_user: { select: 0, update: 2, share: 5 } } },
    { name: "document", isResource: true, resourceId: "resource_id",
      resourceParent: { column: "folder_id", table: "folder", key: "id" },
      permission: { app_user: { select: 0, update: 2, share: 5 } } },
  ],
});`,
    caption: 'Describe your tables, or derive them from a Drizzle schema',
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
       set_config('app.role_id', :bob, true);

-- Plain SQL. RLS returns what Bob can read, nothing else
select title from document order by updated_at desc limit 50;

update document set title = 'Hiring plan v2' where id = :hiring_plan;
-- UPDATE 0: Bob can read it, not edit it

select (permission_flags(resource_permission(resource_id))).*
from document where id = :hiring_plan;
--  bitmap   | read | edit | share
--  10001000 | t    | f    | f`,
    caption: 'No SDK in the request path: Postgres checks every row',
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
// Every query of the transaction runs as the member, through RLS
export const asMember = <T>(roleId: string, fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql\`select set_config('role', 'app_user', true),
      set_config('app.role_id', \${roleId}, true)\`);
    return fn(tx);
  });

// A server action: no permission check in sight, and none forgotten
export async function renameDocument(id: string, title: string) {
  const member = await currentMember();
  return asMember(member.roleId, (tx) =>
    tx.update(document).set({ title }).where(eq(document.id, id)).returning());
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
    icon: <BoltIcon />,
    title: 'Fast because it is cached',
    body: (
      <>
        Triggers keep every transitive permission exact on each write, so a policy is an index lookup. Pages, counts
        and searches stay fast through RLS.
      </>
    ),
    to: '/docs/configuration/querying',
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
    title: 'One migration, from TypeScript',
    body: (
      <>
        A typed, validated config, or one derived from your Drizzle schema. p9s writes plain SQL: no extension, no
        service, no vendor.
      </>
    ),
    to: '/docs/getting-started/installation',
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
];

const bars = [
  { label: 'First page of 50 rows', p9s: 1.2, baseline: 25 },
  { label: 'Count the visible rows', p9s: 0.87, baseline: 34 },
];

const stats = [
  { value: '0.2 ms', label: 'to add a row to the tree' },
  { value: '5,500 /s', label: 'rows created by 4 clients' },
  { value: '0.1 ms', label: 'for the permission bits of a row' },
];

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroGlow} aria-hidden />
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>Open source · PostgreSQL 14+ · TypeScript</span>
          <h1 className={styles.heroTitle}>
            Permissions that live <span className={styles.gradient}>in your database</span>
          </h1>
          <p className={styles.heroLead}>
            p9s turns the rows you already have into a permission graph: folders in spaces, members in teams, documents
            shared with anyone. Postgres enforces it with Row Level Security, on every query, from every client.
          </p>
          <div className={styles.actions}>
            <Link className={clsx(styles.button, styles.buttonPrimary)} to="/docs/intro">
              Get started <ArrowIcon />
            </Link>
            <Link className={clsx(styles.button, styles.buttonGhost)} to="#demos">
              Try the live demos
            </Link>
          </div>
          <p className={styles.heroNote}>Generates one SQL migration from a typed config. Nothing to run beside Postgres.</p>
        </div>
        <CodeWindow tabs={heroTabs} className={styles.heroWindow} />
      </div>
    </header>
  );
}

function WorksWith() {
  return (
    <section className={styles.strip}>
      <div className={clsx('container', styles.stripInner)}>
        <span className={styles.stripLabel}>Works with</span>
        {['PostgreSQL 14+', 'Drizzle ORM', 'PostGraphile 5', 'Next.js', 'PGlite', 'Neon'].map((name) => (
          <span key={name} className={styles.stripItem}>
            {name}
          </span>
        ))}
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
      body: 'Triggers keep caches of every transitive permission. Policies read them through views of the current user, and application code asks resource_permission.',
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
    <section className={clsx(styles.section, styles.sectionAlt)}>
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
    <section className={styles.section}>
      <div className="container">
        <div className={styles.numbers}>
          <div>
            <span className={styles.kicker}>Performance</span>
            <h2 className={styles.sectionTitle}>Fast where RLS usually hurts</h2>
            <p className={styles.sectionLead}>
              A policy that walks the trees with recursive queries is fine for one row, and slow for a page or a count.
              p9s reads its caches instead, through RLS, as the application user.
            </p>
            <div className={styles.stats}>
              {stats.map((stat) => (
                <div key={stat.label} className={styles.stat}>
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.barsCard}>
            {bars.map((bar) => (
              <div key={bar.label} className={styles.barGroup}>
                <div className={styles.barLabel}>
                  {bar.label}
                  <span className={styles.barFactor}>{Math.round(bar.baseline / bar.p9s)}× faster</span>
                </div>
                <div className={styles.barRow}>
                  <span className={styles.barName}>p9s</span>
                  <span className={styles.barTrack}>
                    <span className={clsx(styles.bar, styles.barP9s)} style={{ width: `${Math.max(2, (bar.p9s / bar.baseline) * 100)}%` }} />
                  </span>
                  <span className={styles.barValue}>{bar.p9s} ms</span>
                </div>
                <div className={styles.barRow}>
                  <span className={styles.barName}>Recursive policy</span>
                  <span className={styles.barTrack}>
                    <span className={clsx(styles.bar, styles.barBaseline)} style={{ width: '100%' }} />
                  </span>
                  <span className={styles.barValue}>{bar.baseline} ms</span>
                </div>
              </div>
            ))}
            <p className={styles.barNote}>
              Median, Postgres 14 on an Apple M2 Max: 37,000 resources, 584 roles, assignments at every level.{' '}
              <Link to="/docs/benchmarks">All the benchmarks</Link>
            </p>
          </div>
        </div>
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
            <span className={styles.kicker}>From any client</span>
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
      source: 'examples/nextjs-drizzle',
    },
    {
      href: siteConfig.customFields!.postgraphileDemo as string,
      image: useBaseUrl('/img/demo-postgraphile.png'),
      stack: 'PostGraphile 5 · React · GraphiQL',
      title: 'The same app, on GraphQL',
      body: 'No resolvers: the API is the schema. Every page opens its own query in GraphiQL, which runs as whoever is signed in.',
      source: 'examples/postgraphile',
    },
  ];
  return (
    <section id="demos" className={styles.section}>
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
        <p>Read the security model, generate a migration for your schema, and let Postgres say no.</p>
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
      description="p9s turns your tables into a permission graph, folders in spaces and members in teams, and Postgres enforces it with Row Level Security on every query.">
      <Hero />
      <main>
        <WorksWith />
        <HowItWorks />
        <Features />
        <Numbers />
        <Anywhere />
        <Demos />
        <CallToAction />
      </main>
    </Layout>
  );
}
