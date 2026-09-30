import { setupTests as setupPgliteTests } from "./pglite";
import { setupTests as setupPgTests } from "./pg";

// Point this at a superuser connection (e.g. postgresql://postgres:postgres@localhost:54321/postgres) to run against real Postgres
export const testDatabaseUrl = process.env.P9S_TEST_DATABASE_URL;

export const setupTests = () => testDatabaseUrl ? setupPgTests(testDatabaseUrl) : setupPgliteTests();
