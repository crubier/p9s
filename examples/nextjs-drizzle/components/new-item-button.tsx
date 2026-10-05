"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDocument, createFolder } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "./use-action";

const KINDS = {
  space: { title: "New space", description: "A top level folder. Only you and the admins can see it until you share it.", placeholder: "Marketing" },
  folder: { title: "New folder", description: "It gets the access of the folder it is in.", placeholder: "Notes" },
  document: { title: "New document", description: "It gets the access of the folder it is in.", placeholder: "Untitled" },
};

export function NewItemButton({ orgSlug, kind, parentId, children }: { orgSlug: string; kind: keyof typeof KINDS; parentId: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { pending, run } = useAction();
  const text = KINDS[kind];

  const submit = async () => {
    const result = await run(() => (kind === "document" ? createDocument(orgSlug, parentId!, name) : createFolder(orgSlug, parentId, name)));
    if (result.error !== undefined) return;
    setOpen(false);
    setName("");
    router.push(`/o/${orgSlug}/${kind === "document" ? "d" : "f"}/${result.value}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
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
            <Button type="submit" disabled={pending}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
