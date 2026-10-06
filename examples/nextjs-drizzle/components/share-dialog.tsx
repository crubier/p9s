"use client";

import { IconShare, IconTrash, IconUser, IconUsers, IconWorld, IconX } from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { searchPrincipals, share, unshare } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCESS_LEVELS, can, capabilities, includes, type AccessLevel } from "@/lib/permissions";
import type { AccessRow, Principal } from "@/src/service";
import { PermissionBadge } from "./permission-badge";
import { useAction } from "./use-action";

const ICONS = { everyone: IconWorld, team: IconUsers, member: IconUser };

export interface ShareDialogProps {
  orgSlug: string;
  resourceId: string;
  name: string;
  // The bitmap of the current member on the resource
  permission: string | null;
  access: AccessRow[];
}

// Organizations have thousands of members: the server searches them as you type
function PrincipalPicker({ orgSlug, value, onChange }: { orgSlug: string; value: Principal | undefined; onChange: (principal: Principal | undefined) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Principal[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = setTimeout(async () => {
      const found = await searchPrincipals(orgSlug, query);
      if (current && found.error === undefined) setResults(found.value);
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [orgSlug, query, open]);

  if (value) {
    const Icon = ICONS[value.kind];
    return (
      <div className="flex h-9 flex-1 items-center gap-2 rounded-md border px-3 text-sm">
        <Icon className="text-muted-foreground size-4" />
        <span className="flex-1 truncate">{value.name}</span>
        <button type="button" aria-label="Choose someone else" onClick={() => onChange(undefined)}>
          <IconX className="text-muted-foreground size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative flex-1">
      <Input
        placeholder="Add people or teams"
        aria-label="Add people or teams"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && results.length > 0 && (
        <ul role="listbox" className="bg-popover absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border p-1 shadow-md">
          {results.map((principal) => {
            const Icon = ICONS[principal.kind];
            return (
              <li key={principal.roleId} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onChange(principal)}
                >
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{principal.name}</span>
                  {principal.detail && <span className="text-muted-foreground ml-auto truncate text-xs">{principal.detail}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ShareDialog({ orgSlug, resourceId, name, permission, access }: ShareDialogProps) {
  const canShare = can(permission, "share");
  const [principal, setPrincipal] = useState<Principal>();
  const [level, setLevel] = useState<AccessLevel>("viewer");
  const { pending, run } = useAction();
  const grantable = (Object.keys(ACCESS_LEVELS) as AccessLevel[]).filter((key) => includes(permission, ACCESS_LEVELS[key].permission));
  const sharers = [...new Set(access.filter((row) => can(row.permission, "share")).map((row) => row.name))];
  const label = (row: AccessRow) => (row.level ? ACCESS_LEVELS[row.level].label : row.permission);

  const levelPicker = (value: AccessLevel, onChange: (level: AccessLevel) => void, props: { disabled?: boolean; ariaLabel: string; size?: "sm" }) => (
    <Select value={value} onValueChange={(next) => onChange(next as AccessLevel)} disabled={props.disabled}>
      <SelectTrigger className="w-36" size={props.size} aria-label={props.ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(grantable.includes(value) ? grantable : [...grantable, value]).map((key) => (
          <SelectItem key={key} value={key} disabled={!grantable.includes(key)}>
            {ACCESS_LEVELS[key].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconShare /> {canShare ? "Share" : "Access"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{canShare ? `Share ${name}` : `Who has access to ${name}`}</DialogTitle>
          <DialogDescription>
            Access given on a folder applies to everything inside it.{" "}
            {canShare
              ? "Add people or teams, change what they can do, or remove them. You can give up to your own access."
              : `Only people with Full access can share it${sharers.length ? `, like ${sharers.slice(0, 3).join(", ")}` : ""}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Your access</span>
          <PermissionBadge permission={permission} />
          <span className="text-muted-foreground text-xs">{capabilities(permission).join(", ") || "nothing"}</span>
        </div>
        {canShare && (
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (principal && !(await run(() => share(orgSlug, resourceId, principal.roleId, level), "Shared")).error) setPrincipal(undefined);
            }}
          >
            <PrincipalPicker orgSlug={orgSlug} value={principal} onChange={setPrincipal} />
            {levelPicker(level, setLevel, { ariaLabel: "Access to give" })}
            <Button type="submit" disabled={pending || !principal}>
              Share
            </Button>
          </form>
        )}
        <ul className="-mx-1 max-h-[50vh] divide-y overflow-y-auto px-1">
          {access.map((row) => {
            const Icon = ICONS[row.kind];
            const editable = row.direct && canShare;
            return (
              <li key={`${row.roleId}:${row.from}`} className="flex items-center gap-3 py-2">
                <Icon className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{row.name}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {row.direct ? (
                      "Given here"
                    ) : row.fromFolderId ? (
                      <>
                        From{" "}
                        <Link className="text-foreground underline" href={`/o/${orgSlug}/f/${row.fromFolderId}`}>
                          {row.from}
                        </Link>
                        , change it there
                      </>
                    ) : row.from ? (
                      `From ${row.from}, for every space`
                    ) : (
                      "From a folder you cannot see"
                    )}
                    {row.detail && ` · ${row.detail}`}
                  </div>
                </div>
                {editable && row.level ? (
                  levelPicker(row.level, (next) => run(() => share(orgSlug, resourceId, row.roleId, next), "Access changed"), {
                    disabled: pending || !includes(permission, row.permission),
                    ariaLabel: `Access of ${row.name}`,
                    size: "sm",
                  })
                ) : (
                  <span className="text-sm">{label(row)}</span>
                )}
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${row.name}`}
                    disabled={pending || !includes(permission, row.permission)}
                    onClick={() => run(() => unshare(orgSlug, resourceId, row.roleId), "Access removed")}
                  >
                    <IconTrash />
                  </Button>
                )}
              </li>
            );
          })}
          {!access.length && <li className="text-muted-foreground py-2 text-sm">Nobody else has access yet.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
