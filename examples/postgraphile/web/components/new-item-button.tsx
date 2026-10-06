import { IconFilePlus, IconFolderPlus, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAction, useOrganization } from "@/lib/api";
import { CreateDocument, CreateFolder } from "@/lib/operations";

const KINDS = {
  space: { title: "New space", description: "A top level folder. Only you and the admins can see it until you share it.", placeholder: "Marketing" },
  folder: { title: "New folder", description: "It gets the access of the folder it is in.", placeholder: "Notes" },
  document: { title: "New document", description: "It gets the access of the folder it is in.", placeholder: "Untitled" },
};

type Kind = keyof typeof KINDS;

function NewItemForm({ kind, parentId, onDone }: { kind: Kind; parentId: string | null; onDone: () => void }) {
  const navigate = useNavigate();
  const organization = useOrganization();
  const [name, setName] = useState("");
  const { pending, run } = useAction();
  const text = KINDS[kind];

  const submit = async () => {
    const result = await run(async (send) =>
      kind === "document"
        ? (await send(CreateDocument, { folderId: parentId!, title: name })).createDocument?.document?.rowId
        : (await send(CreateFolder, { orgId: organization.rowId, parentId, name })).createFolder?.folder?.rowId,
    );
    if (result.error !== undefined) return;
    onDone();
    navigate(`/o/${organization.slug}/${kind === "document" ? "d" : "f"}/${result.value}`);
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

export function NewItemButton({ kind, parentId, children }: { kind: Kind; parentId: string | null; children: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogContent>{open && <NewItemForm kind={kind} parentId={parentId} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

// One button for what can be created in a folder
export function AddMenu({ parentId }: { parentId: string }) {
  const [kind, setKind] = useState<Kind>();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <IconPlus /> Add
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setKind("document")}>
            <IconFilePlus /> Document
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setKind("folder")}>
            <IconFolderPlus /> Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={kind !== undefined} onOpenChange={(open) => !open && setKind(undefined)}>
        <DialogContent>{kind && <NewItemForm key={kind} kind={kind} parentId={parentId} onDone={() => setKind(undefined)} />}</DialogContent>
      </Dialog>
    </>
  );
}
