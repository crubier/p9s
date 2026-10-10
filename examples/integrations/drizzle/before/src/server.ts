import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, documentColumns, documents, documentShares, type Access } from "./db.ts";
import { bitsOf, documentBits, hasBits, projectBits, readableDocuments, readableProjects } from "./permissions.ts";

const app = new Hono<{ Variables: { userId: number } }>();

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
  const [document] = await db.select(documentColumns).from(documents).where(eq(documents.id, id));
  return c.json(document);
});

app.post("/documents", async c => {
  const { project_id, title, body } = await c.req.json<{ project_id: number, title: string, body?: string }>();
  if (!(await projectBits(c.get("userId"), project_id)).has("write")) return c.json(forbidden, 403);
  const [document] = await db.insert(documents).values({ projectId: project_id, title, body }).returning(documentColumns);
  return c.json(document, 201);
});

app.patch("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const { title, body } = await c.req.json<{ title?: string, body?: string }>();
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("write")) return c.json(forbidden, 403);
  const [document] = await db.update(documents).set({ title, body }).where(eq(documents.id, id)).returning(documentColumns);
  return c.json(document);
});

app.delete("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("delete")) return c.json(forbidden, 403);
  await db.delete(documents).where(eq(documents.id, id));
  return c.body(null, 204);
});

app.put("/documents/:id/shares/:userId", async c => {
  const documentId = Number(c.req.param("id"));
  const userId = Number(c.req.param("userId"));
  const { access } = await c.req.json<{ access: Exclude<Access, "owner"> }>();
  const bits = await documentBits(c.get("userId"), documentId);
  if (!bits?.has("read")) return c.json(notFound, 404);
  const [previous] = await db.select({ access: documentShares.access }).from(documentShares)
    .where(and(eq(documentShares.documentId, documentId), eq(documentShares.userId, userId)));
  if (!hasBits(bits, bitsOf[access]) || (previous && !hasBits(bits, bitsOf[previous.access]))) return c.json(forbidden, 403);
  await db.insert(documentShares).values({ documentId, userId, access })
    .onConflictDoUpdate({ target: [documentShares.documentId, documentShares.userId], set: { access } });
  return c.body(null, 204);
});

Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch });
