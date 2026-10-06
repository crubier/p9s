import { Link, Navigate, Outlet, useParams } from "react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { ImpersonationBanner } from "@/components/impersonation";
import { PageState } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { OrganizationProvider, useApi } from "@/lib/api";
import { OrganizationLayoutQuery } from "@/lib/operations";
import { can } from "@/lib/permissions";

export function OrganizationLayout() {
  const { org: slug = "" } = useParams();
  const layout = useApi(OrganizationLayoutQuery, { slug }, { org: slug });
  if (!layout.data) return <PageState error={layout.error} />;
  const { viewer, myOrganizations, currentMember, currentImpersonation, organizationBySlug: org } = layout.data;
  if (!viewer) return <Navigate to="/sign-in" replace />;
  // Organizations the user is not a member of are hidden by RLS, as if they did not exist
  if (!org || !currentMember) {
    return (
      <div className="bg-muted flex min-h-svh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>No such organization</CardTitle>
            <CardDescription>
              It does not exist, or you are not a member of it.{" "}
              <Link className="underline" to="/">
                Go to your organizations
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <OrganizationProvider
      value={{
        rowId: org.rowId,
        name: org.name,
        slug: org.slug,
        permission: org.permission ?? null,
        member: { rowId: currentMember.rowId, name: currentMember.name ?? "" },
        impersonation: currentImpersonation?.adminName ? { adminName: currentImpersonation.adminName, readOnly: currentImpersonation.readOnly ?? true } : null,
      }}
    >
      <SidebarProvider>
        <AppSidebar
          org={org}
          organizations={(myOrganizations?.nodes ?? []).flatMap((other) => (other ? [other] : []))}
          user={{ name: viewer.name ?? "", email: viewer.email ?? "" }}
          spaces={org.spaces.nodes.flatMap((space) => (space ? [space] : []))}
          isAdmin={can(org.permission, "admin")}
          canCreateSpace={can(org.permission, "create")}
        />
        <SidebarInset className="bg-sidebar min-w-0 md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0 md:pr-2 md:pb-2 md:peer-data-[state=collapsed]:pl-2">
          <ImpersonationBanner />
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </OrganizationProvider>
  );
}
