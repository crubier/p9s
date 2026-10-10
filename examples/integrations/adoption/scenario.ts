// The requests of the users of the seed, in order. Writes say the status the rules of the README give, reads are
// compared between the app before and after p9s, and with what the database gives each user.

export const users = { alice: 1, bob: 2, carol: 3, dave: 4, erin: 5 } as const;
export type UserName = keyof typeof users;

export interface Step {
  as?: UserName;
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  // ":name" stands for the id of the document a step created with that name
  path: string;
  body?: Record<string, unknown>;
  status?: number;
  // The name of the document this step creates
  creates?: string;
}

const reads = (): Step[] => (Object.keys(users) as UserName[]).flatMap(as => [
  { as, method: "GET", path: "/projects", status: 200 },
  { as, method: "GET", path: "/documents", status: 200 },
  { as, method: "GET", path: "/documents/1" },
  { as, method: "GET", path: "/documents/3" },
]);

export const scenario: Step[] = [
  { method: "GET", path: "/documents", status: 401 },
  ...reads(),

  // Creating needs write on the project
  { as: "alice", method: "POST", path: "/documents", body: { project_id: 1, title: "design", body: "Draft" }, status: 201, creates: "design" },
  { as: "carol", method: "POST", path: "/documents", body: { project_id: 1, title: "nope" }, status: 403 },
  { as: "dave", method: "POST", path: "/documents", body: { project_id: 1, title: "nope" }, status: 403 },
  { as: "carol", method: "POST", path: "/documents", body: { project_id: 2, title: "forecast" }, status: 201, creates: "forecast" },
  { as: "carol", method: "GET", path: "/documents/:forecast", status: 200 },

  // Updating needs write on the document, from its project or from a share
  { as: "alice", method: "PATCH", path: "/documents/1", body: { title: "spec v2" }, status: 200 },
  { as: "carol", method: "PATCH", path: "/documents/1", body: { title: "nope" }, status: 403 },
  { as: "dave", method: "PATCH", path: "/documents/1", body: { body: "Edited by dave" }, status: 200 },
  { as: "dave", method: "PATCH", path: "/documents/2", body: { title: "nope" }, status: 404 },
  { as: "alice", method: "PATCH", path: "/documents/3", body: { title: "nope" }, status: 403 },

  // Deleting needs delete, which owners have
  { as: "alice", method: "DELETE", path: "/documents/2", status: 403 },
  { as: "bob", method: "DELETE", path: "/documents/2", status: 204 },
  { as: "bob", method: "GET", path: "/documents/2", status: 404 },

  // Sharing gives at most the bits of the user who shares
  { as: "erin", method: "GET", path: "/documents/:design", status: 404 },
  { as: "alice", method: "PUT", path: "/documents/:design/shares/5", body: { access: "editor" }, status: 204 },
  { as: "erin", method: "PATCH", path: "/documents/:design", body: { title: "design v2" }, status: 200 },
  { as: "alice", method: "PUT", path: "/documents/3/shares/4", body: { access: "editor" }, status: 403 },
  { as: "alice", method: "PUT", path: "/documents/3/shares/4", body: { access: "viewer" }, status: 204 },
  { as: "dave", method: "GET", path: "/documents/3", status: 200 },
  { as: "alice", method: "PUT", path: "/documents/1/shares/3", body: { access: "editor" }, status: 204 },
  { as: "carol", method: "PATCH", path: "/documents/1", body: { title: "spec v3" }, status: 200 },
  // carol changes the share of dave, whose bits she has
  { as: "carol", method: "PUT", path: "/documents/1/shares/4", body: { access: "viewer" }, status: 204 },
  { as: "dave", method: "PATCH", path: "/documents/1", body: { title: "nope" }, status: 403 },
  { as: "erin", method: "PUT", path: "/documents/:forecast/shares/5", body: { access: "viewer" }, status: 404 },
  // dave only reads spec now, and cannot make erin an editor of it
  { as: "dave", method: "PUT", path: "/documents/1/shares/5", body: { access: "editor" }, status: 403 },

  // Deleting a shared document takes its shares along
  { as: "bob", method: "DELETE", path: "/documents/1", status: 204 },
  { as: "dave", method: "GET", path: "/documents/1", status: 404 },
  { as: "carol", method: "DELETE", path: "/documents/:design", status: 403 },
  { as: "erin", method: "DELETE", path: "/documents/:design", status: 403 },

  ...reads(),
];
