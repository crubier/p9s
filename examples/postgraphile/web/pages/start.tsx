import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { PageState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi, useAction } from "@/lib/api";
import { CreateOrganization, StartQuery } from "@/lib/operations";

// To the first organization of the user, to create one if they have none, or to sign in
export function Start() {
  const start = useApi(StartQuery, {});
  if (!start.data) return <PageState error={start.error} />;
  if (!start.data.viewer) return <Navigate to="/sign-in" replace />;
  const first = start.data.myOrganizations?.nodes[0];
  return <Navigate to={first ? `/o/${first.slug}` : "/onboarding"} replace />;
}

export function Onboarding() {
  const navigate = useNavigate();
  const start = useApi(StartQuery, {});
  const [name, setName] = useState("");
  const { pending, run } = useAction();
  if (!start.data) return <PageState error={start.error} />;
  const { viewer, myOrganizations } = start.data;
  if (!viewer) return <Navigate to="/sign-in" replace />;
  const organizations = (myOrganizations?.nodes ?? []).flatMap((org) => (org ? [org] : []));

  return (
    <div className="bg-muted flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create an organization</CardTitle>
          <CardDescription>
            You will be its admin. To join an existing one, ask one of its admins to invite <b>{viewer.email}</b>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const created = await run(async (send) => (await send(CreateOrganization, { name: name.trim() || `${viewer.name}'s organization` })).createOrganization?.organization?.slug);
              if (created.error === undefined) navigate(`/o/${created.value}`);
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="Acme" required value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <Button type="submit" disabled={pending}>
              Create
            </Button>
          </form>
          {organizations.length > 0 && (
            <div className="text-sm">
              Or go to{" "}
              {organizations.map((org, index) => (
                <span key={org.rowId}>
                  {index > 0 && ", "}
                  <Link className="underline" to={`/o/${org.slug}`}>
                    {org.name}
                  </Link>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
