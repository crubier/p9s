import { redirect } from "next/navigation";
import { listMemberships } from "@/src/service";
import { requireUser } from "@/src/session";

export default async function Home() {
  const user = await requireUser();
  const [first] = await listMemberships(user.id);
  redirect(first ? `/o/${first.slug}` : "/onboarding");
}
