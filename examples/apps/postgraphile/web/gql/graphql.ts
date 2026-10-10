/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** Represents an update to a `Document`. Fields that are set will be updated. */
export type DocumentPatch = {
  content?: string | null | undefined;
  folderId?: string | null | undefined;
  rowId?: string | null | undefined;
  title?: string | null | undefined;
};

export type PermissionFragment = { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null };

export type FolderItemFragment = { rowId: string, name: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null };

export type DocumentItemFragment = { rowId: string, title: string, updatedAt: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null };

export type AccessItemFragment = { roleId: string | null, kind: string | null, name: string | null, detail: string | null, direct: boolean | null, fromName: string | null, fromFolderId: string | null, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null };

export type SignInQueryVariables = Exact<{ [key: string]: never; }>;


export type SignInQuery = { viewer: { rowId: string | null } | null, demoAccounts: { mockUsers: number | null, acme: boolean | null } | null };

export type StartQueryVariables = Exact<{ [key: string]: never; }>;


export type StartQuery = { viewer: { rowId: string | null, name: string | null, email: string | null } | null, myOrganizations: { nodes: Array<{ rowId: string, name: string, slug: string } | null> } | null };

export type CreateOrganizationMutationVariables = Exact<{
  name: string;
}>;


export type CreateOrganizationMutation = { createOrganization: { organization: { slug: string } | null } | null };

export type OrganizationLayoutQueryVariables = Exact<{
  slug: string;
}>;


export type OrganizationLayoutQuery = { viewer: { name: string | null, email: string | null } | null, myOrganizations: { nodes: Array<{ rowId: string, name: string, slug: string } | null> } | null, currentMember: { rowId: string, name: string | null } | null, currentImpersonation: { adminName: string | null, readOnly: boolean | null } | null, organizationBySlug: { rowId: string, name: string, slug: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null, spaces: { nodes: Array<{ rowId: string, name: string } | null> } } | null };

export type OrganizationHomeQueryVariables = Exact<{
  slug: string;
}>;


export type OrganizationHomeQuery = { organizationBySlug: { spaces: { nodes: Array<{ rowId: string, name: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> }, sharedFolders: { nodes: Array<{ rowId: string, name: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> }, sharedDocuments: { nodes: Array<{ rowId: string, title: string, updatedAt: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> }, folders: { totalCount: number }, documents: { totalCount: number } } | null };

export type RecentDocumentsQueryVariables = Exact<{
  slug: string;
  first: number;
}>;


export type RecentDocumentsQuery = { organizationBySlug: { documents: { nodes: Array<{ rowId: string, title: string, updatedAt: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> } } | null };

export type FolderQueryVariables = Exact<{
  id: string;
}>;


export type FolderQuery = { folderByRowId: { rowId: string, name: string, resourceId: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null, path: { nodes: Array<{ rowId: string, name: string } | null> }, children: { nodes: Array<{ rowId: string, name: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> }, documents: { nodes: Array<{ rowId: string, title: string, updatedAt: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> }, access: { nodes: Array<{ roleId: string | null, kind: string | null, name: string | null, detail: string | null, direct: boolean | null, fromName: string | null, fromFolderId: string | null, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> } } | null };

export type DocumentQueryVariables = Exact<{
  id: string;
}>;


export type DocumentQuery = { documentByRowId: { rowId: string, title: string, content: string, resourceId: string, updatedAt: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null, author: { name: string | null } | null, path: { nodes: Array<{ rowId: string, name: string } | null> }, comments: { nodes: Array<{ rowId: string, body: string, createdAt: string, author: { name: string | null } | null } | null> }, access: { nodes: Array<{ roleId: string | null, kind: string | null, name: string | null, detail: string | null, direct: boolean | null, fromName: string | null, fromFolderId: string | null, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> } } | null };

export type SearchQueryVariables = Exact<{
  slug: string;
  query: string;
}>;


export type SearchQuery = { organizationBySlug: { searchFolders: { nodes: Array<{ rowId: string, name: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> }, searchDocuments: { nodes: Array<{ rowId: string, title: string, updatedAt: string, permission: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> } } | null };

export type MoveTargetsQueryVariables = Exact<{
  slug: string;
}>;


export type MoveTargetsQuery = { organizationBySlug: { moveTargets: { nodes: Array<{ rowId: string | null, label: string | null } | null> } } | null };

export type CreateFolderMutationVariables = Exact<{
  orgId: string;
  parentId?: string | null | undefined;
  name: string;
}>;


export type CreateFolderMutation = { createFolder: { folder: { rowId: string } | null } | null };

export type RenameFolderMutationVariables = Exact<{
  rowId: string;
  name: string;
}>;


export type RenameFolderMutation = { updateFolderByRowId: { folder: { rowId: string } | null } | null };

export type MoveFolderMutationVariables = Exact<{
  folderId: string;
  parentId: string;
}>;


export type MoveFolderMutation = { moveFolder: { folder: { rowId: string } | null } | null };

export type DeleteFolderMutationVariables = Exact<{
  rowId: string;
}>;


export type DeleteFolderMutation = { deleteFolderByRowId: { deletedFolderId: string | null } | null };

export type CreateDocumentMutationVariables = Exact<{
  folderId: string;
  title: string;
}>;


export type CreateDocumentMutation = { createDocument: { document: { rowId: string } | null } | null };

export type UpdateDocumentMutationVariables = Exact<{
  rowId: string;
  patch: DocumentPatch;
}>;


export type UpdateDocumentMutation = { updateDocumentByRowId: { document: { rowId: string, updatedAt: string } | null } | null };

export type DeleteDocumentMutationVariables = Exact<{
  rowId: string;
}>;


export type DeleteDocumentMutation = { deleteDocumentByRowId: { deletedDocumentId: string | null } | null };

export type CreateCommentMutationVariables = Exact<{
  documentId: string;
  body: string;
}>;


export type CreateCommentMutation = { createComment: { comment: { rowId: string } | null } | null };

export type DeleteCommentMutationVariables = Exact<{
  rowId: string;
}>;


export type DeleteCommentMutation = { deleteCommentByRowId: { deletedCommentId: string | null } | null };

export type PrincipalsQueryVariables = Exact<{
  slug: string;
  query: string;
}>;


export type PrincipalsQuery = { organizationBySlug: { principals: { nodes: Array<{ roleId: string | null, kind: string | null, name: string | null, detail: string | null } | null> } } | null };

export type ShareResourceMutationVariables = Exact<{
  resourceId: string;
  roleId: string;
  level: string;
}>;


export type ShareResourceMutation = { shareResource: { result: boolean | null } | null };

export type UnshareResourceMutationVariables = Exact<{
  resourceId: string;
  roleId: string;
}>;


export type UnshareResourceMutation = { unshareResource: { result: boolean | null } | null };

export type MembersQueryVariables = Exact<{
  slug: string;
  query: string;
  first: number;
  offset: number;
}>;


export type MembersQuery = { organizationBySlug: { members: { totalCount: number, nodes: Array<{ rowId: string, name: string | null, email: string | null, teams: { nodes: Array<{ rowId: string } | null> } } | null> }, teams: { nodes: Array<{ rowId: string, name: string, memberCount: number | null, administers: boolean | null } | null> } } | null };

export type InviteMemberMutationVariables = Exact<{
  orgId: string;
  email: string;
}>;


export type InviteMemberMutation = { inviteMember: { member: { rowId: string } | null } | null };

export type RemoveMemberMutationVariables = Exact<{
  memberId: string;
}>;


export type RemoveMemberMutation = { removeMember: { result: boolean | null } | null };

export type CreateTeamMutationVariables = Exact<{
  orgId: string;
  name: string;
}>;


export type CreateTeamMutation = { createTeam: { team: { rowId: string } | null } | null };

export type DeleteTeamMutationVariables = Exact<{
  teamId: string;
}>;


export type DeleteTeamMutation = { deleteTeam: { result: boolean | null } | null };

export type SetTeamMembershipMutationVariables = Exact<{
  teamId: string;
  memberId: string;
  isMember: boolean;
}>;


export type SetTeamMembershipMutation = { setTeamMembership: { result: boolean | null } | null };

export type StartImpersonationMutationVariables = Exact<{
  memberId: string;
  mode: string;
}>;


export type StartImpersonationMutation = { startImpersonation: { member: { rowId: string } | null } | null };

export type StopImpersonationMutationVariables = Exact<{
  memberId: string;
  mode: string;
}>;


export type StopImpersonationMutation = { stopImpersonation: { member: { rowId: string } | null } | null };

export type AccessOverviewQueryVariables = Exact<{
  slug: string;
  query: string;
  first: number;
  offset: number;
}>;


export type AccessOverviewQuery = { organizationBySlug: { spaces: { nodes: Array<{ rowId: string, name: string } | null> }, members: { totalCount: number, nodes: Array<{ rowId: string, name: string | null, email: string | null, spacePermissions: Array<{ bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null> | null } | null> } } | null };

export type AuditQueryVariables = Exact<{
  slug: string;
  category?: string | null | undefined;
  memberId?: string | null | undefined;
  first: number;
  offset: number;
}>;


export type AuditQuery = { organizationBySlug: { auditEvents: { nodes: Array<{ rowId: string, createdAt: string, actorMemberId: string | null, actorName: string | null, apiKeyName: string | null, impersonatorName: string | null, action: string, subjectKind: string, subjectId: string | null, subjectName: string | null, detail: string | null, granted: { bitmap: string | null, read: boolean | null, create: boolean | null, edit: boolean | null, delete: boolean | null, comment: boolean | null, share: boolean | null, directory: boolean | null, admin: boolean | null } | null } | null> } } | null };

export type ApiKeysQueryVariables = Exact<{ [key: string]: never; }>;


export type ApiKeysQuery = { myApiKeys: { nodes: Array<{ rowId: string | null, name: string | null, tokenStart: string | null, createdAt: string | null, lastUsedAt: string | null } | null> } | null };

export type CreateApiKeyMutationVariables = Exact<{
  name: string;
}>;


export type CreateApiKeyMutation = { createApiKey: { token: string | null } | null };

export type RevokeApiKeyMutationVariables = Exact<{
  id: string;
}>;


export type RevokeApiKeyMutation = { revokeApiKey: { result: boolean | null } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const PermissionFragmentDoc = new TypedDocumentString(`
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}
    `, {"fragmentName":"Permission"}) as unknown as TypedDocumentString<PermissionFragment, unknown>;
export const FolderItemFragmentDoc = new TypedDocumentString(`
    fragment FolderItem on Folder {
  rowId
  name
  permission {
    ...Permission
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}`, {"fragmentName":"FolderItem"}) as unknown as TypedDocumentString<FolderItemFragment, unknown>;
export const DocumentItemFragmentDoc = new TypedDocumentString(`
    fragment DocumentItem on Document {
  rowId
  title
  permission {
    ...Permission
  }
  updatedAt
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}`, {"fragmentName":"DocumentItem"}) as unknown as TypedDocumentString<DocumentItemFragment, unknown>;
export const AccessItemFragmentDoc = new TypedDocumentString(`
    fragment AccessItem on AccessEntry {
  roleId
  kind
  name
  detail
  permission {
    ...Permission
  }
  direct
  fromName
  fromFolderId
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}`, {"fragmentName":"AccessItem"}) as unknown as TypedDocumentString<AccessItemFragment, unknown>;
export const SignInDocument = new TypedDocumentString(`
    query SignIn {
  viewer {
    rowId
  }
  demoAccounts {
    mockUsers
    acme
  }
}
    `) as unknown as TypedDocumentString<SignInQuery, SignInQueryVariables>;
export const StartDocument = new TypedDocumentString(`
    query Start {
  viewer {
    rowId
    name
    email
  }
  myOrganizations {
    nodes {
      rowId
      name
      slug
    }
  }
}
    `) as unknown as TypedDocumentString<StartQuery, StartQueryVariables>;
export const CreateOrganizationDocument = new TypedDocumentString(`
    mutation CreateOrganization($name: String!) {
  createOrganization(input: {name: $name}) {
    organization {
      slug
    }
  }
}
    `) as unknown as TypedDocumentString<CreateOrganizationMutation, CreateOrganizationMutationVariables>;
export const OrganizationLayoutDocument = new TypedDocumentString(`
    query OrganizationLayout($slug: String!) {
  viewer {
    name
    email
  }
  myOrganizations {
    nodes {
      rowId
      name
      slug
    }
  }
  currentMember {
    rowId
    name
  }
  currentImpersonation {
    adminName
    readOnly
  }
  organizationBySlug(slug: $slug) {
    rowId
    name
    slug
    permission {
      ...Permission
    }
    spaces {
      nodes {
        rowId
        name
      }
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}`) as unknown as TypedDocumentString<OrganizationLayoutQuery, OrganizationLayoutQueryVariables>;
export const OrganizationHomeDocument = new TypedDocumentString(`
    query OrganizationHome($slug: String!) {
  organizationBySlug(slug: $slug) {
    spaces {
      nodes {
        ...FolderItem
      }
    }
    sharedFolders {
      nodes {
        ...FolderItem
      }
    }
    sharedDocuments {
      nodes {
        ...DocumentItem
      }
    }
    folders {
      totalCount
    }
    documents {
      totalCount
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}
fragment FolderItem on Folder {
  rowId
  name
  permission {
    ...Permission
  }
}
fragment DocumentItem on Document {
  rowId
  title
  permission {
    ...Permission
  }
  updatedAt
}`) as unknown as TypedDocumentString<OrganizationHomeQuery, OrganizationHomeQueryVariables>;
export const RecentDocumentsDocument = new TypedDocumentString(`
    query RecentDocuments($slug: String!, $first: Int!) {
  organizationBySlug(slug: $slug) {
    documents(first: $first, orderBy: [UPDATED_AT_DESC, ROW_ID_DESC]) {
      nodes {
        ...DocumentItem
      }
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}
fragment DocumentItem on Document {
  rowId
  title
  permission {
    ...Permission
  }
  updatedAt
}`) as unknown as TypedDocumentString<RecentDocumentsQuery, RecentDocumentsQueryVariables>;
export const FolderDocument = new TypedDocumentString(`
    query Folder($id: UUID!) {
  folderByRowId(rowId: $id) {
    rowId
    name
    resourceId
    permission {
      ...Permission
    }
    path {
      nodes {
        rowId
        name
      }
    }
    children(orderBy: NAME_ASC) {
      nodes {
        ...FolderItem
      }
    }
    documents(orderBy: TITLE_ASC) {
      nodes {
        ...DocumentItem
      }
    }
    access {
      nodes {
        ...AccessItem
      }
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}
fragment FolderItem on Folder {
  rowId
  name
  permission {
    ...Permission
  }
}
fragment DocumentItem on Document {
  rowId
  title
  permission {
    ...Permission
  }
  updatedAt
}
fragment AccessItem on AccessEntry {
  roleId
  kind
  name
  detail
  permission {
    ...Permission
  }
  direct
  fromName
  fromFolderId
}`) as unknown as TypedDocumentString<FolderQuery, FolderQueryVariables>;
export const DocumentDocument = new TypedDocumentString(`
    query Document($id: UUID!) {
  documentByRowId(rowId: $id) {
    rowId
    title
    content
    resourceId
    permission {
      ...Permission
    }
    updatedAt
    author {
      name
    }
    path {
      nodes {
        rowId
        name
      }
    }
    comments(orderBy: CREATED_AT_ASC) {
      nodes {
        rowId
        body
        createdAt
        author {
          name
        }
      }
    }
    access {
      nodes {
        ...AccessItem
      }
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}
fragment AccessItem on AccessEntry {
  roleId
  kind
  name
  detail
  permission {
    ...Permission
  }
  direct
  fromName
  fromFolderId
}`) as unknown as TypedDocumentString<DocumentQuery, DocumentQueryVariables>;
export const SearchDocument = new TypedDocumentString(`
    query Search($slug: String!, $query: String!) {
  organizationBySlug(slug: $slug) {
    searchFolders(query: $query, first: 50) {
      nodes {
        ...FolderItem
      }
    }
    searchDocuments(query: $query, first: 50) {
      nodes {
        ...DocumentItem
      }
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}
fragment FolderItem on Folder {
  rowId
  name
  permission {
    ...Permission
  }
}
fragment DocumentItem on Document {
  rowId
  title
  permission {
    ...Permission
  }
  updatedAt
}`) as unknown as TypedDocumentString<SearchQuery, SearchQueryVariables>;
export const MoveTargetsDocument = new TypedDocumentString(`
    query MoveTargets($slug: String!) {
  organizationBySlug(slug: $slug) {
    moveTargets {
      nodes {
        rowId
        label
      }
    }
  }
}
    `) as unknown as TypedDocumentString<MoveTargetsQuery, MoveTargetsQueryVariables>;
export const CreateFolderDocument = new TypedDocumentString(`
    mutation CreateFolder($orgId: UUID!, $parentId: UUID, $name: String!) {
  createFolder(input: {orgId: $orgId, parentId: $parentId, name: $name}) {
    folder {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<CreateFolderMutation, CreateFolderMutationVariables>;
export const RenameFolderDocument = new TypedDocumentString(`
    mutation RenameFolder($rowId: UUID!, $name: String!) {
  updateFolderByRowId(input: {rowId: $rowId, folderPatch: {name: $name}}) {
    folder {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<RenameFolderMutation, RenameFolderMutationVariables>;
export const MoveFolderDocument = new TypedDocumentString(`
    mutation MoveFolder($folderId: UUID!, $parentId: UUID!) {
  moveFolder(input: {folderId: $folderId, parentId: $parentId}) {
    folder {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<MoveFolderMutation, MoveFolderMutationVariables>;
export const DeleteFolderDocument = new TypedDocumentString(`
    mutation DeleteFolder($rowId: UUID!) {
  deleteFolderByRowId(input: {rowId: $rowId}) {
    deletedFolderId
  }
}
    `) as unknown as TypedDocumentString<DeleteFolderMutation, DeleteFolderMutationVariables>;
export const CreateDocumentDocument = new TypedDocumentString(`
    mutation CreateDocument($folderId: UUID!, $title: String!) {
  createDocument(input: {folderId: $folderId, title: $title}) {
    document {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<CreateDocumentMutation, CreateDocumentMutationVariables>;
export const UpdateDocumentDocument = new TypedDocumentString(`
    mutation UpdateDocument($rowId: UUID!, $patch: DocumentPatch!) {
  updateDocumentByRowId(input: {rowId: $rowId, documentPatch: $patch}) {
    document {
      rowId
      updatedAt
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateDocumentMutation, UpdateDocumentMutationVariables>;
export const DeleteDocumentDocument = new TypedDocumentString(`
    mutation DeleteDocument($rowId: UUID!) {
  deleteDocumentByRowId(input: {rowId: $rowId}) {
    deletedDocumentId
  }
}
    `) as unknown as TypedDocumentString<DeleteDocumentMutation, DeleteDocumentMutationVariables>;
export const CreateCommentDocument = new TypedDocumentString(`
    mutation CreateComment($documentId: UUID!, $body: String!) {
  createComment(input: {comment: {documentId: $documentId, body: $body}}) {
    comment {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<CreateCommentMutation, CreateCommentMutationVariables>;
export const DeleteCommentDocument = new TypedDocumentString(`
    mutation DeleteComment($rowId: UUID!) {
  deleteCommentByRowId(input: {rowId: $rowId}) {
    deletedCommentId
  }
}
    `) as unknown as TypedDocumentString<DeleteCommentMutation, DeleteCommentMutationVariables>;
export const PrincipalsDocument = new TypedDocumentString(`
    query Principals($slug: String!, $query: String!) {
  organizationBySlug(slug: $slug) {
    principals(query: $query, first: 20) {
      nodes {
        roleId
        kind
        name
        detail
      }
    }
  }
}
    `) as unknown as TypedDocumentString<PrincipalsQuery, PrincipalsQueryVariables>;
export const ShareResourceDocument = new TypedDocumentString(`
    mutation ShareResource($resourceId: UUID!, $roleId: UUID!, $level: String!) {
  shareResource(input: {resourceId: $resourceId, roleId: $roleId, level: $level}) {
    result
  }
}
    `) as unknown as TypedDocumentString<ShareResourceMutation, ShareResourceMutationVariables>;
export const UnshareResourceDocument = new TypedDocumentString(`
    mutation UnshareResource($resourceId: UUID!, $roleId: UUID!) {
  unshareResource(input: {resourceId: $resourceId, roleId: $roleId}) {
    result
  }
}
    `) as unknown as TypedDocumentString<UnshareResourceMutation, UnshareResourceMutationVariables>;
export const MembersDocument = new TypedDocumentString(`
    query Members($slug: String!, $query: String!, $first: Int!, $offset: Int!) {
  organizationBySlug(slug: $slug) {
    members(query: $query, first: $first, offset: $offset) {
      totalCount
      nodes {
        rowId
        name
        email
        teams {
          nodes {
            rowId
          }
        }
      }
    }
    teams {
      nodes {
        rowId
        name
        memberCount
        administers
      }
    }
  }
}
    `) as unknown as TypedDocumentString<MembersQuery, MembersQueryVariables>;
export const InviteMemberDocument = new TypedDocumentString(`
    mutation InviteMember($orgId: UUID!, $email: String!) {
  inviteMember(input: {orgId: $orgId, email: $email}) {
    member {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<InviteMemberMutation, InviteMemberMutationVariables>;
export const RemoveMemberDocument = new TypedDocumentString(`
    mutation RemoveMember($memberId: UUID!) {
  removeMember(input: {memberId: $memberId}) {
    result
  }
}
    `) as unknown as TypedDocumentString<RemoveMemberMutation, RemoveMemberMutationVariables>;
export const CreateTeamDocument = new TypedDocumentString(`
    mutation CreateTeam($orgId: UUID!, $name: String!) {
  createTeam(input: {orgId: $orgId, name: $name}) {
    team {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<CreateTeamMutation, CreateTeamMutationVariables>;
export const DeleteTeamDocument = new TypedDocumentString(`
    mutation DeleteTeam($teamId: UUID!) {
  deleteTeam(input: {teamId: $teamId}) {
    result
  }
}
    `) as unknown as TypedDocumentString<DeleteTeamMutation, DeleteTeamMutationVariables>;
export const SetTeamMembershipDocument = new TypedDocumentString(`
    mutation SetTeamMembership($teamId: UUID!, $memberId: UUID!, $isMember: Boolean!) {
  setTeamMembership(
    input: {teamId: $teamId, memberId: $memberId, isMember: $isMember}
  ) {
    result
  }
}
    `) as unknown as TypedDocumentString<SetTeamMembershipMutation, SetTeamMembershipMutationVariables>;
export const StartImpersonationDocument = new TypedDocumentString(`
    mutation StartImpersonation($memberId: UUID!, $mode: String!) {
  startImpersonation(input: {memberId: $memberId, mode: $mode}) {
    member {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<StartImpersonationMutation, StartImpersonationMutationVariables>;
export const StopImpersonationDocument = new TypedDocumentString(`
    mutation StopImpersonation($memberId: UUID!, $mode: String!) {
  stopImpersonation(input: {memberId: $memberId, mode: $mode}) {
    member {
      rowId
    }
  }
}
    `) as unknown as TypedDocumentString<StopImpersonationMutation, StopImpersonationMutationVariables>;
export const AccessOverviewDocument = new TypedDocumentString(`
    query AccessOverview($slug: String!, $query: String!, $first: Int!, $offset: Int!) {
  organizationBySlug(slug: $slug) {
    spaces {
      nodes {
        rowId
        name
      }
    }
    members(query: $query, first: $first, offset: $offset) {
      totalCount
      nodes {
        rowId
        name
        email
        spacePermissions {
          ...Permission
        }
      }
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}`) as unknown as TypedDocumentString<AccessOverviewQuery, AccessOverviewQueryVariables>;
export const AuditDocument = new TypedDocumentString(`
    query Audit($slug: String!, $category: String, $memberId: UUID, $first: Int!, $offset: Int!) {
  organizationBySlug(slug: $slug) {
    auditEvents(
      category: $category
      memberId: $memberId
      first: $first
      offset: $offset
    ) {
      nodes {
        rowId
        createdAt
        actorMemberId
        actorName
        apiKeyName
        impersonatorName
        action
        subjectKind
        subjectId
        subjectName
        detail
        granted {
          ...Permission
        }
      }
    }
  }
}
    fragment Permission on PermissionFlag {
  bitmap
  read
  create
  edit
  delete
  comment
  share
  directory
  admin
}`) as unknown as TypedDocumentString<AuditQuery, AuditQueryVariables>;
export const ApiKeysDocument = new TypedDocumentString(`
    query ApiKeys {
  myApiKeys {
    nodes {
      rowId
      name
      tokenStart
      createdAt
      lastUsedAt
    }
  }
}
    `) as unknown as TypedDocumentString<ApiKeysQuery, ApiKeysQueryVariables>;
export const CreateApiKeyDocument = new TypedDocumentString(`
    mutation CreateApiKey($name: String!) {
  createApiKey(input: {name: $name}) {
    token
  }
}
    `) as unknown as TypedDocumentString<CreateApiKeyMutation, CreateApiKeyMutationVariables>;
export const RevokeApiKeyDocument = new TypedDocumentString(`
    mutation RevokeApiKey($id: UUID!) {
  revokeApiKey(input: {id: $id}) {
    result
  }
}
    `) as unknown as TypedDocumentString<RevokeApiKeyMutation, RevokeApiKeyMutationVariables>;