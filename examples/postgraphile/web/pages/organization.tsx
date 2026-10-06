import { IconKey, IconUserShare } from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";
import { ViewAsButton } from "@/components/impersonation";
import { ApiKeys } from "@/components/api-keys";
import { InviteForm, MemberTable, TeamList } from "@/components/members";
import { PageBody, PageHeader, PageState } from "@/components/page-header";
import { PermissionBadge } from "@/components/permission-badge";
import { Pager, SearchBox, pageNumber, searchHref } from "@/components/search-pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditQuery as AuditResult } from "@/gql/graphql";
import { useApi, useOrganization } from "@/lib/api";
import { AccessOverviewQuery, ApiKeysQuery, AuditQuery, MembersQuery } from "@/lib/operations";
import { ACCESS_LEVELS, can, levelOf } from "@/lib/permissions";
import { parseTime } from "@/lib/time";

const present = <T,>(nodes: (T | null)[]) => nodes.flatMap((node) => (node ? [node] : []));

const MEMBERS_PAGE_SIZE = 50;

export function MembersPage() {
  const { name, slug, permission } = useOrganization();
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";
  const page = pageNumber(params.get("page"));
  const variables = { slug, query, first: MEMBERS_PAGE_SIZE, offset: (page - 1) * MEMBERS_PAGE_SIZE };
  const found = useApi(MembersQuery, variables);
  const isAdmin = can(permission, "admin");
  const org = found.data?.organizationBySlug;
  const header = <PageHeader path={[{ label: name, href: `/o/${slug}` }, { label: "Members and teams" }]} operation={{ document: MembersQuery, variables, org: slug }} />;
  if (!org) {
    return (
      <>
        {header}
        <PageState error={found.error} />
      </>
    );
  }
  const teams = present(org.teams.nodes)
    .map((team) => ({ rowId: team.rowId, name: team.name, members: team.memberCount ?? 0, administers: team.administers ?? false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const members = present(org.members.nodes).map((member) => ({
    rowId: member.rowId,
    name: member.name ?? "",
    email: member.email ?? "",
    teamIds: present(member.teams.nodes).map((team) => team.rowId),
  }));

  return (
    <>
      {header}
      <PageBody className="flex flex-col gap-8 p-6">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-semibold">Members</h2>
            <p className="text-muted-foreground text-sm">
              {isAdmin
                ? "Members and teams change through SQL functions that check you are an admin. Team memberships are role edges of the graph. View as a member to see the organization through their permissions."
                : "Everyone in the organization can see who is in it. Only admins can change it."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SearchBox query={query} placeholder="Search members" />
            {isAdmin && <InviteForm />}
          </div>
          <MemberTable members={members} teams={teams} isAdmin={isAdmin} />
          <Pager page={page} pageSize={MEMBERS_PAGE_SIZE} total={org.members.totalCount} href={(target) => searchHref(`/o/${slug}/members`, { q: query, page: target })} />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Teams</h2>
          <TeamList teams={teams} isAdmin={isAdmin} />
        </section>
      </PageBody>
    </>
  );
}

const ACCESS_PAGE_SIZE = 25;

export function AccessPage() {
  const { name, slug, permission, member: current } = useOrganization();
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";
  const page = pageNumber(params.get("page"));
  const variables = { slug, query, first: ACCESS_PAGE_SIZE, offset: (page - 1) * ACCESS_PAGE_SIZE };
  const isAdmin = can(permission, "admin");
  const found = useApi(AccessOverviewQuery, variables, { enabled: isAdmin });
  const org = found.data?.organizationBySlug;
  const header = <PageHeader path={[{ label: name, href: `/o/${slug}` }, { label: "Access overview" }]} operation={{ document: AccessOverviewQuery, variables, org: slug }} />;
  if (!isAdmin || !org) {
    return (
      <>
        {header}
        <PageState error={isAdmin ? found.error : new Error("Only admins can see what everyone can do.")} />
      </>
    );
  }
  const spaces = present(org.spaces.nodes);

  return (
    <>
      {header}
      <PageBody className="flex min-w-0 flex-col gap-4 p-6">
        <p className="text-muted-foreground max-w-3xl text-sm">
          What each member can do in each space, from <code>resource_permission(resource_id, role_id)</code> in the <code>spacePermissions</code> field of members.
          It only answers admins, who can ask about someone else. View as a member to browse with their permissions.
        </p>
        <SearchBox query={query} placeholder="Search members" />
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="bg-background sticky left-0">Member</TableHead>
                {spaces.map((space) => (
                  <TableHead key={space.rowId}>
                    <Link className="hover:underline" to={`/o/${slug}/f/${space.rowId}`}>
                      {space.name}
                    </Link>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {present(org.members.nodes).map((member) => (
                <TableRow key={member.rowId}>
                  <TableCell className="bg-background sticky left-0">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{member.name}</div>
                        <div className="text-muted-foreground text-xs">{member.email}</div>
                      </div>
                      {member.rowId !== current.rowId && <ViewAsButton memberId={member.rowId} name={member.name ?? ""} />}
                    </div>
                  </TableCell>
                  {spaces.map((space, index) => (
                    <TableCell key={space.rowId}>
                      <PermissionBadge permission={member.spacePermissions?.[index] ?? null} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Pager page={page} pageSize={ACCESS_PAGE_SIZE} total={org.members.totalCount} href={(target) => searchHref(`/o/${slug}/access`, { q: query, page: target })} />
      </PageBody>
    </>
  );
}

const AUDIT_PAGE_SIZE = 50;

// The categories of `organization_audit_events` in sql/app.sql
const AUDIT_CATEGORIES = {
  content: "Content",
  sharing: "Sharing",
  people: "Members and teams",
  impersonation: "Impersonation",
  api: "API",
} as const;

type AuditCategory = keyof typeof AUDIT_CATEGORIES;

type AuditRow = NonNullable<NonNullable<AuditResult["organizationBySlug"]>["auditEvents"]["nodes"][number]>;

const KINDS: Record<string, string> = { space: "space", folder: "folder", document: "document", team: "team", member: "member", api_key: "API key", organization: "organization" };

function Subject({ slug, event }: { slug: string; event: AuditRow }) {
  const name = event.subjectName ?? "something deleted since";
  const href =
    event.subjectId && event.subjectKind === "document"
      ? `/o/${slug}/d/${event.subjectId}`
      : event.subjectId && (event.subjectKind === "folder" || event.subjectKind === "space")
        ? `/o/${slug}/f/${event.subjectId}`
        : undefined;
  return href ? (
    <Link className="font-medium hover:underline" to={href}>
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

// "renamed document Budget plan (was Draft)", "shared folder Runbooks with Erin: Can edit"
function Description({ slug, event }: { slug: string; event: AuditRow }) {
  const kind = KINDS[event.subjectKind] ?? event.subjectKind;
  const level = levelOf(event.granted);
  const subject = <Subject slug={slug} event={event} />;
  switch (event.action) {
    case "commented":
      return (
        <>
          commented on {subject}: <span className="text-muted-foreground">“{event.detail}”</span>
        </>
      );
    case "deleted a comment":
      return <>deleted a comment on {subject}</>;
    case "renamed":
      return (
        <>
          renamed {kind} {subject} <span className="text-muted-foreground">(was {event.detail})</span>
        </>
      );
    case "moved":
      return (
        <>
          moved {kind} {subject} to <span className="font-medium">{event.detail}</span>
        </>
      );
    case "shared":
    case "changed access to":
      return (
        <>
          {event.action === "shared" ? "shared" : "changed access to"} {kind} {subject} {event.action === "shared" ? "with" : "for"}{" "}
          <span className="font-medium">{event.detail}</span>: {level ? ACCESS_LEVELS[level].label : event.granted?.bitmap}
        </>
      );
    case "removed access to":
      return (
        <>
          removed access to {kind} {subject} from <span className="font-medium">{event.detail}</span>
        </>
      );
    case "added to":
    case "removed from":
      return (
        <>
          {event.action === "added to" ? "added" : "removed"} <span className="font-medium">{event.detail}</span> {event.action === "added to" ? "to" : "from"} team{" "}
          {subject}
        </>
      );
    default:
      return (
        <>
          {event.action} {kind} {subject}
        </>
      );
  }
}

export function AuditPage() {
  const { name, slug, permission } = useOrganization();
  const [params] = useSearchParams();
  const categoryParam = params.get("category");
  const category = categoryParam && categoryParam in AUDIT_CATEGORIES ? (categoryParam as AuditCategory) : undefined;
  const memberParam = params.get("member");
  const memberId = memberParam && /^[0-9a-f-]{36}$/i.test(memberParam) ? memberParam : undefined;
  const page = pageNumber(params.get("page"));
  const variables = { slug, category: category ?? null, memberId: memberId ?? null, first: AUDIT_PAGE_SIZE + 1, offset: (page - 1) * AUDIT_PAGE_SIZE };
  const isAdmin = can(permission, "admin");
  const found = useApi(AuditQuery, variables, { enabled: isAdmin });
  const base = `/o/${slug}/audit`;
  const filter = (next: { category?: string; member?: string; page?: number }) => searchHref(base, { category, member: memberId, ...next });
  const header = <PageHeader path={[{ label: name, href: `/o/${slug}` }, { label: "Audit log" }]} operation={{ document: AuditQuery, variables, org: slug }} />;
  const org = found.data?.organizationBySlug;
  if (!isAdmin || !org) {
    return (
      <>
        {header}
        <PageState error={isAdmin ? found.error : new Error("Only admins can see the audit log.")} />
      </>
    );
  }
  const all = present(org.auditEvents.nodes);
  const events = all.slice(0, AUDIT_PAGE_SIZE);

  return (
    <>
      {header}
      <PageBody className="flex flex-col gap-4 p-6">
        <p className="text-muted-foreground max-w-3xl text-sm">
          Triggers record what members change, shares and team memberships included, in a table that is a p9s leaf of the organization: RLS shows it to
          admins only. Changes made with an API key, or by an admin acting as a member, say so.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={category ? "outline" : "default"} render={<Link to={filter({ category: undefined, page: 1 })} />}>
            Everything
          </Badge>
          {(Object.entries(AUDIT_CATEGORIES) as [AuditCategory, string][]).map(([key, label]) => (
            <Badge key={key} variant={category === key ? "default" : "outline"} render={<Link to={filter({ category: key, page: 1 })} />}>
              {label}
            </Badge>
          ))}
          {memberId && (
            <Link className="text-muted-foreground ml-auto text-sm hover:underline" to={filter({ member: undefined, page: 1 })}>
              Show everyone
            </Link>
          )}
        </div>
        <div className="rounded-lg border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">When</TableHead>
                <TableHead className="w-44">Who</TableHead>
                <TableHead>What</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.rowId}>
                  <TableCell className="text-muted-foreground align-top text-xs whitespace-nowrap">
                    {parseTime(event.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {event.actorMemberId ? (
                      <Link className="font-medium hover:underline" to={filter({ member: event.actorMemberId, page: 1 })}>
                        {event.actorName}
                      </Link>
                    ) : (
                      <span className="font-medium">{event.actorName}</span>
                    )}
                    {event.impersonatorName && (
                      <div className="flex items-center gap-1 text-xs text-amber-700">
                        <IconUserShare className="size-3" /> by {event.impersonatorName}
                      </div>
                    )}
                    {event.apiKeyName && (
                      <div className="text-muted-foreground flex items-center gap-1 text-xs">
                        <IconKey className="size-3" /> API key {event.apiKeyName}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    <Description slug={slug} event={event} />
                  </TableCell>
                </TableRow>
              ))}
              {!events.length && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground py-6 text-center">
                    Nothing yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <Pager page={page} pageSize={AUDIT_PAGE_SIZE} hasMore={all.length > AUDIT_PAGE_SIZE} href={(target) => filter({ page: target })} />
      </PageBody>
    </>
  );
}

export function ApiKeysPage() {
  const { name, slug, member, impersonation } = useOrganization();
  const found = useApi(ApiKeysQuery, {});
  const header = <PageHeader path={[{ label: name, href: `/o/${slug}` }, { label: "API keys" }]} operation={{ document: ApiKeysQuery, org: slug }} />;
  if (!found.data) {
    return (
      <>
        {header}
        <PageState error={found.error} />
      </>
    );
  }
  const keys = present(found.data.myApiKeys?.nodes ?? []).flatMap((key) =>
    key.rowId ? [{ rowId: key.rowId, name: key.name ?? "", tokenStart: key.tokenStart ?? "", lastUsedAt: key.lastUsedAt ?? null }] : [],
  );

  return (
    <>
      {header}
      <PageBody className="flex flex-col gap-4 p-6">
        <p className="text-muted-foreground text-sm">
          A key acts as you in {name}, with exactly your permissions, and follows them when they change. It is a role leaf in p9s: it has its own role id,
          so the audit log knows which key made a change, but it is not a node of the graph.
        </p>
        {impersonation && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            These are {member.name}&apos;s keys. Only they can create or revoke them, not an admin acting as them.
          </p>
        )}
        <ApiKeys keys={keys} />
      </PageBody>
    </>
  );
}
