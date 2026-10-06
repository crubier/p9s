import { IconArrowRight, IconBinaryTree, IconBrandGraphql, IconLoader2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { clearImpersonation } from "@/lib/impersonation";
import { SignInQuery } from "@/lib/operations";
import { MOCK_PASSWORD, mockEmail, mockExamples } from "../../src/mock/people";

export function AuthLayout() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2 font-medium">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
          <IconBinaryTree className="size-4" />
        </div>
        p9s example, PostGraphile
      </div>
      <div className="w-full max-w-md">
        <Outlet />
      </div>
      <a href="/graphiql" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
        <IconBrandGraphql className="size-4 text-pink-600" /> Explore the API in GraphiQL
      </a>
    </div>
  );
}

// Signing in as someone else starts afresh: nothing cached is theirs
function useSignedIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return () => {
    clearImpersonation();
    queryClient.clear();
    navigate("/");
  };
}

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

export function SignIn() {
  const signedIn = useSignedIn();
  const demo = useApi(SignInQuery, {});
  const [pending, setPending] = useState(false);
  const [signingIn, setSigningIn] = useState<string>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [number, setNumber] = useState("");
  const acme = demo.data?.demoAccounts?.acme ?? false;
  const mockUsers = demo.data?.demoAccounts?.mockUsers ?? 0;
  const examples = mockUsers ? mockExamples(mockUsers) : [];

  const signIn = async (email: string, password: string) => {
    setSigningIn(email);
    setPending(true);
    const { error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) {
      toast.error(error.message ?? "Could not sign in");
      setSigningIn(undefined);
    } else signedIn();
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
  const largest = examples.reduce<(typeof examples)[number] | undefined>((max, org) => (max && max.documents >= org.documents ? max : org), undefined);
  const about = (n: number) => Number(n.toPrecision(2)).toLocaleString("en");
  const both = examples.length > 1 && examples[1]!.first <= examples[0]!.last;
  // The largest organization first: it has the most to explore
  const mockOrganization = (org: (typeof examples)[number]) =>
    organization(org.name, `${(org.last - org.first + 1).toLocaleString("en")} people, about ${about(org.documents)} documents`, org.accounts);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Explore the demo</CardTitle>
          <CardDescription className="flex flex-col gap-2">
            <span>
              A team workspace, like Notion, whose permissions are enforced by Postgres with p9s. The app only talks to a GraphQL API that PostGraphile
              generates from the schema: every query only returns what the person signed in may see.
            </span>
            {seeded && (
              <span className="text-foreground">
                No account needed. Pick someone below to sign in as them, then come back and pick someone else to compare what they see.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {demo.isPending && <div className="bg-muted h-24 animate-pulse rounded-md" />}
          {!demo.isPending && !seeded && (
            <p className="text-muted-foreground text-sm">
              There are no demo accounts yet. Run <code>bun run db:seed</code> to create them, or sign up below.
            </p>
          )}
          {largest && mockOrganization(largest)}
          {acme && organization("Acme", "5 people, small and easy to follow", ACME)}
          {examples.filter((org) => org !== largest).map(mockOrganization)}
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
                {both && ` Users ${examples[1]!.first} to ${examples[0]!.last} are in both ${examples[0]!.name} and ${examples[1]!.name}.`}
              </p>
            </div>
          )}
          {seeded && (
            <div className="bg-muted/60 flex flex-col gap-1.5 rounded-md p-3 text-xs">
              <span className="font-medium">Things to try</span>
              <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4">
                {largest && (
                  <li>
                    {acme && "Acme only has a handful of documents. "}To browse a large workspace, sign in to {largest.name}, which has about{" "}
                    {about(largest.documents)} documents.
                  </li>
                )}
                <li>Every page has a GraphQL button: it opens the query of the page in GraphiQL, signed in as you.</li>
                <li>Sign in as an admin, open Members, and use View as on someone to see the workspace through their eyes.</li>
                <li>Open Share on a folder or a document to see who has access, and which folder it comes from.</li>
                <li>As an admin, the Audit log shows who changed what, including while acting as someone else.</li>
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
            Or{" "}
            <Link className="text-foreground underline" to="/sign-up">
              sign up
            </Link>{" "}
            to start an organization of your own.
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

export function SignUp() {
  const signedIn = useSignedIn();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const field = (key: keyof typeof form) => ({
    id: key,
    required: true,
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign up</CardTitle>
        <CardDescription>
          Already have an account?{" "}
          <Link className="underline" to="/sign-in">
            Sign in
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const { error } = await authClient.signUp.email(form);
            setPending(false);
            if (error) toast.error(error.message ?? "Could not sign up");
            else signedIn();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input {...field("name")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input type="email" {...field("email")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input type="password" minLength={8} {...field("password")} />
          </div>
          <Button type="submit" disabled={pending}>
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
