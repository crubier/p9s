import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index, uuid, unique, type AnyPgColumn } from "drizzle-orm/pg-core";

// Better Auth tables. They are not part of the permission graph: people act through their membership of an organization

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// Application tables. `resource_id` and `role_id` are the ids of the rows in the permission graph: p9s fills them,
// they are declared here so that the application can read them

// A root of both trees: the resource that holds the members, teams and spaces, and the role of everyone in it
export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  resourceId: uuid("resource_id").unique(),
  roleId: uuid("role_id").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// A group of members. A resource in its organization, so that admins manage it through RLS, and a role,
// whose members are the role edges written by the backend
export const team = pgTable(
  "team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    resourceId: uuid("resource_id").unique(),
    roleId: uuid("role_id").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("team_org_id_idx").on(table.orgId)],
);

// A user in an organization: the role the user acts as in that organization. It is a child of the organization in
// both trees, through the same column: admins add members through RLS, and members get what is assigned to everyone
export const member = pgTable(
  "member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").unique(),
    roleId: uuid("role_id").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("member_org_id_idx").on(table.orgId), index("member_user_id_idx").on(table.userId), unique().on(table.orgId, table.userId)],
);

// A key to call the API on behalf of a member. A role leaf: it acts with exactly the permissions of its member
export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenStart: text("token_start").notNull(),
    roleId: uuid("role_id").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (table) => [index("api_key_member_id_idx").on(table.memberId)],
);

// A folder is in its parent folder, or at the top of its organization, then called a space. p9s follows a single
// parent column, so `parent_resource_id` holds the resource id of either, set by a trigger from the two foreign keys
export const folder = pgTable(
  "folder",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => folder.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentResourceId: uuid("parent_resource_id"),
    resourceId: uuid("resource_id").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("folder_org_id_idx").on(table.orgId),
    index("folder_parent_id_idx").on(table.parentId),
    index("folder_parent_resource_id_idx").on(table.parentResourceId),
  ],
);

export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folder.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    createdBy: uuid("created_by").references(() => member.id, { onDelete: "set null" }),
    resourceId: uuid("resource_id").unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("document_folder_id_idx").on(table.folderId), index("document_updated_at_idx").on(table.updatedAt, table.id)],
);

// A resource leaf: comments are not in the graph, they have the permissions of their document
export const comment = pgTable(
  "comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => member.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("comment_document_id_idx").on(table.documentId)],
);

// What members did, written by the triggers of migrations/audit.sql. A resource leaf of the organization, which only
// admins can read. Names are copied when the event is written, so that the log outlives what it is about
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorMemberId: uuid("actor_member_id").references(() => member.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    // The API key the request was made with
    apiKeyName: text("api_key_name"),
    // The admin acting as the member
    impersonatorMemberId: uuid("impersonator_member_id").references(() => member.id, { onDelete: "set null" }),
    impersonatorName: text("impersonator_name"),
    action: text("action").notNull(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: uuid("subject_id"),
    subjectName: text("subject_name"),
    // Who access was given to, who joined a team, where something was moved, or its former name
    detail: text("detail"),
    permission: text("permission"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("audit_event_org_id_created_at_idx").on(table.orgId, table.createdAt), index("audit_event_actor_member_id_idx").on(table.actorMemberId)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
