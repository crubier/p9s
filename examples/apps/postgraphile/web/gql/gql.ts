/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment Permission on PermissionFlag {\n    bitmap\n    read\n    create\n    edit\n    delete\n    comment\n    share\n    directory\n    admin\n  }\n": typeof types.PermissionFragmentDoc,
    "\n  fragment FolderItem on Folder {\n    rowId\n    name\n    permission {\n      ...Permission\n    }\n  }\n": typeof types.FolderItemFragmentDoc,
    "\n  fragment DocumentItem on Document {\n    rowId\n    title\n    permission {\n      ...Permission\n    }\n    updatedAt\n  }\n": typeof types.DocumentItemFragmentDoc,
    "\n  fragment AccessItem on AccessEntry {\n    roleId\n    kind\n    name\n    detail\n    permission {\n      ...Permission\n    }\n    direct\n    fromName\n    fromFolderId\n  }\n": typeof types.AccessItemFragmentDoc,
    "\n  query SignIn {\n    viewer {\n      rowId\n    }\n    demoAccounts {\n      mockUsers\n      acme\n    }\n  }\n": typeof types.SignInDocument,
    "\n  query Start {\n    viewer {\n      rowId\n      name\n      email\n    }\n    myOrganizations {\n      nodes {\n        rowId\n        name\n        slug\n      }\n    }\n  }\n": typeof types.StartDocument,
    "\n  mutation CreateOrganization($name: String!) {\n    createOrganization(input: { name: $name }) {\n      organization {\n        slug\n      }\n    }\n  }\n": typeof types.CreateOrganizationDocument,
    "\n  query OrganizationLayout($slug: String!) {\n    viewer {\n      name\n      email\n    }\n    myOrganizations {\n      nodes {\n        rowId\n        name\n        slug\n      }\n    }\n    currentMember {\n      rowId\n      name\n    }\n    currentImpersonation {\n      adminName\n      readOnly\n    }\n    organizationBySlug(slug: $slug) {\n      rowId\n      name\n      slug\n      permission {\n        ...Permission\n      }\n      spaces {\n        nodes {\n          rowId\n          name\n        }\n      }\n    }\n  }\n": typeof types.OrganizationLayoutDocument,
    "\n  query OrganizationHome($slug: String!) {\n    organizationBySlug(slug: $slug) {\n      spaces {\n        nodes {\n          ...FolderItem\n        }\n      }\n      sharedFolders {\n        nodes {\n          ...FolderItem\n        }\n      }\n      sharedDocuments {\n        nodes {\n          ...DocumentItem\n        }\n      }\n      folders {\n        totalCount\n      }\n      documents {\n        totalCount\n      }\n    }\n  }\n": typeof types.OrganizationHomeDocument,
    "\n  query RecentDocuments($slug: String!, $first: Int!) {\n    organizationBySlug(slug: $slug) {\n      documents(first: $first, orderBy: [UPDATED_AT_DESC, ROW_ID_DESC]) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n    }\n  }\n": typeof types.RecentDocumentsDocument,
    "\n  query Folder($id: UUID!) {\n    folderByRowId(rowId: $id) {\n      rowId\n      name\n      resourceId\n      permission {\n        ...Permission\n      }\n      path {\n        nodes {\n          rowId\n          name\n        }\n      }\n      children(orderBy: NAME_ASC) {\n        nodes {\n          ...FolderItem\n        }\n      }\n      documents(orderBy: TITLE_ASC) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n      access {\n        nodes {\n          ...AccessItem\n        }\n      }\n    }\n  }\n": typeof types.FolderDocument,
    "\n  query Document($id: UUID!) {\n    documentByRowId(rowId: $id) {\n      rowId\n      title\n      content\n      resourceId\n      permission {\n        ...Permission\n      }\n      updatedAt\n      author {\n        name\n      }\n      path {\n        nodes {\n          rowId\n          name\n        }\n      }\n      comments(orderBy: CREATED_AT_ASC) {\n        nodes {\n          rowId\n          body\n          createdAt\n          author {\n            name\n          }\n        }\n      }\n      access {\n        nodes {\n          ...AccessItem\n        }\n      }\n    }\n  }\n": typeof types.DocumentDocument,
    "\n  query Search($slug: String!, $query: String!) {\n    organizationBySlug(slug: $slug) {\n      searchFolders(query: $query, first: 50) {\n        nodes {\n          ...FolderItem\n        }\n      }\n      searchDocuments(query: $query, first: 50) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n    }\n  }\n": typeof types.SearchDocument,
    "\n  query MoveTargets($slug: String!) {\n    organizationBySlug(slug: $slug) {\n      moveTargets {\n        nodes {\n          rowId\n          label\n        }\n      }\n    }\n  }\n": typeof types.MoveTargetsDocument,
    "\n  mutation CreateFolder($orgId: UUID!, $parentId: UUID, $name: String!) {\n    createFolder(input: { orgId: $orgId, parentId: $parentId, name: $name }) {\n      folder {\n        rowId\n      }\n    }\n  }\n": typeof types.CreateFolderDocument,
    "\n  mutation RenameFolder($rowId: UUID!, $name: String!) {\n    updateFolderByRowId(input: { rowId: $rowId, folderPatch: { name: $name } }) {\n      folder {\n        rowId\n      }\n    }\n  }\n": typeof types.RenameFolderDocument,
    "\n  mutation MoveFolder($folderId: UUID!, $parentId: UUID!) {\n    moveFolder(input: { folderId: $folderId, parentId: $parentId }) {\n      folder {\n        rowId\n      }\n    }\n  }\n": typeof types.MoveFolderDocument,
    "\n  mutation DeleteFolder($rowId: UUID!) {\n    deleteFolderByRowId(input: { rowId: $rowId }) {\n      deletedFolderId\n    }\n  }\n": typeof types.DeleteFolderDocument,
    "\n  mutation CreateDocument($folderId: UUID!, $title: String!) {\n    createDocument(input: { folderId: $folderId, title: $title }) {\n      document {\n        rowId\n      }\n    }\n  }\n": typeof types.CreateDocumentDocument,
    "\n  mutation UpdateDocument($rowId: UUID!, $patch: DocumentPatch!) {\n    updateDocumentByRowId(input: { rowId: $rowId, documentPatch: $patch }) {\n      document {\n        rowId\n        updatedAt\n      }\n    }\n  }\n": typeof types.UpdateDocumentDocument,
    "\n  mutation DeleteDocument($rowId: UUID!) {\n    deleteDocumentByRowId(input: { rowId: $rowId }) {\n      deletedDocumentId\n    }\n  }\n": typeof types.DeleteDocumentDocument,
    "\n  mutation CreateComment($documentId: UUID!, $body: String!) {\n    createComment(input: { comment: { documentId: $documentId, body: $body } }) {\n      comment {\n        rowId\n      }\n    }\n  }\n": typeof types.CreateCommentDocument,
    "\n  mutation DeleteComment($rowId: UUID!) {\n    deleteCommentByRowId(input: { rowId: $rowId }) {\n      deletedCommentId\n    }\n  }\n": typeof types.DeleteCommentDocument,
    "\n  query Principals($slug: String!, $query: String!) {\n    organizationBySlug(slug: $slug) {\n      principals(query: $query, first: 20) {\n        nodes {\n          roleId\n          kind\n          name\n          detail\n        }\n      }\n    }\n  }\n": typeof types.PrincipalsDocument,
    "\n  mutation ShareResource($resourceId: UUID!, $roleId: UUID!, $level: String!) {\n    shareResource(input: { resourceId: $resourceId, roleId: $roleId, level: $level }) {\n      result\n    }\n  }\n": typeof types.ShareResourceDocument,
    "\n  mutation UnshareResource($resourceId: UUID!, $roleId: UUID!) {\n    unshareResource(input: { resourceId: $resourceId, roleId: $roleId }) {\n      result\n    }\n  }\n": typeof types.UnshareResourceDocument,
    "\n  query Members($slug: String!, $query: String!, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      members(query: $query, first: $first, offset: $offset) {\n        totalCount\n        nodes {\n          rowId\n          name\n          email\n          teams {\n            nodes {\n              rowId\n            }\n          }\n        }\n      }\n      teams {\n        nodes {\n          rowId\n          name\n          memberCount\n          administers\n        }\n      }\n    }\n  }\n": typeof types.MembersDocument,
    "\n  mutation InviteMember($orgId: UUID!, $email: String!) {\n    inviteMember(input: { orgId: $orgId, email: $email }) {\n      member {\n        rowId\n      }\n    }\n  }\n": typeof types.InviteMemberDocument,
    "\n  mutation RemoveMember($memberId: UUID!) {\n    removeMember(input: { memberId: $memberId }) {\n      result\n    }\n  }\n": typeof types.RemoveMemberDocument,
    "\n  mutation CreateTeam($orgId: UUID!, $name: String!) {\n    createTeam(input: { orgId: $orgId, name: $name }) {\n      team {\n        rowId\n      }\n    }\n  }\n": typeof types.CreateTeamDocument,
    "\n  mutation DeleteTeam($teamId: UUID!) {\n    deleteTeam(input: { teamId: $teamId }) {\n      result\n    }\n  }\n": typeof types.DeleteTeamDocument,
    "\n  mutation SetTeamMembership($teamId: UUID!, $memberId: UUID!, $isMember: Boolean!) {\n    setTeamMembership(input: { teamId: $teamId, memberId: $memberId, isMember: $isMember }) {\n      result\n    }\n  }\n": typeof types.SetTeamMembershipDocument,
    "\n  mutation StartImpersonation($memberId: UUID!, $mode: String!) {\n    startImpersonation(input: { memberId: $memberId, mode: $mode }) {\n      member {\n        rowId\n      }\n    }\n  }\n": typeof types.StartImpersonationDocument,
    "\n  mutation StopImpersonation($memberId: UUID!, $mode: String!) {\n    stopImpersonation(input: { memberId: $memberId, mode: $mode }) {\n      member {\n        rowId\n      }\n    }\n  }\n": typeof types.StopImpersonationDocument,
    "\n  query AccessOverview($slug: String!, $query: String!, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      spaces {\n        nodes {\n          rowId\n          name\n        }\n      }\n      members(query: $query, first: $first, offset: $offset) {\n        totalCount\n        nodes {\n          rowId\n          name\n          email\n          spacePermissions {\n            ...Permission\n          }\n        }\n      }\n    }\n  }\n": typeof types.AccessOverviewDocument,
    "\n  query Audit($slug: String!, $category: String, $memberId: UUID, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      auditEvents(category: $category, memberId: $memberId, first: $first, offset: $offset) {\n        nodes {\n          rowId\n          createdAt\n          actorMemberId\n          actorName\n          apiKeyName\n          impersonatorName\n          action\n          subjectKind\n          subjectId\n          subjectName\n          detail\n          granted {\n            ...Permission\n          }\n        }\n      }\n    }\n  }\n": typeof types.AuditDocument,
    "\n  query ApiKeys {\n    myApiKeys {\n      nodes {\n        rowId\n        name\n        tokenStart\n        createdAt\n        lastUsedAt\n      }\n    }\n  }\n": typeof types.ApiKeysDocument,
    "\n  mutation CreateApiKey($name: String!) {\n    createApiKey(input: { name: $name }) {\n      token\n    }\n  }\n": typeof types.CreateApiKeyDocument,
    "\n  mutation RevokeApiKey($id: UUID!) {\n    revokeApiKey(input: { id: $id }) {\n      result\n    }\n  }\n": typeof types.RevokeApiKeyDocument,
};
const documents: Documents = {
    "\n  fragment Permission on PermissionFlag {\n    bitmap\n    read\n    create\n    edit\n    delete\n    comment\n    share\n    directory\n    admin\n  }\n": types.PermissionFragmentDoc,
    "\n  fragment FolderItem on Folder {\n    rowId\n    name\n    permission {\n      ...Permission\n    }\n  }\n": types.FolderItemFragmentDoc,
    "\n  fragment DocumentItem on Document {\n    rowId\n    title\n    permission {\n      ...Permission\n    }\n    updatedAt\n  }\n": types.DocumentItemFragmentDoc,
    "\n  fragment AccessItem on AccessEntry {\n    roleId\n    kind\n    name\n    detail\n    permission {\n      ...Permission\n    }\n    direct\n    fromName\n    fromFolderId\n  }\n": types.AccessItemFragmentDoc,
    "\n  query SignIn {\n    viewer {\n      rowId\n    }\n    demoAccounts {\n      mockUsers\n      acme\n    }\n  }\n": types.SignInDocument,
    "\n  query Start {\n    viewer {\n      rowId\n      name\n      email\n    }\n    myOrganizations {\n      nodes {\n        rowId\n        name\n        slug\n      }\n    }\n  }\n": types.StartDocument,
    "\n  mutation CreateOrganization($name: String!) {\n    createOrganization(input: { name: $name }) {\n      organization {\n        slug\n      }\n    }\n  }\n": types.CreateOrganizationDocument,
    "\n  query OrganizationLayout($slug: String!) {\n    viewer {\n      name\n      email\n    }\n    myOrganizations {\n      nodes {\n        rowId\n        name\n        slug\n      }\n    }\n    currentMember {\n      rowId\n      name\n    }\n    currentImpersonation {\n      adminName\n      readOnly\n    }\n    organizationBySlug(slug: $slug) {\n      rowId\n      name\n      slug\n      permission {\n        ...Permission\n      }\n      spaces {\n        nodes {\n          rowId\n          name\n        }\n      }\n    }\n  }\n": types.OrganizationLayoutDocument,
    "\n  query OrganizationHome($slug: String!) {\n    organizationBySlug(slug: $slug) {\n      spaces {\n        nodes {\n          ...FolderItem\n        }\n      }\n      sharedFolders {\n        nodes {\n          ...FolderItem\n        }\n      }\n      sharedDocuments {\n        nodes {\n          ...DocumentItem\n        }\n      }\n      folders {\n        totalCount\n      }\n      documents {\n        totalCount\n      }\n    }\n  }\n": types.OrganizationHomeDocument,
    "\n  query RecentDocuments($slug: String!, $first: Int!) {\n    organizationBySlug(slug: $slug) {\n      documents(first: $first, orderBy: [UPDATED_AT_DESC, ROW_ID_DESC]) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n    }\n  }\n": types.RecentDocumentsDocument,
    "\n  query Folder($id: UUID!) {\n    folderByRowId(rowId: $id) {\n      rowId\n      name\n      resourceId\n      permission {\n        ...Permission\n      }\n      path {\n        nodes {\n          rowId\n          name\n        }\n      }\n      children(orderBy: NAME_ASC) {\n        nodes {\n          ...FolderItem\n        }\n      }\n      documents(orderBy: TITLE_ASC) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n      access {\n        nodes {\n          ...AccessItem\n        }\n      }\n    }\n  }\n": types.FolderDocument,
    "\n  query Document($id: UUID!) {\n    documentByRowId(rowId: $id) {\n      rowId\n      title\n      content\n      resourceId\n      permission {\n        ...Permission\n      }\n      updatedAt\n      author {\n        name\n      }\n      path {\n        nodes {\n          rowId\n          name\n        }\n      }\n      comments(orderBy: CREATED_AT_ASC) {\n        nodes {\n          rowId\n          body\n          createdAt\n          author {\n            name\n          }\n        }\n      }\n      access {\n        nodes {\n          ...AccessItem\n        }\n      }\n    }\n  }\n": types.DocumentDocument,
    "\n  query Search($slug: String!, $query: String!) {\n    organizationBySlug(slug: $slug) {\n      searchFolders(query: $query, first: 50) {\n        nodes {\n          ...FolderItem\n        }\n      }\n      searchDocuments(query: $query, first: 50) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n    }\n  }\n": types.SearchDocument,
    "\n  query MoveTargets($slug: String!) {\n    organizationBySlug(slug: $slug) {\n      moveTargets {\n        nodes {\n          rowId\n          label\n        }\n      }\n    }\n  }\n": types.MoveTargetsDocument,
    "\n  mutation CreateFolder($orgId: UUID!, $parentId: UUID, $name: String!) {\n    createFolder(input: { orgId: $orgId, parentId: $parentId, name: $name }) {\n      folder {\n        rowId\n      }\n    }\n  }\n": types.CreateFolderDocument,
    "\n  mutation RenameFolder($rowId: UUID!, $name: String!) {\n    updateFolderByRowId(input: { rowId: $rowId, folderPatch: { name: $name } }) {\n      folder {\n        rowId\n      }\n    }\n  }\n": types.RenameFolderDocument,
    "\n  mutation MoveFolder($folderId: UUID!, $parentId: UUID!) {\n    moveFolder(input: { folderId: $folderId, parentId: $parentId }) {\n      folder {\n        rowId\n      }\n    }\n  }\n": types.MoveFolderDocument,
    "\n  mutation DeleteFolder($rowId: UUID!) {\n    deleteFolderByRowId(input: { rowId: $rowId }) {\n      deletedFolderId\n    }\n  }\n": types.DeleteFolderDocument,
    "\n  mutation CreateDocument($folderId: UUID!, $title: String!) {\n    createDocument(input: { folderId: $folderId, title: $title }) {\n      document {\n        rowId\n      }\n    }\n  }\n": types.CreateDocumentDocument,
    "\n  mutation UpdateDocument($rowId: UUID!, $patch: DocumentPatch!) {\n    updateDocumentByRowId(input: { rowId: $rowId, documentPatch: $patch }) {\n      document {\n        rowId\n        updatedAt\n      }\n    }\n  }\n": types.UpdateDocumentDocument,
    "\n  mutation DeleteDocument($rowId: UUID!) {\n    deleteDocumentByRowId(input: { rowId: $rowId }) {\n      deletedDocumentId\n    }\n  }\n": types.DeleteDocumentDocument,
    "\n  mutation CreateComment($documentId: UUID!, $body: String!) {\n    createComment(input: { comment: { documentId: $documentId, body: $body } }) {\n      comment {\n        rowId\n      }\n    }\n  }\n": types.CreateCommentDocument,
    "\n  mutation DeleteComment($rowId: UUID!) {\n    deleteCommentByRowId(input: { rowId: $rowId }) {\n      deletedCommentId\n    }\n  }\n": types.DeleteCommentDocument,
    "\n  query Principals($slug: String!, $query: String!) {\n    organizationBySlug(slug: $slug) {\n      principals(query: $query, first: 20) {\n        nodes {\n          roleId\n          kind\n          name\n          detail\n        }\n      }\n    }\n  }\n": types.PrincipalsDocument,
    "\n  mutation ShareResource($resourceId: UUID!, $roleId: UUID!, $level: String!) {\n    shareResource(input: { resourceId: $resourceId, roleId: $roleId, level: $level }) {\n      result\n    }\n  }\n": types.ShareResourceDocument,
    "\n  mutation UnshareResource($resourceId: UUID!, $roleId: UUID!) {\n    unshareResource(input: { resourceId: $resourceId, roleId: $roleId }) {\n      result\n    }\n  }\n": types.UnshareResourceDocument,
    "\n  query Members($slug: String!, $query: String!, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      members(query: $query, first: $first, offset: $offset) {\n        totalCount\n        nodes {\n          rowId\n          name\n          email\n          teams {\n            nodes {\n              rowId\n            }\n          }\n        }\n      }\n      teams {\n        nodes {\n          rowId\n          name\n          memberCount\n          administers\n        }\n      }\n    }\n  }\n": types.MembersDocument,
    "\n  mutation InviteMember($orgId: UUID!, $email: String!) {\n    inviteMember(input: { orgId: $orgId, email: $email }) {\n      member {\n        rowId\n      }\n    }\n  }\n": types.InviteMemberDocument,
    "\n  mutation RemoveMember($memberId: UUID!) {\n    removeMember(input: { memberId: $memberId }) {\n      result\n    }\n  }\n": types.RemoveMemberDocument,
    "\n  mutation CreateTeam($orgId: UUID!, $name: String!) {\n    createTeam(input: { orgId: $orgId, name: $name }) {\n      team {\n        rowId\n      }\n    }\n  }\n": types.CreateTeamDocument,
    "\n  mutation DeleteTeam($teamId: UUID!) {\n    deleteTeam(input: { teamId: $teamId }) {\n      result\n    }\n  }\n": types.DeleteTeamDocument,
    "\n  mutation SetTeamMembership($teamId: UUID!, $memberId: UUID!, $isMember: Boolean!) {\n    setTeamMembership(input: { teamId: $teamId, memberId: $memberId, isMember: $isMember }) {\n      result\n    }\n  }\n": types.SetTeamMembershipDocument,
    "\n  mutation StartImpersonation($memberId: UUID!, $mode: String!) {\n    startImpersonation(input: { memberId: $memberId, mode: $mode }) {\n      member {\n        rowId\n      }\n    }\n  }\n": types.StartImpersonationDocument,
    "\n  mutation StopImpersonation($memberId: UUID!, $mode: String!) {\n    stopImpersonation(input: { memberId: $memberId, mode: $mode }) {\n      member {\n        rowId\n      }\n    }\n  }\n": types.StopImpersonationDocument,
    "\n  query AccessOverview($slug: String!, $query: String!, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      spaces {\n        nodes {\n          rowId\n          name\n        }\n      }\n      members(query: $query, first: $first, offset: $offset) {\n        totalCount\n        nodes {\n          rowId\n          name\n          email\n          spacePermissions {\n            ...Permission\n          }\n        }\n      }\n    }\n  }\n": types.AccessOverviewDocument,
    "\n  query Audit($slug: String!, $category: String, $memberId: UUID, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      auditEvents(category: $category, memberId: $memberId, first: $first, offset: $offset) {\n        nodes {\n          rowId\n          createdAt\n          actorMemberId\n          actorName\n          apiKeyName\n          impersonatorName\n          action\n          subjectKind\n          subjectId\n          subjectName\n          detail\n          granted {\n            ...Permission\n          }\n        }\n      }\n    }\n  }\n": types.AuditDocument,
    "\n  query ApiKeys {\n    myApiKeys {\n      nodes {\n        rowId\n        name\n        tokenStart\n        createdAt\n        lastUsedAt\n      }\n    }\n  }\n": types.ApiKeysDocument,
    "\n  mutation CreateApiKey($name: String!) {\n    createApiKey(input: { name: $name }) {\n      token\n    }\n  }\n": types.CreateApiKeyDocument,
    "\n  mutation RevokeApiKey($id: UUID!) {\n    revokeApiKey(input: { id: $id }) {\n      result\n    }\n  }\n": types.RevokeApiKeyDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment Permission on PermissionFlag {\n    bitmap\n    read\n    create\n    edit\n    delete\n    comment\n    share\n    directory\n    admin\n  }\n"): typeof import('./graphql').PermissionFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment FolderItem on Folder {\n    rowId\n    name\n    permission {\n      ...Permission\n    }\n  }\n"): typeof import('./graphql').FolderItemFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment DocumentItem on Document {\n    rowId\n    title\n    permission {\n      ...Permission\n    }\n    updatedAt\n  }\n"): typeof import('./graphql').DocumentItemFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AccessItem on AccessEntry {\n    roleId\n    kind\n    name\n    detail\n    permission {\n      ...Permission\n    }\n    direct\n    fromName\n    fromFolderId\n  }\n"): typeof import('./graphql').AccessItemFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SignIn {\n    viewer {\n      rowId\n    }\n    demoAccounts {\n      mockUsers\n      acme\n    }\n  }\n"): typeof import('./graphql').SignInDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Start {\n    viewer {\n      rowId\n      name\n      email\n    }\n    myOrganizations {\n      nodes {\n        rowId\n        name\n        slug\n      }\n    }\n  }\n"): typeof import('./graphql').StartDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateOrganization($name: String!) {\n    createOrganization(input: { name: $name }) {\n      organization {\n        slug\n      }\n    }\n  }\n"): typeof import('./graphql').CreateOrganizationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationLayout($slug: String!) {\n    viewer {\n      name\n      email\n    }\n    myOrganizations {\n      nodes {\n        rowId\n        name\n        slug\n      }\n    }\n    currentMember {\n      rowId\n      name\n    }\n    currentImpersonation {\n      adminName\n      readOnly\n    }\n    organizationBySlug(slug: $slug) {\n      rowId\n      name\n      slug\n      permission {\n        ...Permission\n      }\n      spaces {\n        nodes {\n          rowId\n          name\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').OrganizationLayoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationHome($slug: String!) {\n    organizationBySlug(slug: $slug) {\n      spaces {\n        nodes {\n          ...FolderItem\n        }\n      }\n      sharedFolders {\n        nodes {\n          ...FolderItem\n        }\n      }\n      sharedDocuments {\n        nodes {\n          ...DocumentItem\n        }\n      }\n      folders {\n        totalCount\n      }\n      documents {\n        totalCount\n      }\n    }\n  }\n"): typeof import('./graphql').OrganizationHomeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query RecentDocuments($slug: String!, $first: Int!) {\n    organizationBySlug(slug: $slug) {\n      documents(first: $first, orderBy: [UPDATED_AT_DESC, ROW_ID_DESC]) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').RecentDocumentsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Folder($id: UUID!) {\n    folderByRowId(rowId: $id) {\n      rowId\n      name\n      resourceId\n      permission {\n        ...Permission\n      }\n      path {\n        nodes {\n          rowId\n          name\n        }\n      }\n      children(orderBy: NAME_ASC) {\n        nodes {\n          ...FolderItem\n        }\n      }\n      documents(orderBy: TITLE_ASC) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n      access {\n        nodes {\n          ...AccessItem\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').FolderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Document($id: UUID!) {\n    documentByRowId(rowId: $id) {\n      rowId\n      title\n      content\n      resourceId\n      permission {\n        ...Permission\n      }\n      updatedAt\n      author {\n        name\n      }\n      path {\n        nodes {\n          rowId\n          name\n        }\n      }\n      comments(orderBy: CREATED_AT_ASC) {\n        nodes {\n          rowId\n          body\n          createdAt\n          author {\n            name\n          }\n        }\n      }\n      access {\n        nodes {\n          ...AccessItem\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').DocumentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Search($slug: String!, $query: String!) {\n    organizationBySlug(slug: $slug) {\n      searchFolders(query: $query, first: 50) {\n        nodes {\n          ...FolderItem\n        }\n      }\n      searchDocuments(query: $query, first: 50) {\n        nodes {\n          ...DocumentItem\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').SearchDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MoveTargets($slug: String!) {\n    organizationBySlug(slug: $slug) {\n      moveTargets {\n        nodes {\n          rowId\n          label\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').MoveTargetsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateFolder($orgId: UUID!, $parentId: UUID, $name: String!) {\n    createFolder(input: { orgId: $orgId, parentId: $parentId, name: $name }) {\n      folder {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').CreateFolderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RenameFolder($rowId: UUID!, $name: String!) {\n    updateFolderByRowId(input: { rowId: $rowId, folderPatch: { name: $name } }) {\n      folder {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').RenameFolderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MoveFolder($folderId: UUID!, $parentId: UUID!) {\n    moveFolder(input: { folderId: $folderId, parentId: $parentId }) {\n      folder {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').MoveFolderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteFolder($rowId: UUID!) {\n    deleteFolderByRowId(input: { rowId: $rowId }) {\n      deletedFolderId\n    }\n  }\n"): typeof import('./graphql').DeleteFolderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateDocument($folderId: UUID!, $title: String!) {\n    createDocument(input: { folderId: $folderId, title: $title }) {\n      document {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').CreateDocumentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateDocument($rowId: UUID!, $patch: DocumentPatch!) {\n    updateDocumentByRowId(input: { rowId: $rowId, documentPatch: $patch }) {\n      document {\n        rowId\n        updatedAt\n      }\n    }\n  }\n"): typeof import('./graphql').UpdateDocumentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteDocument($rowId: UUID!) {\n    deleteDocumentByRowId(input: { rowId: $rowId }) {\n      deletedDocumentId\n    }\n  }\n"): typeof import('./graphql').DeleteDocumentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateComment($documentId: UUID!, $body: String!) {\n    createComment(input: { comment: { documentId: $documentId, body: $body } }) {\n      comment {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').CreateCommentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteComment($rowId: UUID!) {\n    deleteCommentByRowId(input: { rowId: $rowId }) {\n      deletedCommentId\n    }\n  }\n"): typeof import('./graphql').DeleteCommentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Principals($slug: String!, $query: String!) {\n    organizationBySlug(slug: $slug) {\n      principals(query: $query, first: 20) {\n        nodes {\n          roleId\n          kind\n          name\n          detail\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').PrincipalsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ShareResource($resourceId: UUID!, $roleId: UUID!, $level: String!) {\n    shareResource(input: { resourceId: $resourceId, roleId: $roleId, level: $level }) {\n      result\n    }\n  }\n"): typeof import('./graphql').ShareResourceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnshareResource($resourceId: UUID!, $roleId: UUID!) {\n    unshareResource(input: { resourceId: $resourceId, roleId: $roleId }) {\n      result\n    }\n  }\n"): typeof import('./graphql').UnshareResourceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Members($slug: String!, $query: String!, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      members(query: $query, first: $first, offset: $offset) {\n        totalCount\n        nodes {\n          rowId\n          name\n          email\n          teams {\n            nodes {\n              rowId\n            }\n          }\n        }\n      }\n      teams {\n        nodes {\n          rowId\n          name\n          memberCount\n          administers\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').MembersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation InviteMember($orgId: UUID!, $email: String!) {\n    inviteMember(input: { orgId: $orgId, email: $email }) {\n      member {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').InviteMemberDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveMember($memberId: UUID!) {\n    removeMember(input: { memberId: $memberId }) {\n      result\n    }\n  }\n"): typeof import('./graphql').RemoveMemberDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateTeam($orgId: UUID!, $name: String!) {\n    createTeam(input: { orgId: $orgId, name: $name }) {\n      team {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').CreateTeamDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteTeam($teamId: UUID!) {\n    deleteTeam(input: { teamId: $teamId }) {\n      result\n    }\n  }\n"): typeof import('./graphql').DeleteTeamDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetTeamMembership($teamId: UUID!, $memberId: UUID!, $isMember: Boolean!) {\n    setTeamMembership(input: { teamId: $teamId, memberId: $memberId, isMember: $isMember }) {\n      result\n    }\n  }\n"): typeof import('./graphql').SetTeamMembershipDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartImpersonation($memberId: UUID!, $mode: String!) {\n    startImpersonation(input: { memberId: $memberId, mode: $mode }) {\n      member {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').StartImpersonationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StopImpersonation($memberId: UUID!, $mode: String!) {\n    stopImpersonation(input: { memberId: $memberId, mode: $mode }) {\n      member {\n        rowId\n      }\n    }\n  }\n"): typeof import('./graphql').StopImpersonationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AccessOverview($slug: String!, $query: String!, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      spaces {\n        nodes {\n          rowId\n          name\n        }\n      }\n      members(query: $query, first: $first, offset: $offset) {\n        totalCount\n        nodes {\n          rowId\n          name\n          email\n          spacePermissions {\n            ...Permission\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').AccessOverviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Audit($slug: String!, $category: String, $memberId: UUID, $first: Int!, $offset: Int!) {\n    organizationBySlug(slug: $slug) {\n      auditEvents(category: $category, memberId: $memberId, first: $first, offset: $offset) {\n        nodes {\n          rowId\n          createdAt\n          actorMemberId\n          actorName\n          apiKeyName\n          impersonatorName\n          action\n          subjectKind\n          subjectId\n          subjectName\n          detail\n          granted {\n            ...Permission\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').AuditDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ApiKeys {\n    myApiKeys {\n      nodes {\n        rowId\n        name\n        tokenStart\n        createdAt\n        lastUsedAt\n      }\n    }\n  }\n"): typeof import('./graphql').ApiKeysDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateApiKey($name: String!) {\n    createApiKey(input: { name: $name }) {\n      token\n    }\n  }\n"): typeof import('./graphql').CreateApiKeyDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RevokeApiKey($id: UUID!) {\n    revokeApiKey(input: { id: $id }) {\n      result\n    }\n  }\n"): typeof import('./graphql').RevokeApiKeyDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
