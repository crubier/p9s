import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const NEXTJS_DEMO = 'https://p9s-example-nextjs-drizzle.vercel.app';
const POSTGRAPHILE_DEMO = 'https://p9s-example-postgraphile.vercel.app';
const GITHUB = 'https://github.com/crubier/p9s';

const config: Config = {
  title: 'p9s',
  tagline: 'Hierarchical permissions for Postgres, enforced with Row Level Security',
  favicon: 'img/logo.svg',

  future: {
    v4: true,
  },

  url: process.env.SITE_URL ?? 'https://p9s.vercel.app',
  baseUrl: '/',

  organizationName: 'crubier',
  projectName: 'p9s',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  customFields: { nextjsDemo: NEXTJS_DEMO, postgraphileDemo: POSTGRAPHILE_DEMO, github: GITHUB },

  stylesheets: [
    {
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
      type: 'text/css',
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `${GITHUB}/tree/main/website/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    metadata: [
      { name: 'keywords', content: 'postgres, postgresql, row level security, rls, permissions, authorization, access control, rbac, rebac, drizzle, prisma, kysely, supabase, postgraphile, sqlalchemy, fastapi, django, rails, gorm, sqlx, axum, phoenix, ecto, laravel' },
    ],
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'p9s',
      logo: {
        alt: 'p9s',
        src: 'img/logo.svg',
      },
      items: [
        { type: 'docSidebar', sidebarId: 'tutorialSidebar', position: 'left', label: 'Docs' },
        { to: '/docs/integrations/adopting', label: 'Integrations', position: 'left' },
        { to: '/docs/configuration/security-model', label: 'Security model', position: 'left' },
        { to: '/docs/benchmarks', label: 'Benchmarks', position: 'left' },
        { to: '/#demos', label: 'Live demos', position: 'left', activeBaseRegex: '^$' },
        { href: GITHUB, label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Introduction', to: '/docs/intro' },
            { label: 'Installation', to: '/docs/getting-started/installation' },
            { label: 'Configuration', to: '/docs/configuration/overview' },
            { label: 'Security model', to: '/docs/configuration/security-model' },
          ],
        },
        {
          title: 'Guides',
          items: [
            { label: 'Adopting p9s', to: '/docs/integrations/adopting' },
            { label: 'CLI and binaries', to: '/docs/packages/cli' },
            { label: 'Querying through RLS', to: '/docs/configuration/querying' },
            { label: 'PostGraphile', to: '/docs/configuration/postgraphile' },
            { label: 'Upgrading', to: '/docs/configuration/upgrading' },
            { label: 'Benchmarks', to: '/docs/benchmarks' },
          ],
        },
        {
          title: 'Integrations',
          items: [
            { label: 'Drizzle', to: '/docs/integrations/drizzle' },
            { label: 'PostGraphile', to: '/docs/integrations/postgraphile' },
            { label: 'Prisma and Kysely', to: '/docs/integrations/prisma' },
            { label: 'Supabase', to: '/docs/integrations/supabase' },
            { label: 'SQLAlchemy and Django', to: '/docs/integrations/sqlalchemy' },
            { label: 'Rails', to: '/docs/integrations/rails' },
            { label: 'Go, Rust, Elixir, Laravel', to: '/docs/integrations/go' },
          ],
        },
        {
          title: 'Live demos',
          items: [
            { label: 'Next.js and Drizzle', href: NEXTJS_DEMO },
            { label: 'PostGraphile and GraphiQL', href: POSTGRAPHILE_DEMO },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: GITHUB },
            { label: 'Issues', href: `${GITHUB}/issues` },
            { label: 'Pull requests', href: `${GITHUB}/pulls` },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} p9s`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'ruby', 'elixir', 'php'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
