"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/o/[org]/actions";

// Runs a server action, and shows its error, or a success message, in a toast
export function useAction() {
  const [pending, startTransition] = useTransition();
  const run = <T,>(action: () => Promise<ActionResult<T>>, success?: string) =>
    new Promise<ActionResult<T>>((resolve) =>
      startTransition(async () => {
        const result = await action();
        if (result.error !== undefined) toast.error(result.error);
        else if (success) toast.success(success);
        resolve(result);
      }),
    );
  return { pending, run };
}
