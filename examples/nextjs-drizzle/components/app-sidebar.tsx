"use client";

import {
  IconBinaryTree,
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
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { NewItemButton } from "./new-item-button";

export interface AppSidebarProps {
  org: { name: string; slug: string };
  organizations: { id: string; name: string; slug: string }[];
  user: { name: string; email: string };
  spaces: { id: string; name: string }[];
  isAdmin: boolean;
  canCreateSpace: boolean;
}

export function AppSidebar({ org, organizations, user, spaces, isAdmin, canCreateSpace }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/o/${org.slug}`;
  const link = (href: string, label: string, Icon: typeof IconHome) => (
    <SidebarMenuItem key={href}>
      <SidebarMenuButton isActive={pathname === href} render={<Link href={href} />}>
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
                    <span className="text-muted-foreground truncate text-xs">p9s example</span>
                  </div>
                  <IconChevronDown className="ml-auto" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">Organizations</DropdownMenuLabel>
                  {organizations.map((other) => (
                    <DropdownMenuItem key={other.id} render={<Link href={`/o/${other.slug}`} />}>
                      {other.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/onboarding" />}>
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
            {spaces.map((space) => link(`${base}/f/${space.id}`, space.name, IconFolder))}
            {canCreateSpace && (
              <SidebarMenuItem>
                <NewItemButton orgSlug={org.slug} kind="space" parentId={null}>
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
                    router.push("/sign-in");
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
