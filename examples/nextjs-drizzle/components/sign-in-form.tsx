"use client";

import { IconArrowRight, IconLoader2 } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { MOCK_PASSWORD, mockEmail } from "@/src/mock/people";

interface Account {
  name: string;
  email: string;
  who: string;
}

// The people created by `bun run db:seed`, all with the password of the mock users
const ACME: Account[] = [
  { name: "Alice Admin", email: "alice@acme.test", who: "Admin, sees everything" },
  { name: "Bob Builder", email: "bob@acme.test", who: "Engineering, and an organization of his own" },
  { name: "Carol Designer", email: "carol@acme.test", who: "Design" },
  { name: "Dave Sales", email: "dave@acme.test", who: "In no team, sees what everyone sees" },
  { name: "Erin Contractor", email: "erin@acme.test", who: "In no team, edits only the Runbooks" },
];

export interface MockExample {
  name: string;
  first: number;
  last: number;
  accounts: Account[];
}

export function SignInForm({ acme, mockUsers, mockExamples }: { acme: boolean; mockUsers: number; mockExamples: MockExample[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [signingIn, setSigningIn] = useState<string>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [number, setNumber] = useState("");

  const signIn = (email: string, password: string) => {
    setSigningIn(email);
    startTransition(async () => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        toast.error(error.message ?? "Could not sign in");
        setSigningIn(undefined);
      } else router.push("/");
    });
  };

  const organization = (name: string, about: string, accounts: Account[]) => (
    <div key={name} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground text-xs">{about}</span>
      </div>
      <div className="divide-y rounded-md border">
        {accounts.map((person) => (
          <button
            key={person.email}
            type="button"
            disabled={pending}
            onClick={() => signIn(person.email, MOCK_PASSWORD)}
            className="hover:bg-accent group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors first:rounded-t-md last:rounded-b-md disabled:opacity-60"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{person.name}</span>
              <span className="text-muted-foreground truncate text-xs">{person.who}</span>
            </span>
            {signingIn === person.email && pending ? (
              <IconLoader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
            ) : (
              <span className="text-muted-foreground group-hover:text-foreground flex shrink-0 items-center gap-1 text-xs">
                Sign in <IconArrowRight className="size-3.5" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  const seeded = acme || mockUsers > 0;
  const both = mockExamples.length > 1 && mockExamples[1]!.first <= mockExamples[0]!.last;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Explore the demo</CardTitle>
          <CardDescription className="flex flex-col gap-2">
            <span>
              A team workspace, like Notion, whose permissions are enforced by Postgres with p9s: every query only returns what the person signed
              in may see.
            </span>
            {seeded && (
              <span className="text-foreground">
                No account needed. Pick someone below to sign in as them, then come back and pick someone else to compare what they see.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!seeded && (
            <p className="text-muted-foreground text-sm">
              There are no demo accounts yet. Run <code>bun run db:seed</code> to create them, or sign up below.
            </p>
          )}
          {acme && organization("Acme", "5 people, small and easy to follow", ACME)}
          {mockExamples.map((org) =>
            organization(org.name, `${(org.last - org.first + 1).toLocaleString("en")} people, a year of history`, org.accounts),
          )}
          {mockUsers > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="number" className="font-medium">
                Or anyone else
              </Label>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  signIn(mockEmail(Number(number)), MOCK_PASSWORD);
                }}
              >
                <Input
                  id="number"
                  type="number"
                  min={1}
                  max={mockUsers}
                  required
                  placeholder={`A number from 1 to ${mockUsers}`}
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={pending}>
                  Sign in
                </Button>
              </form>
              <p className="text-muted-foreground text-xs">
                Signs in as {number ? mockEmail(Number(number)) : mockEmail(42)}.
                {both && ` Users ${mockExamples[1]!.first} to ${mockExamples[0]!.last} are in both ${mockExamples[0]!.name} and ${mockExamples[1]!.name}.`}
              </p>
            </div>
          )}
          {seeded && (
            <div className="bg-muted/60 flex flex-col gap-1.5 rounded-md p-3 text-xs">
              <span className="font-medium">Things to try</span>
              <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4">
                <li>Sign in as an admin, open Members, and use View as on someone to see the workspace through their eyes.</li>
                <li>Open Share on a folder or a document to see who has access, and which folder it comes from.</li>
                <li>As an admin, the Audit log shows who changed what, including while acting as someone else.</li>
                <li>As someone in no team, notice how little there is in the sidebar.</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sign in with email and password</CardTitle>
          <CardDescription>
            {seeded && (
              <>
                The demo accounts all use the password <code className="text-foreground">{MOCK_PASSWORD}</code>.{" "}
              </>
            )}
            Or <Link className="text-foreground underline" href="/sign-up">sign up</Link> to start an organization of your own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              signIn(email, password);
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required placeholder={seeded ? "alice@acme.test" : undefined} value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <Button type="submit" disabled={pending}>
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
