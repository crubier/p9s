import { Hono } from "hono";
import { maybeRow, rows, supabase, type Access } from "./db.ts";
import { bitsOf, documentBits, hasBits, projectBits, readableDocuments, readableProjects } from "./permissions.ts";

const app = new Hono<{ Variables: { userId: number } }>();

const columns = "id, project_id, title, body";
const notFound = { error: "not found" };
const forbidden = { error: "forbidden" };

app.get("/health", c => c.text("ok"));

// A real app reads the user from its session, this one from a header
app.use("*", async (c, next) => {
  const userId = Number(c.req.header("x-user-id"));
  if (!Number.isInteger(userId)) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
});

app.get("/projects", async c => c.json(await readableProjects(c.get("userId"))));

app.get("/documents", async c => c.json(await readableDocuments(c.get("userId"))));

app.get("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  return c.json(await rows(supabase.from("documents").select(columns).eq("id", id).single()));
});

app.post("/documents", async c => {
  const { project_id, title, body } = await c.req.json<{ project_id: number, title: string, body?: string }>();
  if (!(await projectBits(c.get("userId"), project_id)).has("write")) return c.json(forbidden, 403);
  return c.json(await rows(supabase.from("documents").insert({ project_id, title, body }).select(columns).single()), 201);
});

app.patch("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const { title, body } = await c.req.json<{ title?: string, body?: string }>();
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("write")) return c.json(forbidden, 403);
  return c.json(await rows(supabase.from("documents").update({ title, body }).eq("id", id).select(columns).single()));
});

app.delete("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("delete")) return c.json(forbidden, 403);
  await rows(supabase.from("documents").delete().eq("id", id));
  return c.body(null, 204);
});

app.put("/documents/:id/shares/:userId", async c => {
  const documentId = Number(c.req.param("id"));
  const userId = Number(c.req.param("userId"));
  const { access } = await c.req.json<{ access: Exclude<Access, "owner"> }>();
  const bits = await documentBits(c.get("userId"), documentId);
  if (!bits?.has("read")) return c.json(notFound, 404);
  const previous = await maybeRow(supabase.from("document_shares").select("access").eq("document_id", documentId).eq("user_id", userId).maybeSingle());
  if (!hasBits(bits, bitsOf[access]) || (previous && !hasBits(bits, bitsOf[previous.access]))) return c.json(forbidden, 403);
  await rows(supabase.from("document_shares").upsert({ document_id: documentId, user_id: userId, access }));
  return c.body(null, 204);
});

Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch });
