import { ItemList } from "@/components/item-list";
import { PageBody, PageHeader } from "@/components/page-header";
import { countReadable, listDocuments, listShared, listSpaces } from "@/src/service";
import { requireActor } from "@/src/session";

export default async function OrganizationHome({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const actor = await requireActor(slug);
  const [spaces, { folders: sharedFolders, documents: sharedDocuments }, documents, readable] = await Promise.all([
    listSpaces(actor),
    listShared(actor),
    listDocuments(actor, { limit: 8 }),
    countReadable(actor),
  ]);

  return (
    <>
      <PageHeader path={[{ label: actor.org.name }]} />
      <PageBody className="flex flex-col gap-8 p-6">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-semibold">Spaces</h2>
            <p className="text-muted-foreground text-sm">
              You can read {readable.documents.toLocaleString("en")} documents in {readable.folders.toLocaleString("en")} folders.
            </p>
          </div>
          <ItemList
            orgSlug={slug}
            items={spaces.map((space) => ({ kind: "folder", ...space }))}
            empty="No space was shared with you yet."
          />
        </section>
        {sharedFolders.length + sharedDocuments.length > 0 && (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="font-semibold">Shared with you</h2>
              <p className="text-muted-foreground text-sm">In spaces you cannot see, so RLS hides the folders they are in.</p>
            </div>
            <ItemList
              orgSlug={slug}
              items={[
                ...sharedFolders.map((folder) => ({ kind: "folder" as const, ...folder })),
                ...sharedDocuments.map((document) => ({ kind: "document" as const, ...document, name: document.title })),
              ]}
              empty=""
            />
          </section>
        )}
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Recent documents</h2>
          <ItemList
            orgSlug={slug}
            items={documents.map((document) => ({ kind: "document", ...document, name: document.title }))}
            empty="No documents yet."
          />
        </section>
      </PageBody>
    </>
  );
}
