import { Hono } from "hono";
import { grafserv } from "postgraphile/grafserv/hono/v4";
import { graphql, pgl } from "./graphql.ts";

// The GraphQL API of PostGraphile on /graphql, and the routes of the API the tests call, each a GraphQL operation run
// in the process as its user, as the front end would send it. The policies of the migrations decide what they read
// and write.
const app = new Hono<{ Variables: { userId: number } }>();

type Access = "viewer" | "editor" | "owner";
interface Document { rowId: number; projectId: number; title: string; body: string }

const notFound = { error: "not found" };
const forbidden = { error: "forbidden" };
const fields = "rowId projectId title body";
const documentOf = ({ rowId, projectId, title, body }: Document) => ({ id: rowId, project_id: projectId, title, body });

app.get("/health", c => c.text("ok"));

// A real app reads the user from its session, this one from a header
app.use("*", async (c, next) => {
  const userId = Number(c.req.header("x-user-id"));
  if (!Number.isInteger(userId)) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
});

// A write the policies do not let through fails with insufficient_privilege, and PostGraphile answers a delete of a
// row they hide with an error of its own
const hidden = /^No values were deleted in collection/;
app.onError((error, c) => {
  if ((error as { originalError?: { code?: string } }).originalError?.code === "42501" || hidden.test(error.message)) return c.json(forbidden, 403);
  throw error;
});

const api = new Hono();
await pgl.createServ(grafserv).addTo(api);
app.route("/", api);

app.get("/projects", async c => {
  const { allProjects } = await graphql<{ allProjects: { nodes: Array<{ rowId: number, name: string }> } }>(c.get("userId"),
    `{ allProjects(orderBy: PRIMARY_KEY_ASC) { nodes { rowId name } } }`);
  return c.json(allProjects.nodes.map(({ rowId, name }) => ({ id: rowId, name })));
});

app.get("/documents", async c => {
  const { allDocuments } = await graphql<{ allDocuments: { nodes: Document[] } }>(c.get("userId"),
    `{ allDocuments(orderBy: PRIMARY_KEY_ASC) { nodes { rowId projectId title } } }`);
  return c.json(allDocuments.nodes.map(({ rowId, projectId, title }) => ({ id: rowId, project_id: projectId, title })));
});

const documentById = async (userId: number, rowId: number) => (await graphql<{ documentByRowId: Document | null }>(userId,
  `query ($rowId: Int!) { documentByRowId(rowId: $rowId) { ${fields} } }`, { rowId })).documentByRowId;

app.get("/documents/:id", async c => {
  const document = await documentById(c.get("userId"), Number(c.req.param("id")));
  return document ? c.json(documentOf(document)) : c.json(notFound, 404);
});

app.post("/documents", async c => {
  const { project_id, title, body } = await c.req.json<{ project_id: number, title: string, body?: string }>();
  const { createDocument } = await graphql<{ createDocument: { document: Document } }>(c.get("userId"),
    `mutation ($document: DocumentInput!) { createDocument(input: { document: $document }) { document { ${fields} } } }`,
    { document: { projectId: project_id, title, body } });
  return c.json(documentOf(createDocument.document), 201);
});

// A document the user does not read is not found, one they read but cannot change is forbidden: PostGraphile answers
// its update with no document
app.patch("/documents/:id", async c => {
  const rowId = Number(c.req.param("id"));
  const { title, body } = await c.req.json<{ title?: string, body?: string }>();
  if (!await documentById(c.get("userId"), rowId)) return c.json(notFound, 404);
  const { updateDocumentByRowId } = await graphql<{ updateDocumentByRowId: { document: Document | null } | null }>(c.get("userId"),
    `mutation ($rowId: Int!, $patch: DocumentPatch!) { updateDocumentByRowId(input: { rowId: $rowId, documentPatch: $patch }) { document { ${fields} } } }`,
    { rowId, patch: { title, body } });
  const document = updateDocumentByRowId?.document;
  return document ? c.json(documentOf(document)) : c.json(forbidden, 403);
});

app.delete("/documents/:id", async c => {
  const rowId = Number(c.req.param("id"));
  if (!await documentById(c.get("userId"), rowId)) return c.json(notFound, 404);
  await graphql(c.get("userId"), `mutation ($rowId: Int!) { deleteDocumentByRowId(input: { rowId: $rowId }) { clientMutationId } }`, { rowId });
  return c.body(null, 204);
});

app.put("/documents/:id/shares/:userId", async c => {
  const documentId = Number(c.req.param("id"));
  const userId = Number(c.req.param("userId"));
  const { access } = await c.req.json<{ access: Exclude<Access, "owner"> }>();
  if (!await documentById(c.get("userId"), documentId)) return c.json(notFound, 404);
  const { documentShareByDocumentIdAndUserId: previous } = await graphql<{ documentShareByDocumentIdAndUserId: { access: string } | null }>(c.get("userId"),
    `query ($documentId: Int!, $userId: Int!) { documentShareByDocumentIdAndUserId(documentId: $documentId, userId: $userId) { access } }`,
    { documentId, userId });
  await graphql(c.get("userId"), previous
    ? `mutation ($documentId: Int!, $userId: Int!, $access: String!) { updateDocumentShareByDocumentIdAndUserId(input: { documentId: $documentId, userId: $userId, documentSharePatch: { access: $access } }) { clientMutationId } }`
    : `mutation ($documentId: Int!, $userId: Int!, $access: String!) { createDocumentShare(input: { documentShare: { documentId: $documentId, userId: $userId, access: $access } }) { clientMutationId } }`,
    { documentId, userId, access });
  return c.body(null, 204);
});

Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch });
