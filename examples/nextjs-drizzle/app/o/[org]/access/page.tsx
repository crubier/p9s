import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PermissionBadge } from "@/components/permission-badge";
import { Pager, SearchBox, pageNumber, searchHref } from "@/components/search-pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ViewAsButton } from "@/components/view-as-button";
import { ForbiddenError } from "@/src/db";
import { accessMatrix } from "@/src/service";
import { requireActor } from "@/src/session";

const PAGE_SIZE = 25;

export default async function AccessPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { org: slug } = await params;
  const { q: query, page: pageParam } = await searchParams;
  const page = pageNumber(pageParam);
  const actor = await requireActor(slug);
  const { spaces, members, total } = await accessMatrix(actor, { query, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }).catch((error) =>
    error instanceof ForbiddenError ? notFound() : Promise.reject(error),
  );

  return (
    <>
      <PageHeader path={[{ label: actor.org.name, href: `/o/${slug}` }, { label: "Access overview" }]} />
      <div className="flex min-w-0 flex-col gap-4 p-6">
        <p className="text-muted-foreground max-w-3xl text-sm">
          What each member can do in each space, from <code>resource_permission(resource_id, role_id)</code>. Only the graph writer role can ask about
          someone else, so the server checks that you are an admin first. View as a member to browse with their permissions.
        </p>
        <SearchBox query={query} placeholder="Search members" />
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="bg-background sticky left-0">Member</TableHead>
                {spaces.map((space) => (
                  <TableHead key={space.id}>
                    <Link className="hover:underline" href={`/o/${slug}/f/${space.id}`}>{space.name}</Link>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="bg-background sticky left-0">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{member.name}</div>
                        <div className="text-muted-foreground text-xs">{member.email}</div>
                      </div>
                      {member.id !== actor.memberId && <ViewAsButton orgSlug={slug} memberId={member.id} name={member.name} />}
                    </div>
                  </TableCell>
                  {member.permissions.map((permission, index) => (
                    <TableCell key={spaces[index]!.id}>
                      <PermissionBadge permission={permission} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Pager page={page} pageSize={PAGE_SIZE} total={total} href={(target) => searchHref(`/o/${slug}/access`, { q: query, page: target })} />
      </div>
    </>
  );
}
