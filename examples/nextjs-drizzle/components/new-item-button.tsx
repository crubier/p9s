"use client";

import { IconFilePlus, IconFolderPlus, IconPlus } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDocument, createFolder } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAction } from "./use-action";

const KINDS = {
  space: { title: "New space", description: "A top level folder. Only you and the admins can see it until you share it.", placeholder: "Marketing" },
  folder: { title: "New folder", description: "It gets the access of the folder it is in.", placeholder: "Notes" },
  document: { title: "New document", description: "It gets the access of the folder it is in.", placeholder: "Untitled" },
};

type Kind = keyof typeof KINDS;

function NewItemForm({ orgSlug, kind, parentId, onDone }: { orgSlug: string; kind: Kind; parentId: string | null; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const { pending, run } = useAction();
  const text = KINDS[kind];

  const submit = async () => {
    const result = await run(() => (kind === "document" ? createDocument(orgSlug, parentId!, name) : createFolder(orgSlug, parentId, name)));
    if (result.error !== undefined) return;
    onDone();
    router.push(`/o/${orgSlug}/${kind === "document" ? "d" : "f"}/${result.value}`);
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
      </DialogHeader>
      <Input autoFocus required placeholder={text.placeholder} value={name} onChange={(event) => setName(event.target.value)} />
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewItemButton({ orgSlug, kind, parentId, children }: { orgSlug: string; kind: Kind; parentId: string | null; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>{open && <NewItemForm orgSlug={orgSlug} kind={kind} parentId={parentId} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

// One button for what can be created in a folder
export function AddMenu({ orgSlug, parentId }: { orgSlug: string; parentId: string }) {
  const [kind, setKind] = useState<Kind>();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <IconPlus /> Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setKind("document")}>
            <IconFilePlus /> Document
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setKind("folder")}>
            <IconFolderPlus /> Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={kind !== undefined} onOpenChange={(open) => !open && setKind(undefined)}>
        <DialogContent>{kind && <NewItemForm key={kind} orgSlug={orgSlug} kind={kind} parentId={parentId} onDone={() => setKind(undefined)} />}</DialogContent>
      </Dialog>
    </>
  );
}
