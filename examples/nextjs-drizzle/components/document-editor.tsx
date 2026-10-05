"use client";

import { useState } from "react";
import { updateDocument } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "./use-action";

export function DocumentEditor({ orgSlug, id, title, content, canEdit }: { orgSlug: string; id: string; title: string; content: string; canEdit: boolean }) {
  const [draft, setDraft] = useState({ title, content });
  const { pending, run } = useAction();
  const changed = draft.title !== title || draft.content !== content;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => updateDocument(orgSlug, id, draft), "Saved");
      }}
    >
      <Input
        className="h-auto border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
        aria-label="Title"
        readOnly={!canEdit}
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />
      <Textarea
        className="min-h-64 resize-none"
        aria-label="Content"
        readOnly={!canEdit}
        value={draft.content}
        onChange={(event) => setDraft({ ...draft, content: event.target.value })}
      />
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !changed}>Save</Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">You can read this document, not edit it.</p>
      )}
    </form>
  );
}
