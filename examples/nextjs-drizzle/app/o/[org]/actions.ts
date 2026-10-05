"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { AccessLevel } from "@/lib/permissions";
import { describeError } from "@/src/db";
import * as service from "@/src/service";
import { IMPERSONATION_COOKIE, requireActor, requireRealActor } from "@/src/session";
import { moveTargets } from "./data";

// Every action acts as the signed-in member of the organization, and returns an error message rather than throwing,
// for the client to show. RLS and the service functions decide what is allowed.
export type ActionResult<T = undefined> = { error: string } | { error?: undefined; value: T };

const act = async <T>(orgSlug: string, fn: (actor: service.Actor) => Promise<T>): Promise<ActionResult<T>> => {
  const actor = await requireActor(orgSlug);
  try {
    const value = await fn(actor);
    revalidatePath(`/o/${orgSlug}`, "layout");
    return { value };
  } catch (error) {
    return { error: describeError(error) };
  }
};

export const createFolder = async (orgSlug: string, parentId: string | null, name: string) =>
  act(orgSlug, (actor) => service.createFolder(actor, parentId, name));

export const renameFolder = async (orgSlug: string, folderId: string, name: string) =>
  act(orgSlug, (actor) => service.renameFolder(actor, folderId, name));

export const moveFolder = async (orgSlug: string, folderId: string, parentId: string) =>
  act(orgSlug, (actor) => service.moveFolder(actor, folderId, parentId));

export const deleteFolder = async (orgSlug: string, folderId: string) => act(orgSlug, (actor) => service.deleteFolder(actor, folderId));

export const createDocument = async (orgSlug: string, folderId: string, title: string) =>
  act(orgSlug, (actor) => service.createDocument(actor, folderId, title));

export const updateDocument = async (orgSlug: string, documentId: string, values: { title?: string; content?: string }) =>
  act(orgSlug, (actor) => service.updateDocument(actor, documentId, values));

export const moveDocument = async (orgSlug: string, documentId: string, folderId: string) =>
  act(orgSlug, (actor) => service.moveDocument(actor, documentId, folderId));

export const deleteDocument = async (orgSlug: string, documentId: string) =>
  act(orgSlug, (actor) => service.deleteDocument(actor, documentId));

export const addComment = async (orgSlug: string, documentId: string, body: string) =>
  act(orgSlug, (actor) => service.addComment(actor, documentId, body));

export const deleteComment = async (orgSlug: string, commentId: string) => act(orgSlug, (actor) => service.deleteComment(actor, commentId));

export const share = async (orgSlug: string, resourceId: string, roleId: string, level: AccessLevel) =>
  act(orgSlug, (actor) => service.share(actor, resourceId, roleId, level));

export const unshare = async (orgSlug: string, resourceId: string, roleId: string) =>
  act(orgSlug, (actor) => service.unshare(actor, resourceId, roleId));

export const inviteMember = async (orgSlug: string, email: string) => act(orgSlug, (actor) => service.inviteMember(actor, email));

export const removeMember = async (orgSlug: string, memberId: string) => act(orgSlug, (actor) => service.removeMember(actor, memberId));

export const createTeam = async (orgSlug: string, name: string) => act(orgSlug, (actor) => service.createTeam(actor, name));

export const deleteTeam = async (orgSlug: string, teamId: string) => act(orgSlug, (actor) => service.deleteTeam(actor, teamId));

export const setTeamMembership = async (orgSlug: string, teamId: string, memberId: string, isMember: boolean) =>
  act(orgSlug, (actor) => service.setTeamMembership(actor, teamId, memberId, isMember));

export const createApiKey = async (orgSlug: string, name: string) => act(orgSlug, (actor) => service.createApiKey(actor, name));

export const revokeApiKey = async (orgSlug: string, keyId: string) => act(orgSlug, (actor) => service.revokeApiKey(actor, keyId));

// Reads, for the client components that load what they show on demand

const read = async <T>(orgSlug: string, fn: (actor: service.Actor) => Promise<T>): Promise<ActionResult<T>> => {
  const actor = await requireActor(orgSlug);
  try {
    return { value: await fn(actor) };
  } catch (error) {
    return { error: describeError(error) };
  }
};

export const searchPrincipals = async (orgSlug: string, query: string) => read(orgSlug, (actor) => service.searchPrincipals(actor, query));

export const listMoveTargets = async (orgSlug: string) => read(orgSlug, moveTargets);

// Impersonation: the cookie only names who to impersonate, every request checks again that the signed-in user is an
// admin of the organization

export const startImpersonation = async (orgSlug: string, memberId: string, mode: service.ImpersonationMode) => {
  const admin = await requireRealActor(orgSlug);
  try {
    await service.startImpersonation(admin, memberId, mode);
  } catch (error) {
    return { error: describeError(error) };
  }
  (await cookies()).set(IMPERSONATION_COOKIE, `${admin.org.id}:${memberId}:${mode}`, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
  return { value: undefined };
};

export const stopImpersonation = async (orgSlug: string) => {
  await service.stopImpersonation(await requireActor(orgSlug));
  (await cookies()).delete(IMPERSONATION_COOKIE);
  revalidatePath("/", "layout");
  return { value: undefined };
};
