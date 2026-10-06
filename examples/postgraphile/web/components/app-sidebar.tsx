import {
  IconBinaryTree,
  IconBrandGraphql,
  IconChevronDown,
  IconFolder,
  IconHistory,
  IconHome,
  IconKey,
  IconLock,
  IconLogout,
  IconPlus,
  IconTable,
  IconUsers,
} from "@tabler/icons-react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { graphiqlHref } from "@/lib/graphql";
import { OrganizationLayoutQuery } from "@/lib/operations";
import { NewItemButton } from "./new-item-button";

export interface AppSidebarProps {
  org: { name: string; slug: string };
  organizations: { rowId: string; name: string; slug: string }[];
  user: { name: string; email: string };
  spaces: { rowId: string; name: string }[];
  isAdmin: boolean;
  canCreateSpace: boolean;
}

export function AppSidebar({ org, organizations, user, spaces, isAdmin, canCreateSpace }: AppSidebarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const base = `/o/${org.slug}`;
  const link = (href: string, label: string, Icon: typeof IconHome) => (
    <SidebarMenuItem key={href}>
      <SidebarMenuButton isActive={pathname === href} render={<Link to={href} />}>
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
                  <IconBinaryTree className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{org.name}</span>
                  <span className="text-muted-foreground truncate text-xs">PostGraphile example</span>
                </div>
                <IconChevronDown className="ml-auto" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">Organizations</DropdownMenuLabel>
                  {organizations.map((other) => (
                    <DropdownMenuItem key={other.rowId} render={<Link to={`/o/${other.slug}`} />}>
                      {other.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link to="/onboarding" />}>
                  <IconPlus /> New organization
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>{link(base, "Home", IconHome)}</SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Spaces</SidebarGroupLabel>
          <SidebarMenu>
            {spaces.map((space) => link(`${base}/f/${space.rowId}`, space.name, IconFolder))}
            {canCreateSpace && (
              <SidebarMenuItem>
                <NewItemButton kind="space" parentId={null}>
                  <SidebarMenuButton className="text-muted-foreground">
                    <IconPlus />
                    <span>New space</span>
                  </SidebarMenuButton>
                </NewItemButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Organization</SidebarGroupLabel>
          <SidebarMenu>
            {link(`${base}/members`, "Members and teams", IconUsers)}
            {isAdmin && link(`${base}/access`, "Access overview", IconTable)}
            {isAdmin && link(`${base}/audit`, "Audit log", IconHistory)}
            {link(`${base}/api-keys`, "API keys", IconKey)}
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href={graphiqlHref(OrganizationLayoutQuery, { slug: org.slug }, org.slug)} target="_blank" rel="noreferrer" />}>
                <IconBrandGraphql />
                <span>GraphiQL</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <div className="bg-muted flex size-8 items-center justify-center rounded-lg text-xs font-medium">
                  {user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                </div>
                {isAdmin && <IconLock className="text-muted-foreground ml-auto size-4" aria-label="Admin" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" align="end" side="top">
                <DropdownMenuItem
                  onClick={async () => {
                    await authClient.signOut();
                    navigate("/sign-in");
                  }}
                >
                  <IconLogout /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
