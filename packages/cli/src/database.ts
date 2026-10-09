import pg from "pg";

// A connection to the database of --database-url, or of DATABASE_URL
export async function connect(databaseUrl: string | undefined = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("Pass --database-url <url> or set DATABASE_URL");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}
