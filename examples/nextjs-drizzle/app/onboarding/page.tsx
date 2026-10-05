import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganization, listMemberships } from "@/src/service";
import { requireUser } from "@/src/session";

export default async function Onboarding() {
  const user = await requireUser();
  const memberships = await listMemberships(user.id);

  async function create(form: FormData) {
    "use server";
    const user = await requireUser();
    const org = await createOrganization(user.id, String(form.get("name")).trim() || `${user.name}'s organization`);
    redirect(`/o/${org.slug}`);
  }

  return (
    <div className="bg-muted flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create an organization</CardTitle>
          <CardDescription>
            You will be its admin. To join an existing one, ask one of its admins to invite <b>{user.email}</b>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={create} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Acme" required />
            </div>
            <Button type="submit">Create</Button>
          </form>
          {memberships.length > 0 && (
            <div className="text-sm">
              Or go to{" "}
              {memberships.map((org, index) => (
                <span key={org.id}>
                  {index > 0 && ", "}
                  <Link className="underline" href={`/o/${org.slug}`}>{org.name}</Link>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
