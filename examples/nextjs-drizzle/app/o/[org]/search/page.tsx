import { ItemList } from "@/components/item-list";
import { PageHeader } from "@/components/page-header";
import { SearchBox } from "@/components/search-pager";
import { search } from "@/src/service";
import { requireActor } from "@/src/session";

export default async function SearchPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string }> }) {
  const { org: slug } = await params;
  const { q: query = "" } = await searchParams;
  const actor = await requireActor(slug);
  const found = query.trim() ? await search(actor, query) : undefined;

  return (
    <>
      <PageHeader path={[{ label: actor.org.name, href: `/o/${slug}` }, { label: "Search" }]} />
      <div className="flex max-w-4xl flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <SearchBox query={query} placeholder="Search folders and documents" />
          <p className="text-muted-foreground text-sm">
            A plain <code>ilike</code> query: RLS leaves out what you cannot read, the application does not filter anything.
          </p>
        </div>
        {found && (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="font-semibold">Folders</h2>
              <ItemList orgSlug={slug} items={found.folders.map((row) => ({ kind: "folder", ...row }))} empty="No folder matches." />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="font-semibold">Documents</h2>
              <ItemList orgSlug={slug} items={found.documents.map((row) => ({ kind: "document", ...row, name: row.title }))} empty="No document matches." />
            </section>
          </>
        )}
      </div>
    </>
  );
}
