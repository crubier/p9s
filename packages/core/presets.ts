// Engine settings for Supabase, to spread in engine: PostgREST runs the requests of signed in users as authenticated,
// and auth.uid() is their role id when the table of their profiles is a role table with roleId "id", the id of
// auth.users. The service role writes the graph, and anon reads nothing.
export const supabase = {
  users: ["authenticated" as const],
  graphWriters: ["service_role"],
  authentication: { getCurrentUserId: "auth.uid" },
  id: { mode: "uuid" as const },
};
