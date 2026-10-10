import type { SimpleIcon } from 'simple-icons';
import {
  siDjango,
  siDrizzle,
  siFastapi,
  siGo,
  siGraphql,
  siLaravel,
  siPhoenixframework,
  siPrisma,
  siRubyonrails,
  siRust,
  siSupabase,
  siTypescript,
} from 'simple-icons';

export type Stack = {
  name: string;
  language: string;
  icon: SimpleIcon;
  to: string;
  install: string;
  file: string;
  prism: string;
  code: string;
};

// The request wrapper of each stack, as its guide and its example in examples/ write it
export const stacks: Stack[] = [
  {
    name: 'Drizzle',
    language: 'TypeScript',
    icon: siDrizzle,
    to: '/docs/integrations/drizzle',
    install: 'npm install @p9s/drizzle @p9s/postgres',
    file: 'src/app.ts',
    prism: 'typescript',
    code: `
import { createIdentity, isRefused } from "@p9s/postgres";
import { withUser } from "@p9s/drizzle";
import config from "../p9s.config.json";

const users = createIdentity(config);

// Every query of the request goes through the policies
app.get("/documents", async c => c.json(await withUser(db, users, c.get("userId"), tx =>
  tx.select().from(documents).orderBy(desc(documents.updatedAt)).limit(50),
  { readOnly: true })));

app.onError((error, c) =>
  isRefused(error) ? c.json({ error: "forbidden" }, 403) : c.json({ error: "internal" }, 500));`,
  },
  {
    name: 'Prisma',
    language: 'TypeScript',
    icon: siPrisma,
    to: '/docs/integrations/prisma',
    install: 'npm install @p9s/prisma @p9s/postgres',
    file: 'src/app.ts',
    prism: 'typescript',
    code: `
import { createIdentity } from "@p9s/postgres";
import { userClient, withUser } from "@p9s/prisma";
import config from "../p9s.config.json";

const users = createIdentity(config);

// An interactive transaction, as the user of the request
app.get("/projects", async c => c.json(await withUser(prisma, users, c.get("userId"), tx =>
  tx.project.findMany({ orderBy: { id: "asc" } }), { readOnly: true })));

// Or a client whose every query runs as the user
const documents = await userClient(prisma, users, userId).document.findMany();`,
  },
  {
    name: 'Kysely',
    language: 'TypeScript',
    icon: siTypescript,
    to: '/docs/integrations/kysely',
    install: 'npm install @p9s/kysely @p9s/postgres',
    file: 'src/app.ts',
    prism: 'typescript',
    code: `
import { createIdentity } from "@p9s/postgres";
import { withUser } from "@p9s/kysely";
import config from "../p9s.config.json";

const users = createIdentity(config);

app.get("/documents", async c => c.json(await withUser(db, users, c.get("userId"), trx =>
  trx.selectFrom("documents").select(["id", "title"]).orderBy("id").execute(),
  { readOnly: true })));

// No ORM: a transaction on a connection of a node-postgres pool
const rows = await users.run(pool, userId, async client =>
  (await client.query("select id, title from documents")).rows);`,
  },
  {
    name: 'PostGraphile',
    language: 'GraphQL',
    icon: siGraphql,
    to: '/docs/configuration/postgraphile',
    install: 'npm install @p9s/postgres',
    file: 'graphile.config.ts',
    prism: 'typescript',
    code: `
import { createIdentity } from "@p9s/postgres";
import config from "./p9s.config.json";

const users = createIdentity(config);

// The settings of each request: its role and its user, for the policies
export const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  grafast: {
    context: requestContext => ({
      pgSettings: users.pgSettings(userIdOf(requestContext)),
    }),
  },
};`,
  },
  {
    name: 'Supabase',
    language: 'supabase-js',
    icon: siSupabase,
    to: '/docs/integrations/supabase',
    install: 'npm install @p9s/core @p9s/postgres',
    file: 'p9s.config.ts',
    prism: 'typescript',
    code: `
import { supabase, type Config } from "@p9s/core";

const permission = { authenticated: { select: 0, insert: 1, update: 2, delete: 3, share: 4 } };

// The preset: authenticated, auth.uid() and service_role
export default {
  engine: { ...supabase },
  tables: [
    { name: "profiles", isRole: true, roleId: "id" },
    { name: "project", isResource: true, permission },
    { name: "task", isResource: true, permission,
      resourceParent: { column: "project_id", table: "project", key: "id" } },
  ],
} satisfies Config<"authenticated">;

// Then supabase-js, in the browser, reads through the policies
const { data: tasks } = await client.from("task").select("id, title");`,
  },
  {
    name: 'FastAPI',
    language: 'SQLAlchemy',
    icon: siFastapi,
    to: '/docs/integrations/sqlalchemy',
    install: 'pip install "p9s[sqlalchemy]"',
    file: 'app/main.py',
    prism: 'python',
    code: `
from p9s import Identity, is_refused
from p9s.sqlalchemy import as_user_async

users = Identity.from_file("p9s.config.json")

# Each route gets a session whose transaction acts as its user
async def writing(user: UserId) -> AsyncIterator[AsyncSession]:
    async with Session() as session, as_user_async(session, users, user):
        yield session

@app.exception_handler(DBAPIError)
async def refused(request: Request, error: DBAPIError):
    if is_refused(error):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    raise error`,
  },
  {
    name: 'Django',
    language: 'Python',
    icon: siDjango,
    to: '/docs/integrations/django',
    install: 'pip install "p9s[django]"',
    file: 'settings.py',
    prism: 'python',
    code: `
P9S_CONFIG = BASE_DIR / "p9s.config.json"

MIDDLEWARE = [
    # ...
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Every request, in a transaction as request.user
    "p9s.django.P9sMiddleware",
]

# A task or a command acts as a user too
with as_user(user_id):
    Document.objects.create(project_id=project_id, title=title)`,
  },
  {
    name: 'Rails',
    language: 'Ruby',
    icon: siRubyonrails,
    to: '/docs/integrations/rails',
    install: 'gem "p9s"',
    file: 'app/controllers/application_controller.rb',
    prism: 'ruby',
    code: `
class ApplicationController < ActionController::API
  before_action :authenticate
  # Every action, in a transaction as current_user
  include P9s::Controller

  rescue_from ActiveRecord::StatementInvalid do |error|
    raise error unless P9s.refused?(error)

    render json: { error: "forbidden" }, status: :forbidden
  end
end`,
  },
  {
    name: 'Go',
    language: 'GORM, pgx',
    icon: siGo,
    to: '/docs/integrations/go',
    install: 'go get github.com/crubier/p9s/packages/go',
    file: 'handlers.go',
    prism: 'go',
    code: `
var users = p9s.Must(p9s.FromFile("p9s.config.json"))

err := p9sgorm.AsUser(ctx, db, users, userID, func(tx *gorm.DB) error {
	return tx.Order("updated_at desc").Limit(50).Find(&documents).Error
}, p9s.ReadOnly(r.Method == http.MethodGet))

if p9s.IsRefused(err) {
	http.Error(w, "forbidden", http.StatusForbidden)
	return
}`,
  },
  {
    name: 'axum',
    language: 'Rust, sqlx',
    icon: siRust,
    to: '/docs/integrations/rust',
    install: 'cargo add p9s --features axum',
    file: 'src/main.rs',
    prism: 'rust',
    code: `
// The extractor begins a transaction as the user of the request
async fn documents(mut tx: UserTx) -> Result<Json<Vec<Document>>, Error> {
    let documents = sqlx::query_as("select id, title from documents")
        .fetch_all(&mut **tx)
        .await?;
    tx.commit().await?;
    Ok(Json(documents))
}

let app = Router::new()
    .route("/documents", get(documents))
    .with_state(P9s::new(pool, p9s::Identity::from_file("p9s.config.json")?));`,
  },
  {
    name: 'Phoenix',
    language: 'Elixir, Ecto',
    icon: siPhoenixframework,
    to: '/docs/integrations/elixir',
    install: '{:p9s, "~> 0.1"}',
    file: 'lib/my_app_web.ex',
    prism: 'elixir',
    code: `
def controller do
  quote do
    use Phoenix.Controller, formats: [:json]
    # Every action, in a transaction as conn.assigns.current_user
    use P9s.Controller, repo: MyApp.Repo

    def p9s_refused(conn, _error),
      do: conn |> put_status(403) |> json(%{error: "forbidden"})
  end
end

# Elsewhere, a function as a user
P9s.as_user(Repo, user.id, fn -> Repo.all(Document) end, read_only: true)`,
  },
  {
    name: 'Laravel',
    language: 'PHP, Eloquent',
    icon: siLaravel,
    to: '/docs/integrations/laravel',
    install: 'composer require p9s/laravel',
    file: 'routes/api.php',
    prism: 'php',
    code: `
<?php

use P9s\\AsUser;
use P9s\\P9s;

// Every request of the group, in a transaction as its user
Route::middleware(['auth:sanctum', AsUser::class])->group(function () {
    Route::apiResource('documents', DocumentController::class);
});

// Elsewhere, a closure as a user
$documents = P9s::asUser($user->id, fn () => Document::latest()->get(), readOnly: true);`,
  },
];
