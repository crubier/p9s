import { IconFileText, IconFolder } from "@tabler/icons-react";
import Link from "next/link";
import { PermissionBadge } from "./permission-badge";

export interface Item {
  kind: "folder" | "document";
  id: string;
  name: string;
  permission: string | null;
  updatedAt?: string;
}

export function ItemList({ orgSlug, items, empty }: { orgSlug: string; items: Item[]; empty: string }) {
  if (!items.length) return <p className="text-muted-foreground py-6 text-center text-sm">{empty}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item) => {
        const Icon = item.kind === "folder" ? IconFolder : IconFileText;
        return (
          <li key={item.id}>
            <Link href={`/o/${orgSlug}/${item.kind === "folder" ? "f" : "d"}/${item.id}`} className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3">
              <Icon className="text-muted-foreground size-5 shrink-0" />
              <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
              {item.updatedAt && <span className="text-muted-foreground hidden text-xs sm:inline">{new Date(item.updatedAt).toLocaleDateString("en")}</span>}
              <PermissionBadge permission={item.permission} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
