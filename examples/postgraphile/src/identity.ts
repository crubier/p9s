import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import { BIT } from "../lib/permissions.js";
import { auth } from "./auth.js";
import { pool } from "./db.js";

// The organization a request is made in, by its slug. The app sends it with every request, GraphiQL with the headers of
// the links that open it
export const ORG_HEADER = "x-p9s-org";

// For pages. The policies list once every resource the user can read, then look rows up in that list. With
// p9s.check_rows on, they check the ancestors of each row the scan walks instead, about the size of the page divided
// by the share of rows the user can read: a user who reads few would walk most of the table, so the request gets a
// short timeout, past which the app asks again without the header
export const CHECK_ROWS_HEADER = "x-p9s-check-rows";

// `<organization id>:<member id>:<view|act>`, set when an admin starts viewing or acting as a member. It names who to
// impersonate, and gives no right: it is only followed while the signed-in user is an admin of that organization
export const IMPERSONATION_COOKIE = "p9s-impersonation";

export type Identity = {
  userId?: string;
  // The role p9s checks the request against: of the member, of the member an admin impersonates, or of an API key
  roleId?: string;
  impersonatorMemberId?: string;
  readOnly?: boolean;
};

const header = (headers: IncomingHttpHeaders, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const cookie = (headers: IncomingHttpHeaders, name: string) =>
  header(headers, "cookie")
    ?.split(/;\s*/)
    .map((pair) => pair.split("="))
    .find(([key]) => key === name)?.[1];

export const hashApiKey = (token: string) => createHash("sha256").update(token).digest("hex");

// A key acts as its member, with no user: it cannot list their organizations
export const fromApiKey = async (token: string): Promise<Identity> => {
  const { rows } = await pool.query<{ role_id: string }>(
    `update api_key set last_used_at = now() where token_hash = $1 returning role_id`,
    [hashApiKey(token)],
  );
  return { roleId: rows[0]?.role_id };
};

// Whether a role has the admin bit on the organization, checked by p9s as that role
const isAdmin = async (roleId: string, orgResourceId: string) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('role', 'app_user', true), set_config('app.role_id', $1, true)`, [roleId]);
    const { rows } = await client.query<{ permission: string | null }>(`select resource_permission($1)::text as permission`, [
      orgResourceId,
    ]);
    return rows[0]?.permission?.[BIT.admin] === "1";
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
};

export type ImpersonationMode = "view" | "act";

// The user, as a member of the organization with this slug, or as the member they impersonate there. Who to
// impersonate is only followed while the user is an admin of the organization
export const memberIdentity = async (
  userId: string,
  slug: string,
  impersonation?: { orgId?: string; memberId: string; mode: ImpersonationMode },
): Promise<Identity> => {
  const { rows } = await pool.query<{ id: string; role_id: string; org_id: string; org_resource_id: string }>(
    `select m.id, m.role_id, o.id as org_id, o.resource_id as org_resource_id
     from member m join organization o on o.id = m.org_id where m.user_id = $1 and o.slug = $2`,
    [userId, slug],
  );
  const member = rows[0];
  if (!member) return { userId };
  const own = { userId, roleId: member.role_id };
  if (!impersonation || (impersonation.orgId ?? member.org_id) !== member.org_id || impersonation.memberId === member.id) return own;

  const { rows: targets } = await pool.query<{ role_id: string }>(`select role_id from member where id = $1 and org_id = $2`, [
    impersonation.memberId,
    member.org_id,
  ]);
  const target = targets[0];
  if (!target || !(await isAdmin(member.role_id, member.org_resource_id))) return own;
  return { userId, roleId: target.role_id, impersonatorMemberId: member.id, readOnly: impersonation.mode === "view" };
};

const readImpersonation = (headers: IncomingHttpHeaders) => {
  const [orgId, memberId, mode] = decodeURIComponent(cookie(headers, IMPERSONATION_COOKIE) ?? "").split(":");
  return orgId && memberId && (mode === "view" || mode === "act") ? { orgId, memberId, mode: mode as ImpersonationMode } : undefined;
};

export const identify = async (headers: IncomingHttpHeaders): Promise<Identity> => {
  const bearer = header(headers, "authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer) return fromApiKey(bearer);

  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!session) return {};
  const slug = header(headers, ORG_HEADER);
  return slug ? memberIdentity(session.user.id, slug, readImpersonation(headers)) : { userId: session.user.id };
};

// The settings of the transaction PostGraphile runs the request in, which sql/app.sql and p9s read
export const pgSettingsOf = (identity: Identity, checkRows: boolean) => ({
  role: "app_user",
  "app.role_id": identity.roleId ?? "",
  "app.user_id": identity.userId ?? "",
  "app.impersonator_member_id": identity.impersonatorMemberId ?? "",
  // RLS makes queries look expensive to the planner, which then compiles them for longer than they run
  jit: "off",
  ...(identity.readOnly ? { transaction_read_only: "on" } : {}),
  ...(checkRows ? { "p9s.check_rows": "on", statement_timeout: "10ms" } : {}),
});
