import { Hono } from "hono";
import { documentOf, prisma, type Access } from "./db.ts";
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

app.get("/documents", async c => c.json((await readableDocuments(c.get("userId")))
  .map(({ id, projectId, title }) => ({ id, project_id: projectId, title }))));

app.get("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  return c.json(documentOf(await prisma.document.findUniqueOrThrow({ where: { id } })));
});

app.post("/documents", async c => {
  const { project_id, title, body } = await c.req.json<{ project_id: number, title: string, body?: string }>();
  if (!(await projectBits(c.get("userId"), project_id)).has("write")) return c.json(forbidden, 403);
  return c.json(documentOf(await prisma.document.create({ data: { projectId: project_id, title, body } })), 201);
});

app.patch("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const { title, body } = await c.req.json<{ title?: string, body?: string }>();
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("write")) return c.json(forbidden, 403);
  return c.json(documentOf(await prisma.document.update({ where: { id }, data: { title, body } })));
});

app.delete("/documents/:id", async c => {
  const id = Number(c.req.param("id"));
  const bits = await documentBits(c.get("userId"), id);
  if (!bits?.has("read")) return c.json(notFound, 404);
  if (!bits.has("delete")) return c.json(forbidden, 403);
  await prisma.document.delete({ where: { id } });
  return c.body(null, 204);
});

app.put("/documents/:id/shares/:userId", async c => {
  const documentId = Number(c.req.param("id"));
  const userId = Number(c.req.param("userId"));
  const { access } = await c.req.json<{ access: Exclude<Access, "owner"> }>();
  const bits = await documentBits(c.get("userId"), documentId);
  if (!bits?.has("read")) return c.json(notFound, 404);
  const previous = await prisma.documentShare.findUnique({ where: { documentId_userId: { documentId, userId } } });
  if (!hasBits(bits, bitsOf[access]) || (previous && !hasBits(bits, bitsOf[previous.access as Access]))) return c.json(forbidden, 403);
  await prisma.documentShare.upsert({
    where: { documentId_userId: { documentId, userId } },
    create: { documentId, userId, access },
    update: { access },
  });
  return c.body(null, 204);
});

Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch });
