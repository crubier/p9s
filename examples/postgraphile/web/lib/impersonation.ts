// `<organization id>:<member id>:<view|act>`, which the server follows while the signed-in user is an admin of the
// organization, see src/identity.ts. It gives no right, so the page sets it
const COOKIE = "p9s-impersonation";

export type ImpersonationMode = "view" | "act";

const secure = () => (location.protocol === "https:" ? "; secure" : "");

export const setImpersonation = (orgId: string, memberId: string, mode: ImpersonationMode) => {
  document.cookie = `${COOKIE}=${encodeURIComponent(`${orgId}:${memberId}:${mode}`)}; path=/; samesite=lax${secure()}`;
};

export const clearImpersonation = () => {
  document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax${secure()}`;
};
