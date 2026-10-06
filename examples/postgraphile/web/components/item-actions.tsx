import { IconArrowsMove, IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useApi, useAction, useOrganization } from "@/lib/api";
import { DeleteDocument, DeleteFolder, MoveFolder, MoveTargetsQuery, RenameFolder, UpdateDocument } from "@/lib/operations";
import { can } from "@/lib/permissions";

export interface ItemActionsProps {
  kind: "folder" | "document";
  id: string;
  name: string;
  permission: string | null;
  // Where to go once deleted
  parentHref: string;
}

// The menu shows what the bitmap allows. RLS checks again, whatever the menu shows
export function ItemActions({ kind, id, name, permission, parentHref }: ItemActionsProps) {
  const navigate = useNavigate();
  const { slug } = useOrganization();
  const [dialog, setDialog] = useState<"rename" | "move" | "delete">();
  const [value, setValue] = useState("");
  // The folders the member can create in, loaded when they want to move the item
  const targets = useApi(MoveTargetsQuery, { slug }, { enabled: dialog === "move" });
  const { pending, run } = useAction();
  const canEdit = can(permission, "edit");
  const canDelete = can(permission, "delete");
  if (!canEdit && !canDelete) return null;

  const close = () => setDialog(undefined);
  const submit = async () => {
    if (dialog === "rename") {
      if (!(await run((send) => send(RenameFolder, { rowId: id, name: value }), "Renamed")).error) close();
    } else if (dialog === "move") {
      const moved = await run(async (send) => {
        if (kind === "folder") await send(MoveFolder, { folderId: id, parentId: value });
        else await send(UpdateDocument, { rowId: id, patch: { folderId: value } });
      }, "Moved");
      if (!moved.error) close();
    } else if (dialog === "delete") {
      // Off the page before the queries reload, as it no longer exists
      await run(async (send) => {
        await (kind === "folder" ? send(DeleteFolder, { rowId: id }) : send(DeleteDocument, { rowId: id }));
        close();
        navigate(parentHref);
      }, "Deleted");
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
            <DropdownMenuItem onClick={() => (setValue(""), setDialog("move"))}>
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
            className="grid min-w-0 gap-4"
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
              <FolderPicker
                targets={targets.data?.organizationBySlug?.moveTargets.nodes.flatMap((target) => (target?.rowId && target.rowId !== id ? [{ id: target.rowId, label: target.label ?? "" }] : []))}
                value={value}
                onChange={setValue}
              />
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

const SHOWN = 100;

// There can be thousands of folders to choose from: filter them as you type, and show the first matches
function FolderPicker({ targets, value, onChange }: { targets?: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const matching = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (targets ?? []).filter((target) => words.every((word) => target.label.toLowerCase().includes(word)));
  }, [targets, query]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Input
        autoFocus
        placeholder={targets ? `Search ${targets.length.toLocaleString("en")} folders` : "Loading folders…"}
        aria-label="Search folders"
        disabled={!targets}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {targets && (
        <ul aria-label="Folders" className="max-h-64 overflow-y-auto rounded-md border p-1">
          {matching.slice(0, SHOWN).map((target) => (
            <li key={target.id}>
              <button
                type="button"
                className="hover:bg-accent aria-pressed:bg-accent aria-pressed:font-medium w-full truncate rounded-sm px-2 py-1.5 text-left text-sm"
                aria-pressed={target.id === value}
                onClick={() => onChange(target.id)}
              >
                {target.label}
              </button>
            </li>
          ))}
          {matching.length === 0 && <li className="text-muted-foreground px-2 py-1.5 text-sm">No folder matches.</li>}
          {matching.length > SHOWN && (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">{(matching.length - SHOWN).toLocaleString("en")} more, type to narrow down.</li>
          )}
        </ul>
      )}
    </div>
  );
}
