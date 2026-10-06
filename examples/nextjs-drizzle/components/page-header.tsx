import Link from "next/link";
import { Fragment } from "react";
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HeaderSearch } from "./header-search";

type Crumb = { label: string; href?: string };

// Folders nest deep: past 4 crumbs, the ones between the organization and the last two go in a menu
export function PageHeader({ path, children }: { path: Crumb[]; children?: React.ReactNode }) {
  const hidden = path.length > 4 ? path.slice(1, -2) : [];
  const shown: (Crumb | "hidden")[] = hidden.length ? [path[0]!, "hidden", ...path.slice(-2)] : path;
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:mt-2 md:px-2">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {shown.map((item, index) => (
            <Fragment key={index}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {item === "hidden" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={`${hidden.length} more folders`} className="hover:text-foreground">
                      <BreadcrumbEllipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {hidden.map((crumb, depth) => (
                        <DropdownMenuItem key={depth} render={<Link href={crumb.href ?? "#"} />}>
                          {crumb.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : item.href ? (
                  <BreadcrumbLink className="truncate" render={<Link href={item.href} />}>
                    {item.label}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">{item.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <HeaderSearch />
      </div>
    </header>
  );
}

// The card of the page's own content, below the header which is part of the app shell
export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="bg-background min-w-0 flex-1 md:rounded-xl md:border md:shadow-sm">
      <div className={className}>{children}</div>
    </div>
  );
}
