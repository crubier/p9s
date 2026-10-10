import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/api";
import { CreateComment, DeleteComment } from "@/lib/operations";
import { parseTime } from "@/lib/time";

export interface CommentRow {
  rowId: string;
  body: string;
  createdAt: string;
  author?: { name?: string | null } | null;
}

export function Comments({ documentId, comments, canComment, canDelete }: { documentId: string; comments: CommentRow[]; canComment: boolean; canDelete: boolean }) {
  const [body, setBody] = useState("");
  const { pending, run } = useAction();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Comments</h2>
      {comments.length === 0 && <p className="text-muted-foreground text-sm">No comments yet.</p>}
      <ul className="flex flex-col gap-3">
        {comments.map((comment) => (
          <li key={comment.rowId} className="bg-muted/50 group rounded-lg p-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">{comment.author?.name ?? "Former member"}</span>
              <span className="text-muted-foreground">{parseTime(comment.createdAt).toLocaleString("en")}</span>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto size-6 opacity-0 group-hover:opacity-100"
                  aria-label="Delete comment"
                  disabled={pending}
                  onClick={() => run((send) => send(DeleteComment, { rowId: comment.rowId }))}
                >
                  <IconTrash />
                </Button>
              )}
            </div>
            <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
          </li>
        ))}
      </ul>
      {canComment ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!(await run((send) => send(CreateComment, { documentId, body }))).error) setBody("");
          }}
        >
          <Textarea placeholder="Add a comment" required value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              Comment
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">You cannot comment on this document.</p>
      )}
    </section>
  );
}
