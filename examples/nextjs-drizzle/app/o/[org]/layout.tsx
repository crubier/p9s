import { AppSidebar } from "@/components/app-sidebar";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { can } from "@/lib/permissions";
import { listMemberships, listSpaces, organizationPermission } from "@/src/service";
import { requireActor, requireUser } from "@/src/session";

export default async function OrganizationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const user = await requireUser();
  const actor = await requireActor(slug);
  const [organizations, spaces, permission] = await Promise.all([listMemberships(user.id), listSpaces(actor), organizationPermission(actor)]);

  return (
    <SidebarProvider>
      <AppSidebar
        org={actor.org}
        organizations={organizations}
        user={{ name: user.name, email: user.email }}
        spaces={spaces}
        isAdmin={can(permission, "admin")}
        canCreateSpace={can(permission, "create")}
      />
      <SidebarInset>
        {actor.impersonator && (
          <ImpersonationBanner orgSlug={slug} name={actor.name} impersonator={actor.impersonator.name} readOnly={actor.impersonator.readOnly} />
        )}
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
