import { Hono } from "hono";
import { db, type Access } from "./db.ts";
import { bitsOf, documentBits, hasBits, projectBits, readableDocuments, readableProjects } from "./permissions.ts";

const app = new Hono<{ Variables: { userId: number } }>();

const columns = ["id", "project_id", "title", "body"] as const;
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
  return c.json(await db.selectFrom("documents").select(columns).where("id", "=", id).executeTakeFirstOrThrow());
});

app.post("/documents", async c => {
  const { project_id, title, body } = await c.req.json<{ project_id: number, title: string, body?: string }>();
  if (!(await projectBits(c.get("userId"), project_id)).has("write")) return c.json(forbidden, 403);
  const document = await db.insertInto("documents").values({ project_id, title, body }).returning(columns).executeTakeFirstOrThrow();
  return c.json(document, 201);
});

app.patch("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const { title, body } = await c.req.json<{ title?: string, body?: string }>();
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("write")) return c.json(forbidden, 403);
  return c.json(await db.updateTable("documents").set({ title, body }).where("id", "=", id).returning(columns).executeTakeFirstOrThrow());
});

app.delete("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("delete")) return c.json(forbidden, 403);
  await db.deleteFrom("documents").where("id", "=", id).execute();
  return c.body(null, 204);
});

app.put("/documents/:id/shares/:userId", async c => {
  const documentId = Number(c.req.param("id"));
  const userId = Number(c.req.param("userId"));
  const { access } = await c.req.json<{ access: Exclude<Access, "owner"> }>();
  const bits = await documentBits(c.get("userId"), documentId);
  if (!bits?.has("read")) return c.json(notFound, 404);
  const previous = await db.selectFrom("document_shares").select("access")
    .where("document_id", "=", documentId).where("user_id", "=", userId).executeTakeFirst();
  if (!hasBits(bits, bitsOf[access]) || (previous && !hasBits(bits, bitsOf[previous.access]))) return c.json(forbidden, 403);
  await db.insertInto("document_shares").values({ document_id: documentId, user_id: userId, access })
    .onConflict(oc => oc.columns(["document_id", "user_id"]).doUpdateSet({ access }))
    .execute();
  return c.body(null, 204);
});

Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch });
