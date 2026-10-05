import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { NotFoundError } from "@/src/db";
import { listFolders, type Actor } from "@/src/service";

// A 404 for rows that do not exist or that RLS hides, which look the same on purpose
export const orNotFound = <T,>(promise: Promise<T>) => promise.catch((error) => (error instanceof NotFoundError ? notFound() : Promise.reject(error)));

// The folders the actor can create in, labelled with the part of their path the actor can see
export const moveTargets = async (actor: Actor) => {
  const folders = await listFolders(actor);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const label = (id: string): string => {
    const folder = byId.get(id)!;
    return folder.parentId && byId.has(folder.parentId) ? `${label(folder.parentId)} / ${folder.name}` : folder.name;
  };
  return folders
    .filter((folder) => can(folder.permission, "create"))
    .map((folder) => ({ id: folder.id, label: label(folder.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
};
