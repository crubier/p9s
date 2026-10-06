import { IconFilePlus, IconFolderPlus } from "@tabler/icons-react";
import { ItemActions } from "@/components/item-actions";
import { ItemList } from "@/components/item-list";
import { NewItemButton } from "@/components/new-item-button";
import { PageBody, PageHeader } from "@/components/page-header";
import { ShareDialog } from "@/components/share-dialog";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { getFolder, listAccess } from "@/src/service";
import { requireActor } from "@/src/session";
import { orNotFound } from "../../data";

export default async function FolderPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const actor = await requireActor(slug);
  const { folder, path, folders, documents } = await orNotFound(getFolder(actor, id));
  const access = await listAccess(actor, folder.resourceId);
  const base = `/o/${slug}`;
  const parent = path.at(-2);

  return (
    <>
      <PageHeader path={[{ label: actor.org.name, href: base }, ...path.map((item) => ({ label: item.name, href: item.id === id ? undefined : `${base}/f/${item.id}` }))]} />
      <PageBody className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-xl font-semibold">{folder.name}</h1>
          {can(folder.permission, "create") && (
            <>
              <NewItemButton orgSlug={slug} kind="folder" parentId={id}>
                <Button variant="outline" size="sm">
                  <IconFolderPlus /> New folder
                </Button>
              </NewItemButton>
              <NewItemButton orgSlug={slug} kind="document" parentId={id}>
                <Button size="sm">
                  <IconFilePlus /> New document
                </Button>
              </NewItemButton>
            </>
          )}
          <ShareDialog orgSlug={slug} resourceId={folder.resourceId} name={folder.name} permission={folder.permission} access={access} />
          <ItemActions
            orgSlug={slug}
            kind="folder"
            id={id}
            name={folder.name}
            permission={folder.permission}
            parentHref={parent ? `${base}/f/${parent.id}` : base}
          />
        </div>
        <ItemList
          orgSlug={slug}
          items={[
            ...folders.map((child) => ({ kind: "folder" as const, ...child })),
            ...documents.map((document) => ({ kind: "document" as const, ...document, name: document.title })),
          ]}
          empty="This folder is empty."
        />
      </PageBody>
    </>
  );
}
