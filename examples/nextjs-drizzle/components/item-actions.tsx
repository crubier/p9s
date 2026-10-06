"use client";

import { IconArrowsMove, IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteDocument, deleteFolder, listMoveTargets, moveDocument, moveFolder, renameFolder } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { can } from "@/lib/permissions";
import { useAction } from "./use-action";

export interface ItemActionsProps {
  orgSlug: string;
  kind: "folder" | "document";
  id: string;
  name: string;
  permission: string | null;
  // Where to go once deleted
  parentHref: string;
}

// The menu shows what the bitmap allows. The server and RLS check again, whatever the menu shows
export function ItemActions({ orgSlug, kind, id, name, permission, parentHref }: ItemActionsProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"rename" | "move" | "delete">();
  const [value, setValue] = useState("");
  // The folders the member can create in, loaded when they want to move the item
  const [targets, setTargets] = useState<{ id: string; label: string }[]>();
  const { pending, run } = useAction();
  const openMove = async () => {
    setValue("");
    setDialog("move");
    if (!targets) {
      const found = await run(() => listMoveTargets(orgSlug));
      if (found.error === undefined) setTargets(found.value);
    }
  };
  const canEdit = can(permission, "edit");
  const canDelete = can(permission, "delete");
  if (!canEdit && !canDelete) return null;

  const close = () => setDialog(undefined);
  const submit = async () => {
    if (dialog === "rename") {
      if (!(await run(() => renameFolder(orgSlug, id, value), "Renamed")).error) close();
    } else if (dialog === "move") {
      if (!(await run(() => (kind === "folder" ? moveFolder(orgSlug, id, value) : moveDocument(orgSlug, id, value)), "Moved")).error) close();
    } else if (dialog === "delete") {
      if ((await run(() => (kind === "folder" ? deleteFolder(orgSlug, id) : deleteDocument(orgSlug, id)), "Deleted")).error) return;
      close();
      router.push(parentHref);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && kind === "folder" && (
            <DropdownMenuItem onClick={() => (setValue(name), setDialog("rename"))}>
              <IconPencil /> Rename
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={openMove}>
              <IconArrowsMove /> Move
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
              <IconTrash /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== undefined} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{{ rename: `Rename ${name}`, move: `Move ${name}`, delete: `Delete ${name}?` }[dialog ?? "rename"]}</DialogTitle>
              <DialogDescription>
                {dialog === "move"
                  ? "It will get the access of its new folder. You need to be able to create in that folder."
                  : dialog === "delete"
                    ? kind === "folder"
                      ? "Everything in it is deleted too, even what you cannot see."
                      : "Its comments are deleted too."
                    : null}
              </DialogDescription>
            </DialogHeader>
            {dialog === "rename" && <Input autoFocus required value={value} onChange={(event) => setValue(event.target.value)} />}
            {dialog === "move" && (
              <Select
                value={value || null}
                items={(targets ?? []).map((target) => ({ value: target.id, label: target.label }))}
                onValueChange={(next) => setValue(next ?? "")}
              >
                <SelectTrigger className="w-full" disabled={!targets}>
                  <SelectValue placeholder={targets ? "Choose a folder" : "Loading folders…"} />
                </SelectTrigger>
                <SelectContent>
                  {(targets ?? [])
                    .filter((target) => target.id !== id)
                    .map((target) => (
                      <SelectItem key={target.id} value={target.id}>
                        {target.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <DialogFooter>
              <Button type="submit" variant={dialog === "delete" ? "destructive" : "default"} disabled={pending || (dialog === "move" && !value)}>
                {{ rename: "Rename", move: "Move", delete: "Delete" }[dialog ?? "rename"]}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
