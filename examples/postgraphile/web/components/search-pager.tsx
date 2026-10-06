import { IconChevronLeft, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { Form, Link } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Plain links and GET forms: the page reads `q` and `page` from its search params
export function SearchBox({ query, placeholder, hidden = {} }: { query?: string; placeholder: string; hidden?: Record<string, string | undefined> }) {
  return (
    <Form className="relative max-w-sm flex-1" role="search">
      <IconSearch className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input key={query} name="q" defaultValue={query} placeholder={placeholder} aria-label={placeholder} className="pl-8" />
      {Object.entries(hidden).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
    </Form>
  );
}

export function Pager({ page, pageSize, total, hasMore, href }: { page: number; pageSize: number; total?: number; hasMore?: boolean; href: (page: number) => string }) {
  const last = total === undefined ? (hasMore ? page + 1 : page) : Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1 && page <= 1) return null;
  return (
    <div className="text-muted-foreground flex items-center justify-end gap-2 text-sm">
      {total !== undefined && (
        <span className="mr-auto">
          {total === 0 ? "None" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString("en")}`}
        </span>
      )}
      <Link
        to={href(page - 1)}
        aria-label="Previous page"
        className={buttonVariants({ variant: "outline", size: "icon-sm", className: page <= 1 ? "pointer-events-none opacity-50" : "" })}
      >
        <IconChevronLeft />
      </Link>
      <span>
        Page {page}
        {total !== undefined && ` of ${last}`}
      </span>
      <Link
        to={href(page + 1)}
        aria-label="Next page"
        className={buttonVariants({ variant: "outline", size: "icon-sm", className: page >= last ? "pointer-events-none opacity-50" : "" })}
      >
        <IconChevronRight />
      </Link>
    </div>
  );
}

export const pageNumber = (value: string | null | undefined) => Math.max(1, Number.parseInt(String(value ?? "1"), 10) || 1);

export const searchHref = (base: string, params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (value === undefined || value === "" || (key === "page" && value === 1) ? [] : [[key, String(value)]])));
  return search.size ? `${base}?${search}` : base;
};
