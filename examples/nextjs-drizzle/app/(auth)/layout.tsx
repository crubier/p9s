import { IconBinaryTree } from "@tabler/icons-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2 font-medium">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
          <IconBinaryTree className="size-4" />
        </div>
        p9s example
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
