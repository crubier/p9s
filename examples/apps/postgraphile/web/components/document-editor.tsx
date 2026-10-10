import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/api";
import { UpdateDocument } from "@/lib/operations";

export function DocumentEditor({ id, title, content, canEdit, actions }: { id: string; title: string; content: string; canEdit: boolean; actions?: React.ReactNode }) {
  const formId = useId();
  const [draft, setDraft] = useState({ title, content });
  const { pending, run } = useAction();
  const changed = draft.title !== title || draft.content !== content;

  // The actions are outside the form: the forms of their dialogs would submit it too, as React events bubble through portals
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          form={formId}
          className="h-auto flex-1 border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
          aria-label="Title"
          readOnly={!canEdit}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
        {actions}
      </div>
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          run((send) => send(UpdateDocument, { rowId: id, patch: draft }), "Saved");
        }}
      >
        <Textarea
          className="min-h-64 resize-none"
          aria-label="Content"
          readOnly={!canEdit}
          value={draft.content}
          onChange={(event) => setDraft({ ...draft, content: event.target.value })}
        />
        {canEdit ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !changed}>
              Save
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">You can read this document, not edit it.</p>
        )}
      </form>
    </div>
  );
}
