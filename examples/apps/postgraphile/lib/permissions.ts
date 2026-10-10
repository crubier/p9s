// Positions in the 8 bit permission bitmap, counted from the left as in the p9s config
export const BIT = {
  // Read folders, documents and comments
  read: 0,
  // Create folders and documents in a folder, or spaces in an organization
  create: 1,
  edit: 2,
  delete: 3,
  comment: 4,
  // Checked by the application before it shares a resource on behalf of a member
  share: 5,
  // Read the organization, its teams and members. A separate bit, so that seeing who is in the organization
  // does not give access to its spaces
  directory: 6,
  // Invite and remove members, create and manage teams
  admin: 7,
} as const;

export type Capability = keyof typeof BIT;

export const BITMAP_SIZE = 8;

export const bitmap = (...capabilities: Capability[]) => {
  const bits = Array<string>(BITMAP_SIZE).fill("0");
  for (const capability of capabilities) bits[BIT[capability]] = "1";
  return bits.join("");
};

// A permission field of GraphQL, from `permission_flags` of p9s: a boolean per capability, and the bitmap
export type Flags = { bitmap?: string | null } & { [capability in Capability]?: boolean | null };

export const can = (permission: Flags | null | undefined, capability: Capability) => permission?.[capability] === true;

export const capabilities = (permission: Flags | null | undefined) =>
  (Object.keys(BIT) as Capability[]).filter((capability) => can(permission, capability));

export const includes = (granted: Flags | null | undefined, requested: readonly Capability[]) =>
  requested.every((capability) => can(granted, capability));

const level = <const C extends Capability[]>(label: string, ...capabilities: C) => ({ label, capabilities, permission: bitmap(...capabilities) });

// Access levels offered when sharing a folder or a document. Sharing takes the bitmap
export const ACCESS_LEVELS = {
  viewer: level("Can view", "read"),
  commenter: level("Can comment", "read", "comment"),
  editor: level("Can edit", "read", "create", "edit", "delete", "comment"),
  manager: level("Full access", "read", "create", "edit", "delete", "comment", "share"),
};

export type AccessLevel = keyof typeof ACCESS_LEVELS;

// The highest level whose capabilities are all in `permission`
export const levelOf = (permission: Flags | null | undefined): AccessLevel | undefined =>
  (Object.keys(ACCESS_LEVELS) as AccessLevel[]).reverse().find((level) => includes(permission, ACCESS_LEVELS[level].capabilities));

// Assigned on the organization when it is created
export const EVERYONE_IN_ORGANIZATION = bitmap("directory");
export const ADMINS = bitmap("read", "create", "edit", "delete", "comment", "share", "directory", "admin");

// Bits of the content tables, the others only matter on the organization
export const CONTENT_BITS = bitmap("read", "create", "edit", "delete", "comment", "share");
