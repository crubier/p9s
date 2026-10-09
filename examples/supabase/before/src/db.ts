import { createClient, PostgrestError } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export type { Access } from "./database.types.ts";

const options = { auth: { persistSession: false, autoRefreshToken: false } };

// The server reads and writes every table with the service role key, which RLS lets through
export const supabase = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);

type Result<T> = PromiseLike<{ data: T, error: PostgrestError | null }>;

// The rows of a query, or its error thrown, as an Error which the error handler of Hono gets
export const rows = async <T>(query: Result<T>) => {
  const { data, error } = await query;
  if (error) throw new PostgrestError(error);
  return data as NonNullable<T>;
};

// The row of a query, null when there is none, or its error thrown
export const maybeRow = async <T>(query: Result<T>) => {
  const { data, error } = await query;
  if (error) throw new PostgrestError(error);
  return data;
};
