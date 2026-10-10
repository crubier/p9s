"use client";

import { IconSearch } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export function HeaderSearch() {
  const router = useRouter();
  const slug = usePathname().split("/")[2];
  return (
    <form
      className="relative w-40 sm:w-64"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = new FormData(event.currentTarget).get("q");
        router.push(`/o/${slug}/search?q=${encodeURIComponent(String(query ?? ""))}`);
      }}
    >
      <IconSearch className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input name="q" placeholder="Search" aria-label="Search folders and documents" className="bg-background h-8 pl-8 shadow-none" />
    </form>
  );
}
