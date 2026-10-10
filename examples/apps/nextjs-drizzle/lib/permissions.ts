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

// What a permission bitmap, as returned by `resource_permission`, allows
export const can = (permission: string | null | undefined, capability: Capability) => permission?.[BIT[capability]] === "1";

export const capabilities = (permission: string | null | undefined) =>
  (Object.keys(BIT) as Capability[]).filter((capability) => can(permission, capability));

// Every bit of `requested` is in `granted`
export const includes = (granted: string | null | undefined, requested: string) =>
  [...requested].every((bit, index) => bit === "0" || granted?.[index] === "1");

// Access levels offered when sharing a folder or a document
export const ACCESS_LEVELS = {
  viewer: { label: "Can view", permission: bitmap("read") },
  commenter: { label: "Can comment", permission: bitmap("read", "comment") },
  editor: { label: "Can edit", permission: bitmap("read", "create", "edit", "delete", "comment") },
  manager: { label: "Full access", permission: bitmap("read", "create", "edit", "delete", "comment", "share") },
} as const;

export type AccessLevel = keyof typeof ACCESS_LEVELS;

// The highest level whose bits are all in `permission`
export const levelOf = (permission: string | null | undefined): AccessLevel | undefined =>
  (Object.keys(ACCESS_LEVELS) as AccessLevel[]).reverse().find((level) => includes(permission, ACCESS_LEVELS[level].permission));

// Assigned on the organization when it is created
export const EVERYONE_IN_ORGANIZATION = bitmap("directory");
export const ADMINS = bitmap("read", "create", "edit", "delete", "comment", "share", "directory", "admin");

// Bits of the content tables, the others only matter on the organization
export const CONTENT_BITS = bitmap("read", "create", "edit", "delete", "comment", "share");
