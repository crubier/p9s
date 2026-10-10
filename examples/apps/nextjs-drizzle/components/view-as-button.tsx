"use client";

import { IconEye } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { startImpersonation } from "@/app/o/[org]/actions";
import { Button } from "@/components/ui/button";
import { useAction } from "./use-action";

export function ViewAsButton({ orgSlug, memberId, name }: { orgSlug: string; memberId: string; name: string }) {
  const router = useRouter();
  const { pending, run } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`View as ${name}`}
      title={`View as ${name}`}
      disabled={pending}
      onClick={async () => {
        if (!(await run(() => startImpersonation(orgSlug, memberId, "view"))).error) router.push(`/o/${orgSlug}`);
      }}
    >
      <IconEye />
    </Button>
  );
}
