import { IconFileText, IconFolder } from "@tabler/icons-react";
import { Link } from "react-router";
import { parseTime } from "@/lib/time";
import type { Flags } from "@/lib/permissions";
import { PermissionBadge } from "./permission-badge";

export interface Item {
  kind: "folder" | "document";
  rowId: string;
  name: string;
  permission?: Flags | null;
  updatedAt?: string;
}

export const folderItem = (folder: { rowId: string; name: string; permission?: Flags | null }): Item => ({ kind: "folder", ...folder });

export const documentItem = (document: { rowId: string; title: string; permission?: Flags | null; updatedAt?: string }): Item => ({
  kind: "document",
  rowId: document.rowId,
  name: document.title,
  permission: document.permission,
  updatedAt: document.updatedAt,
});

export function ItemList({ orgSlug, items, empty }: { orgSlug: string; items: Item[]; empty: string }) {
  if (!items.length) return <p className="text-muted-foreground py-6 text-center text-sm">{empty}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item) => {
        const Icon = item.kind === "folder" ? IconFolder : IconFileText;
        return (
          <li key={item.rowId}>
            <Link to={`/o/${orgSlug}/${item.kind === "folder" ? "f" : "d"}/${item.rowId}`} className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3">
              <Icon className="text-muted-foreground size-5 shrink-0" />
              <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
              {item.updatedAt && <span className="text-muted-foreground hidden text-xs sm:inline">{parseTime(item.updatedAt).toLocaleDateString("en")}</span>}
              <PermissionBadge permission={item.permission ?? null} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
