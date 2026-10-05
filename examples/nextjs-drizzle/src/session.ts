import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { getActor, impersonated, type Actor, type ImpersonationMode } from "./service";

export const getUser = cache(async () => (await auth.api.getSession({ headers: await headers() }))?.user);

export const requireUser = async () => {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  return user;
};

// `<organization id>:<member id>:<view|act>`, set when an admin starts viewing or acting as a member. It names who to
// impersonate, and gives no right: it is only followed while the signed-in user is an admin of that organization
export const IMPERSONATION_COOKIE = "p9s-impersonation";

const readImpersonation = async (orgId: string) => {
  const [cookieOrgId, memberId, mode] = ((await cookies()).get(IMPERSONATION_COOKIE)?.value ?? "").split(":");
  return cookieOrgId === orgId && memberId && (mode === "view" || mode === "act") ? { memberId, mode: mode as ImpersonationMode } : undefined;
};

// The signed-in user, as a member of the organization in the URL
export const requireRealActor = cache(async (orgSlug: string) => {
  const user = await requireUser();
  const actor = await getActor(user.id, orgSlug);
  if (!actor) notFound();
  return actor;
});

// Who requests act as: the signed-in member, or the member an admin views or acts as
export const requireActor = cache(async (orgSlug: string): Promise<Actor> => {
  const actor = await requireRealActor(orgSlug);
  const impersonation = await readImpersonation(actor.org.id);
  return (impersonation && (await impersonated(actor, impersonation.memberId, impersonation.mode))) || actor;
});
