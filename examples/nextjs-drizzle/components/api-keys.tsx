"use client";

import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { createApiKey, revokeApiKey } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "./use-action";

export interface ApiKeyRow { id: string; name: string; tokenStart: string; createdAt: Date; lastUsedAt: Date | null }

export function ApiKeys({ orgSlug, keys, origin }: { orgSlug: string; keys: ApiKeyRow[]; origin: string }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState<string>();
  const { pending, run } = useAction();

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await run(() => createApiKey(orgSlug, name));
          if (result.error === undefined) {
            setToken(result.value);
            setName("");
          }
        }}
      >
        <Input required placeholder="Key name, like CI" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" disabled={pending}>Create key</Button>
      </form>
      {token && (
        <div className="bg-muted flex flex-col gap-2 rounded-lg p-4 text-sm">
          <p className="font-medium">Copy this key now, it is only shown once:</p>
          <code className="bg-background rounded p-2 break-all">{token}</code>
          <pre className="bg-background overflow-x-auto rounded p-2 text-xs">{`curl -H "Authorization: Bearer ${token}" ${origin}/api/v1/documents`}</pre>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground text-center">No keys yet.</TableCell>
            </TableRow>
          )}
          {keys.map((key) => (
            <TableRow key={key.id}>
              <TableCell className="font-medium">{key.name}</TableCell>
              <TableCell className="font-mono text-xs">{key.tokenStart}…</TableCell>
              <TableCell className="text-muted-foreground text-xs">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("en") : "Never"}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${key.name}`} disabled={pending} onClick={() => run(() => revokeApiKey(orgSlug, key.id), "Key revoked")}>
                  <IconTrash />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
