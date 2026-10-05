"use client";

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

// The people created by `bun run db:seed`
const DEMO = [
  { email: "alice@acme.test", who: "Admin of Acme" },
  { email: "bob@acme.test", who: "Engineering" },
  { email: "carol@acme.test", who: "Design" },
  { email: "dave@acme.test", who: "In no team" },
  { email: "erin@acme.test", who: "Contractor, one shared folder" },
];
const DEMO_PASSWORD = "password1234";

export interface MockExample {
  name: string;
  first: number;
  last: number;
  accounts: { email: string; who: string }[];
}

export function SignInForm({ mockUsers, mockExamples }: { mockUsers: number; mockExamples: MockExample[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [number, setNumber] = useState("");

  const signIn = (email: string, password: string) =>
    startTransition(async () => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) toast.error(error.message ?? "Could not sign in");
      else router.push("/");
    });

  const account = (person: { email: string; who: string }, password: string) => (
    <Button key={person.email} variant="ghost" className="justify-between" disabled={pending} onClick={() => signIn(person.email, password)}>
      <span>{person.email}</span>
      <span className="text-muted-foreground text-xs">{person.who}</span>
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            No account? <Link className="underline" href="/sign-up">Sign up</Link>
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
              <Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <Button type="submit" disabled={pending}>Sign in</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Demo accounts</CardTitle>
          <CardDescription>After <code>bun run db:seed</code>, sign in as someone with other permissions</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">{DEMO.map((person) => account(person, DEMO_PASSWORD))}</CardContent>
      </Card>
      {mockUsers > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{mockUsers.toLocaleString("en")} mock users</CardTitle>
            <CardDescription>
              {mockEmail(1)} to {mockEmail(mockUsers)}, all with the password <code>{MOCK_PASSWORD}</code>. Their number tells what they are, see
              src/mock/people.ts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                signIn(mockEmail(Number(number)), MOCK_PASSWORD);
              }}
            >
              <Input type="number" min={1} max={mockUsers} required placeholder="User number, like 42" aria-label="User number" value={number} onChange={(event) => setNumber(event.target.value)} />
              <Button type="submit" variant="outline" disabled={pending}>Sign in</Button>
            </form>
            {mockExamples.map((org) => (
              <div key={org.name} className="flex flex-col gap-1">
                <div className="text-muted-foreground px-4 text-xs">
                  {org.name}: users {org.first} to {org.last}
                </div>
                {org.accounts.map((person) => account(person, MOCK_PASSWORD))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
