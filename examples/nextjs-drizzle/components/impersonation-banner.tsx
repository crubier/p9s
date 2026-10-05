"use client";

import { IconEye, IconUserShare } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { stopImpersonation } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { useAction } from "./use-action";

export function ImpersonationBanner({ orgSlug, name, impersonator, readOnly }: { orgSlug: string; name: string; impersonator: string; readOnly: boolean }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const Icon = readOnly ? IconEye : IconUserShare;
  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm ${readOnly ? "bg-sky-100 text-sky-950" : "bg-amber-100 text-amber-950"}`}>
      <Icon className="size-4 shrink-0" />
      <p className="flex-1">
        {readOnly ? (
          <>
            <strong>Viewing as {name}</strong>: RLS shows exactly what they see. The transactions are read only, Postgres refuses any change.
          </>
        ) : (
          <>
            <strong>Acting as {name}</strong>, with their permissions. What you change is in the audit log as done by {name}, as {impersonator}.
          </>
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="bg-transparent"
        disabled={pending}
        onClick={async () => {
          await run(() => stopImpersonation(orgSlug));
          router.push(`/o/${orgSlug}/members`);
        }}
      >
        Stop
      </Button>
    </div>
  );
}
