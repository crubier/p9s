import { InviteForm, MemberTable, TeamList } from "@/components/members";
import { PageBody, PageHeader } from "@/components/page-header";
import { Pager, SearchBox, pageNumber, searchHref } from "@/components/search-pager";
import { can } from "@/lib/permissions";
import { listMembers, listTeams, organizationPermission } from "@/src/service";
import { requireActor } from "@/src/session";

const PAGE_SIZE = 50;

export default async function MembersPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { org: slug } = await params;
  const { q: query, page: pageParam } = await searchParams;
  const page = pageNumber(pageParam);
  const actor = await requireActor(slug);
  const [{ members, total }, teams, permission] = await Promise.all([
    listMembers(actor, { query, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
    listTeams(actor),
    organizationPermission(actor),
  ]);
  const isAdmin = can(permission, "admin");
  const base = `/o/${slug}/members`;

  return (
    <>
      <PageHeader path={[{ label: actor.org.name, href: `/o/${slug}` }, { label: "Members and teams" }]} />
      <PageBody className="flex flex-col gap-8 p-6">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-semibold">Members</h2>
            <p className="text-muted-foreground text-sm">
              {isAdmin
                ? "Members and teams are rows that RLS lets admins write. Team memberships are role edges, written by the server once it checked you are an admin. View as a member to see the organization through their permissions."
                : "Everyone in the organization can see who is in it. Only admins can change it."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SearchBox query={query} placeholder="Search members" />
            {isAdmin && <InviteForm orgSlug={slug} />}
          </div>
          <MemberTable orgSlug={slug} members={members} teams={teams} isAdmin={isAdmin} currentMemberId={actor.memberId} />
          <Pager page={page} pageSize={PAGE_SIZE} total={total} href={(target) => searchHref(base, { q: query, page: target })} />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Teams</h2>
          <TeamList orgSlug={slug} teams={teams} isAdmin={isAdmin} />
        </section>
      </PageBody>
    </>
  );
}
