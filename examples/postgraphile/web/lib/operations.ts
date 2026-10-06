import { graphql } from "@/gql";

// Every operation of the app. PostGraphile serves the tables, which RLS filters, and the functions of sql/app.sql:
// nothing here filters what the member may see, the database does

graphql(`
  fragment FolderItem on Folder {
    rowId
    name
    permission
  }
`);

graphql(`
  fragment DocumentItem on Document {
    rowId
    title
    permission
    updatedAt
  }
`);

graphql(`
  fragment AccessItem on AccessEntry {
    roleId
    kind
    name
    detail
    permission
    direct
    fromName
    fromFolderId
  }
`);

// Signing in and organizations

export const SignInQuery = graphql(`
  query SignIn {
    viewer {
      rowId
    }
    demoAccounts {
      mockUsers
      acme
    }
  }
`);

export const StartQuery = graphql(`
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
`);

export const CreateOrganization = graphql(`
  mutation CreateOrganization($name: String!) {
    createOrganization(input: { name: $name }) {
      organization {
        slug
      }
    }
  }
`);

export const OrganizationLayoutQuery = graphql(`
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
      permission
      spaces {
        nodes {
          rowId
          name
        }
      }
    }
  }
`);

// Folders and documents

export const OrganizationHomeQuery = graphql(`
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
`);

// A page of the documents the member can read, last updated first, from an index of the organization's documents
export const RecentDocumentsQuery = graphql(`
  query RecentDocuments($slug: String!, $first: Int!) {
    organizationBySlug(slug: $slug) {
      documents(first: $first, orderBy: [UPDATED_AT_DESC, ROW_ID_DESC]) {
        nodes {
          ...DocumentItem
        }
      }
    }
  }
`);

export const FolderQuery = graphql(`
  query Folder($id: UUID!) {
    folderByRowId(rowId: $id) {
      rowId
      name
      resourceId
      permission
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
`);

export const DocumentQuery = graphql(`
  query Document($id: UUID!) {
    documentByRowId(rowId: $id) {
      rowId
      title
      content
      resourceId
      permission
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
`);

export const SearchQuery = graphql(`
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
`);

export const MoveTargetsQuery = graphql(`
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
`);

export const CreateFolder = graphql(`
  mutation CreateFolder($orgId: UUID!, $parentId: UUID, $name: String!) {
    createFolder(input: { orgId: $orgId, parentId: $parentId, name: $name }) {
      folder {
        rowId
      }
    }
  }
`);

export const RenameFolder = graphql(`
  mutation RenameFolder($rowId: UUID!, $name: String!) {
    updateFolderByRowId(input: { rowId: $rowId, folderPatch: { name: $name } }) {
      folder {
        rowId
      }
    }
  }
`);

export const MoveFolder = graphql(`
  mutation MoveFolder($folderId: UUID!, $parentId: UUID!) {
    moveFolder(input: { folderId: $folderId, parentId: $parentId }) {
      folder {
        rowId
      }
    }
  }
`);

export const DeleteFolder = graphql(`
  mutation DeleteFolder($rowId: UUID!) {
    deleteFolderByRowId(input: { rowId: $rowId }) {
      deletedFolderId
    }
  }
`);

export const CreateDocument = graphql(`
  mutation CreateDocument($folderId: UUID!, $title: String!) {
    createDocument(input: { folderId: $folderId, title: $title }) {
      document {
        rowId
      }
    }
  }
`);

export const UpdateDocument = graphql(`
  mutation UpdateDocument($rowId: UUID!, $patch: DocumentPatch!) {
    updateDocumentByRowId(input: { rowId: $rowId, documentPatch: $patch }) {
      document {
        rowId
        updatedAt
      }
    }
  }
`);

export const DeleteDocument = graphql(`
  mutation DeleteDocument($rowId: UUID!) {
    deleteDocumentByRowId(input: { rowId: $rowId }) {
      deletedDocumentId
    }
  }
`);

export const CreateComment = graphql(`
  mutation CreateComment($documentId: UUID!, $body: String!) {
    createComment(input: { comment: { documentId: $documentId, body: $body } }) {
      comment {
        rowId
      }
    }
  }
`);

export const DeleteComment = graphql(`
  mutation DeleteComment($rowId: UUID!) {
    deleteCommentByRowId(input: { rowId: $rowId }) {
      deletedCommentId
    }
  }
`);

// Sharing

export const PrincipalsQuery = graphql(`
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
`);

export const ShareResource = graphql(`
  mutation ShareResource($resourceId: UUID!, $roleId: UUID!, $level: String!) {
    shareResource(input: { resourceId: $resourceId, roleId: $roleId, level: $level }) {
      result
    }
  }
`);

export const UnshareResource = graphql(`
  mutation UnshareResource($resourceId: UUID!, $roleId: UUID!) {
    unshareResource(input: { resourceId: $resourceId, roleId: $roleId }) {
      result
    }
  }
`);

// Members and teams

export const MembersQuery = graphql(`
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
`);

export const InviteMember = graphql(`
  mutation InviteMember($orgId: UUID!, $email: String!) {
    inviteMember(input: { orgId: $orgId, email: $email }) {
      member {
        rowId
      }
    }
  }
`);

export const RemoveMember = graphql(`
  mutation RemoveMember($memberId: UUID!) {
    removeMember(input: { memberId: $memberId }) {
      result
    }
  }
`);

export const CreateTeam = graphql(`
  mutation CreateTeam($orgId: UUID!, $name: String!) {
    createTeam(input: { orgId: $orgId, name: $name }) {
      team {
        rowId
      }
    }
  }
`);

export const DeleteTeam = graphql(`
  mutation DeleteTeam($teamId: UUID!) {
    deleteTeam(input: { teamId: $teamId }) {
      result
    }
  }
`);

export const SetTeamMembership = graphql(`
  mutation SetTeamMembership($teamId: UUID!, $memberId: UUID!, $isMember: Boolean!) {
    setTeamMembership(input: { teamId: $teamId, memberId: $memberId, isMember: $isMember }) {
      result
    }
  }
`);

export const StartImpersonation = graphql(`
  mutation StartImpersonation($memberId: UUID!, $mode: String!) {
    startImpersonation(input: { memberId: $memberId, mode: $mode }) {
      member {
        rowId
      }
    }
  }
`);

export const StopImpersonation = graphql(`
  mutation StopImpersonation($memberId: UUID!, $mode: String!) {
    stopImpersonation(input: { memberId: $memberId, mode: $mode }) {
      member {
        rowId
      }
    }
  }
`);

// What each member can do in each space, for admins
export const AccessOverviewQuery = graphql(`
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
          spacePermissions
        }
      }
    }
  }
`);

export const AuditQuery = graphql(`
  query Audit($slug: String!, $category: String, $memberId: UUID, $first: Int!, $offset: Int!) {
    organizationBySlug(slug: $slug) {
      auditEvents(category: $category, memberId: $memberId, first: $first, offset: $offset) {
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
          permission
        }
      }
    }
  }
`);

// API keys

export const ApiKeysQuery = graphql(`
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
`);

export const CreateApiKey = graphql(`
  mutation CreateApiKey($name: String!) {
    createApiKey(input: { name: $name }) {
      token
    }
  }
`);

export const RevokeApiKey = graphql(`
  mutation RevokeApiKey($id: UUID!) {
    revokeApiKey(input: { id: $id }) {
      result
    }
  }
`);
