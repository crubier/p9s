import { useParams, useSearchParams } from "react-router";
import { Comments } from "@/components/comments";
import { DocumentEditor } from "@/components/document-editor";
import { ItemActions } from "@/components/item-actions";
import { documentItem, folderItem, ItemList } from "@/components/item-list";
import { AddMenu } from "@/components/new-item-button";
import { PageBody, PageHeader, PageState } from "@/components/page-header";
import { SearchBox } from "@/components/search-pager";
import { ShareDialog } from "@/components/share-dialog";
import { useApi, useOrganization } from "@/lib/api";
import { DocumentQuery, FolderQuery, OrganizationHomeQuery, RecentDocumentsQuery, SearchQuery } from "@/lib/operations";
import { can } from "@/lib/permissions";

const present = <T,>(nodes: (T | null)[]) => nodes.flatMap((node) => (node ? [node] : []));

export function OrganizationHome() {
  const { name, slug } = useOrganization();
  const home = useApi(OrganizationHomeQuery, { slug });
  const recent = useApi(RecentDocumentsQuery, { slug, first: 8 });
  const header = <PageHeader path={[{ label: name }]} operation={{ document: OrganizationHomeQuery, variables: { slug }, org: slug }} />;
  const org = home.data?.organizationBySlug;
  if (!org) {
    return (
      <>
        {header}
        <PageState error={home.error} />
      </>
    );
  }
  const shared = [...present(org.sharedFolders.nodes).map(folderItem), ...present(org.sharedDocuments.nodes).map(documentItem)];

  return (
    <>
      {header}
      <PageBody className="flex flex-col gap-8 p-6">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-semibold">Spaces</h2>
            <p className="text-muted-foreground text-sm">
              You can read {org.documents.totalCount.toLocaleString("en")} documents in {org.folders.totalCount.toLocaleString("en")} folders.
            </p>
          </div>
          <ItemList orgSlug={slug} items={present(org.spaces.nodes).map(folderItem)} empty="No space was shared with you yet." />
        </section>
        {shared.length > 0 && (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="font-semibold">Shared with you</h2>
              <p className="text-muted-foreground text-sm">In spaces you cannot see, so RLS hides the folders they are in.</p>
            </div>
            <ItemList orgSlug={slug} items={shared} empty="" />
          </section>
        )}
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Recent documents</h2>
          {recent.data ? (
            <ItemList orgSlug={slug} items={present(recent.data.organizationBySlug?.documents.nodes ?? []).map(documentItem)} empty="No documents yet." />
          ) : (
            <div className="bg-muted h-24 animate-pulse rounded-lg" />
          )}
        </section>
      </PageBody>
    </>
  );
}

export function FolderPage() {
  const { id = "" } = useParams();
  const { name: orgName, slug } = useOrganization();
  const found = useApi(FolderQuery, { id });
  const base = `/o/${slug}`;
  const operation = { document: FolderQuery, variables: { id }, org: slug };
  const folder = found.data?.folderByRowId;
  if (!folder) {
    return (
      <>
        <PageHeader path={[{ label: orgName, href: base }]} operation={operation} />
        <PageState error={found.error ?? (found.data ? new Error("This folder does not exist, or you don't have access to it.") : null)} />
      </>
    );
  }
  const path = present(folder.path.nodes);
  const parent = path.at(-2);

  return (
    <>
      <PageHeader
        path={[{ label: orgName, href: base }, ...path.map((item) => ({ label: item.name ?? "", href: item.rowId === id ? undefined : `${base}/f/${item.rowId}` }))]}
        operation={operation}
      />
      <PageBody className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-xl font-semibold">{folder.name}</h1>
          {can(folder.permission, "create") && <AddMenu parentId={id} />}
          <ShareDialog resourceId={folder.resourceId} name={folder.name} permission={folder.permission ?? null} access={folder.access.nodes} />
          <ItemActions kind="folder" id={id} name={folder.name} permission={folder.permission ?? null} parentHref={parent ? `${base}/f/${parent.rowId}` : base} />
        </div>
        <ItemList
          orgSlug={slug}
          items={[...present(folder.children.nodes).map(folderItem), ...present(folder.documents.nodes).map(documentItem)]}
          empty="This folder is empty."
        />
      </PageBody>
    </>
  );
}

export function DocumentPage() {
  const { id = "" } = useParams();
  const { name: orgName, slug } = useOrganization();
  const found = useApi(DocumentQuery, { id });
  const base = `/o/${slug}`;
  const operation = { document: DocumentQuery, variables: { id }, org: slug };
  const document = found.data?.documentByRowId;
  if (!document) {
    return (
      <>
        <PageHeader path={[{ label: orgName, href: base }]} operation={operation} />
        <PageState error={found.error ?? (found.data ? new Error("This document does not exist, or you don't have access to it.") : null)} />
      </>
    );
  }
  const path = present(document.path.nodes);
  const folder = path.at(-1);
  const permission = document.permission ?? null;

  return (
    <>
      <PageHeader
        path={[{ label: orgName, href: base }, ...path.map((item) => ({ label: item.name ?? "", href: `${base}/f/${item.rowId}` })), { label: document.title }]}
        operation={operation}
      />
      <PageBody className="flex flex-col gap-8 p-6">
        <DocumentEditor
          key={document.updatedAt}
          id={id}
          title={document.title}
          content={document.content}
          canEdit={can(permission, "edit")}
          actions={
            <>
              <ShareDialog resourceId={document.resourceId} name={document.title} permission={permission} access={document.access.nodes} />
              <ItemActions kind="document" id={id} name={document.title} permission={permission} parentHref={folder ? `${base}/f/${folder.rowId}` : base} />
            </>
          }
        />
        {document.author?.name && <p className="text-muted-foreground -mt-6 text-xs">Created by {document.author.name}</p>}
        <Comments documentId={id} comments={present(document.comments.nodes)} canComment={can(permission, "comment")} canDelete={can(permission, "delete")} />
      </PageBody>
    </>
  );
}

export function SearchPage() {
  const { name, slug } = useOrganization();
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";
  const found = useApi(SearchQuery, { slug, query }, { enabled: Boolean(query.trim()) });
  const results = found.data?.organizationBySlug;

  return (
    <>
      <PageHeader path={[{ label: name, href: `/o/${slug}` }, { label: "Search" }]} operation={{ document: SearchQuery, variables: { slug, query }, org: slug }} />
      <PageBody className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <SearchBox query={query} placeholder="Search folders and documents" />
          <p className="text-muted-foreground text-sm">
            A plain <code>ilike</code> query in a SQL function: RLS leaves out what you cannot read, nothing else filters.
          </p>
        </div>
        {query.trim() && !results && <div className="bg-muted h-24 animate-pulse rounded-lg" />}
        {results && (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="font-semibold">Folders</h2>
              <ItemList orgSlug={slug} items={present(results.searchFolders.nodes).map(folderItem)} empty="No folder matches." />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="font-semibold">Documents</h2>
              <ItemList orgSlug={slug} items={present(results.searchDocuments.nodes).map(documentItem)} empty="No document matches." />
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}
