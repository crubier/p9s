import { Comments } from "@/components/comments";
import { DocumentEditor } from "@/components/document-editor";
import { ItemActions } from "@/components/item-actions";
import { PageBody, PageHeader } from "@/components/page-header";
import { PermissionBadge } from "@/components/permission-badge";
import { ShareDialog } from "@/components/share-dialog";
import { can } from "@/lib/permissions";
import { getDocument, listAccess } from "@/src/service";
import { requireActor } from "@/src/session";
import { orNotFound } from "../../data";

export default async function DocumentPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  const actor = await requireActor(slug);
  const { document, path, comments } = await orNotFound(getDocument(actor, id));
  const access = await listAccess(actor, document.resourceId);
  const base = `/o/${slug}`;
  const folder = path.at(-1);

  return (
    <>
      <PageHeader path={[{ label: actor.org.name, href: base }, ...path.map((item) => ({ label: item.name, href: `${base}/f/${item.id}` })), { label: document.title }]}>
        <PermissionBadge permission={document.permission} />
        <ShareDialog orgSlug={slug} resourceId={document.resourceId} name={document.title} permission={document.permission} access={access} />
        <ItemActions
          orgSlug={slug}
          kind="document"
          id={id}
          name={document.title}
          permission={document.permission}
          parentHref={folder ? `${base}/f/${folder.id}` : base}
        />
      </PageHeader>
      <PageBody className="flex max-w-3xl flex-col gap-8 p-6">
        <DocumentEditor key={document.updatedAt} orgSlug={slug} id={id} title={document.title} content={document.content} canEdit={can(document.permission, "edit")} />
        {document.author && <p className="text-muted-foreground -mt-6 text-xs">Created by {document.author}</p>}
        <Comments
          orgSlug={slug}
          documentId={id}
          comments={comments}
          canComment={can(document.permission, "comment")}
          canDelete={can(document.permission, "delete")}
        />
      </PageBody>
    </>
  );
}
