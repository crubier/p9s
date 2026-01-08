import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.development.local" }); // or .env.local

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql);

