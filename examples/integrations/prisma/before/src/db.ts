import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";

export type Access = "viewer" | "editor" | "owner";

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// The API answers with the names of the columns
export const documentOf = ({ id, projectId, title, body }: { id: number, projectId: number, title: string, body: string }) =>
  ({ id, project_id: projectId, title, body });
