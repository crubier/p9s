import { sql } from "drizzle-orm";
import { SignInForm } from "@/components/sign-in-form";
import { db, rows } from "@/src/db";
import { MOCK_DOMAIN, mockExamples } from "@/src/mock/people";

export const dynamic = "force-dynamic";

export default async function SignIn() {
  const [found] = await rows<{ mock: number; acme: boolean }>(
    db,
    sql`select count(*) filter (where email like ${`%@${MOCK_DOMAIN}`})::int as mock, coalesce(bool_or(email = 'alice@acme.test'), false) as acme from "user"`,
  );
  const mockUsers = found?.mock ?? 0;
  return <SignInForm acme={found?.acme ?? false} mockUsers={mockUsers} mockExamples={mockUsers ? mockExamples(mockUsers) : []} />;
}
