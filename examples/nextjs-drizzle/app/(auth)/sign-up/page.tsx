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

export default function SignUp() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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
          Already have an account? <Link className="underline" href="/sign-in">Sign in</Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const { error } = await authClient.signUp.email(form);
              if (error) toast.error(error.message ?? "Could not sign up");
              else router.push("/");
            });
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
          <Button type="submit" disabled={pending}>Create account</Button>
        </form>
      </CardContent>
    </Card>
  );
}
