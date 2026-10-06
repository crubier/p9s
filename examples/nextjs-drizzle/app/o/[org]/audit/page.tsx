import { IconKey, IconUserShare } from "@tabler/icons-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBody, PageHeader } from "@/components/page-header";
import { Pager, pageNumber, searchHref } from "@/components/search-pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACCESS_LEVELS, can, levelOf } from "@/lib/permissions";
import { AUDIT_CATEGORIES, listAuditEvents, organizationPermission, type AuditCategory, type AuditRow } from "@/src/service";
import { requireActor } from "@/src/session";

const PAGE_SIZE = 50;

const KINDS: Record<string, string> = { space: "space", folder: "folder", document: "document", team: "team", member: "member", api_key: "API key", organization: "organization" };

function Subject({ slug, event }: { slug: string; event: AuditRow }) {
  const name = event.subjectName ?? "something deleted since";
  const href =
    event.subjectId && event.subjectKind === "document" ? `/o/${slug}/d/${event.subjectId}`
    : event.subjectId && (event.subjectKind === "folder" || event.subjectKind === "space") ? `/o/${slug}/f/${event.subjectId}`
    : undefined;
  return href ? <Link className="font-medium hover:underline" href={href}>{name}</Link> : <span className="font-medium">{name}</span>;
}

// "renamed document Budget plan (was Draft)", "shared folder Runbooks with Erin: Can edit"
function Description({ slug, event }: { slug: string; event: AuditRow }) {
  const kind = KINDS[event.subjectKind] ?? event.subjectKind;
  const level = levelOf(event.permission);
  const subject = <Subject slug={slug} event={event} />;
  switch (event.action) {
    case "commented":
      return <>commented on {subject}: <span className="text-muted-foreground">“{event.detail}”</span></>;
    case "deleted a comment":
      return <>deleted a comment on {subject}</>;
    case "renamed":
      return <>renamed {kind} {subject} <span className="text-muted-foreground">(was {event.detail})</span></>;
    case "moved":
      return <>moved {kind} {subject} to <span className="font-medium">{event.detail}</span></>;
    case "shared":
    case "changed access to":
      return <>{event.action === "shared" ? "shared" : "changed access to"} {kind} {subject} {event.action === "shared" ? "with" : "for"} <span className="font-medium">{event.detail}</span>: {level ? ACCESS_LEVELS[level].label : event.permission}</>;
    case "removed access to":
      return <>removed access to {kind} {subject} from <span className="font-medium">{event.detail}</span></>;
    case "added to":
    case "removed from":
      return <>{event.action === "added to" ? "added" : "removed"} <span className="font-medium">{event.detail}</span> {event.action === "added to" ? "to" : "from"} team {subject}</>;
    default:
      return <>{event.action} {kind} {subject}</>;
  }
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ category?: string; member?: string; page?: string }> }) {
  const { org: slug } = await params;
  const { category: categoryParam, member: memberId, page: pageParam } = await searchParams;
  const page = pageNumber(pageParam);
  const category = categoryParam && categoryParam in AUDIT_CATEGORIES ? (categoryParam as AuditCategory) : undefined;
  const actor = await requireActor(slug);
  if (!can(await organizationPermission(actor), "admin")) notFound();
  const found = await listAuditEvents(actor, { category, memberId: memberId && /^[0-9a-f-]{36}$/i.test(memberId) ? memberId : undefined, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 });
  const events = found.slice(0, PAGE_SIZE);
  const base = `/o/${slug}/audit`;
  const filter = (params: { category?: string; member?: string; page?: number }) => searchHref(base, { category, member: memberId, ...params });

  return (
    <>
      <PageHeader path={[{ label: actor.org.name, href: `/o/${slug}` }, { label: "Audit log" }]} />
      <PageBody className="flex flex-col gap-4 p-6">
        <p className="text-muted-foreground max-w-3xl text-sm">
          Triggers record what members change, shares and team memberships included, in a table that is a p9s leaf of the organization: RLS shows it
          to admins only. Changes made with an API key, or by an admin acting as a member, say so.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={category ? "outline" : "default"} render={<Link href={filter({ category: undefined, page: 1 })} />}>
            Everything
          </Badge>
          {(Object.entries(AUDIT_CATEGORIES) as [AuditCategory, string][]).map(([key, label]) => (
            <Badge key={key} variant={category === key ? "default" : "outline"} render={<Link href={filter({ category: key, page: 1 })} />}>
              {label}
            </Badge>
          ))}
          {memberId && (
            <Link className="text-muted-foreground ml-auto text-sm hover:underline" href={filter({ member: undefined, page: 1 })}>
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
                <TableRow key={event.id}>
                  <TableCell className="text-muted-foreground align-top text-xs whitespace-nowrap">
                    {new Date(event.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {event.actorMemberId ? (
                      <Link className="font-medium hover:underline" href={filter({ member: event.actorMemberId, page: 1 })}>{event.actorName}</Link>
                    ) : (
                      <span className="font-medium">{event.actorName}</span>
                    )}
                    {event.impersonatorName && (
                      <div className="flex items-center gap-1 text-xs text-amber-700"><IconUserShare className="size-3" /> by {event.impersonatorName}</div>
                    )}
                    {event.apiKeyName && (
                      <div className="text-muted-foreground flex items-center gap-1 text-xs"><IconKey className="size-3" /> API key {event.apiKeyName}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    <Description slug={slug} event={event} />
                  </TableCell>
                </TableRow>
              ))}
              {!events.length && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground py-6 text-center">Nothing yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <Pager page={page} pageSize={PAGE_SIZE} hasMore={found.length > PAGE_SIZE} href={(target) => filter({ page: target })} />
      </PageBody>
    </>
  );
}
