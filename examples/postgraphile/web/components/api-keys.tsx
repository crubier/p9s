import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/lib/api";
import { CreateApiKey, RevokeApiKey } from "@/lib/operations";
import { parseTime } from "@/lib/time";

export interface ApiKeyRow {
  rowId: string;
  name: string;
  tokenStart: string;
  lastUsedAt: string | null;
}

// A key acts as its member, in GraphiQL too: the example request reads the documents the key can see
const example = (token: string) =>
  `curl ${location.origin}/graphql \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "{ currentMember { name } myOrganizations { nodes { name documents(first: 5) { totalCount nodes { title } } } } }"}'`;

export function ApiKeys({ keys }: { keys: ApiKeyRow[] }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState<string>();
  const { pending, run } = useAction();

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await run(async (send) => (await send(CreateApiKey, { name })).createApiKey?.token);
          if (result.error === undefined && result.value) {
            setToken(result.value);
            setName("");
          }
        }}
      >
        <Input required placeholder="Key name, like CI" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" disabled={pending}>
          Create key
        </Button>
      </form>
      {token && (
        <div className="bg-muted flex flex-col gap-2 rounded-lg p-4 text-sm">
          <p className="font-medium">Copy this key now, it is only shown once:</p>
          <code className="bg-background rounded p-2 break-all">{token}</code>
          <p className="text-muted-foreground">
            Send it as <code>Authorization: Bearer …</code> to <code>/graphql</code>, or in the headers tab of GraphiQL. It acts as you, in the organizations you are a
            member of:
          </p>
          <pre className="bg-background overflow-x-auto rounded p-2 text-xs">{example(token)}</pre>
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
              <TableCell colSpan={4} className="text-muted-foreground text-center">
                No keys yet.
              </TableCell>
            </TableRow>
          )}
          {keys.map((key) => (
            <TableRow key={key.rowId}>
              <TableCell className="font-medium">{key.name}</TableCell>
              <TableCell className="font-mono text-xs">{key.tokenStart}…</TableCell>
              <TableCell className="text-muted-foreground text-xs">{key.lastUsedAt ? parseTime(key.lastUsedAt).toLocaleString("en") : "Never"}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revoke ${key.name}`}
                  disabled={pending}
                  onClick={() => run((send) => send(RevokeApiKey, { id: key.rowId }), "Key revoked")}
                >
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
