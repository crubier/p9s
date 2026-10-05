import { sql } from "drizzle-orm";
import { SignInForm } from "@/components/sign-in-form";
import { db, rows } from "@/src/db";
import { MOCK_DOMAIN, mockExamples } from "@/src/mock/people";

export const dynamic = "force-dynamic";

export default async function SignIn() {
  const [found] = await rows<{ count: number }>(db, sql`select count(*)::int as count from "user" where email like ${`%@${MOCK_DOMAIN}`}`);
  const mockUsers = found?.count ?? 0;
  return <SignInForm mockUsers={mockUsers} mockExamples={mockUsers ? mockExamples(mockUsers) : []} />;
}
