import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const User = pgTable("User", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const GROUP = pgTable("GROUP", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const Teams = pgTable("Teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const ACCOUNTS = pgTable("ACCOUNTS", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const tokens = pgTable("tokens", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
});

export const Role = pgTable("Role", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const document = pgTable("document", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

export const Project = pgTable("Project", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value").notNull(),
});
