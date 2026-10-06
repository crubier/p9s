import { IconEye, IconUserShare } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useAction, useOrganization } from "@/lib/api";
import { clearImpersonation, setImpersonation, type ImpersonationMode } from "@/lib/impersonation";
import { StartImpersonation, StopImpersonation } from "@/lib/operations";

// The admin records it as themselves, then the cookie makes the next requests act as the member
export function useStartImpersonation() {
  const navigate = useNavigate();
  const organization = useOrganization();
  const { pending, run } = useAction();
  const start = async (memberId: string, mode: ImpersonationMode) => {
    const result = await run(async (send) => {
      await send(StartImpersonation, { memberId, mode });
      setImpersonation(organization.rowId, memberId, mode);
    });
    if (!result.error) navigate(`/o/${organization.slug}`);
  };
  return { pending, start };
}

export function ViewAsButton({ memberId, name }: { memberId: string; name: string }) {
  const { pending, start } = useStartImpersonation();
  return (
    <Button variant="ghost" size="icon-sm" aria-label={`View as ${name}`} title={`View as ${name}`} disabled={pending} onClick={() => start(memberId, "view")}>
      <IconEye />
    </Button>
  );
}

export function ImpersonationBanner() {
  const navigate = useNavigate();
  const { slug, member, impersonation } = useOrganization();
  const { pending, run } = useAction();
  if (!impersonation) return null;
  const { readOnly, adminName } = impersonation;
  const Icon = readOnly ? IconEye : IconUserShare;
  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm md:mt-2 md:rounded-lg ${readOnly ? "bg-sky-100 text-sky-950" : "bg-amber-100 text-amber-950"}`}>
      <Icon className="size-4 shrink-0" />
      <p className="flex-1">
        {readOnly ? (
          <>
            <strong>Viewing as {member.name}</strong>: RLS shows exactly what they see. The transactions are read only, Postgres refuses any change.
          </>
        ) : (
          <>
            <strong>Acting as {member.name}</strong>, with their permissions. What you change is in the audit log as done by {member.name}, as {adminName}.
          </>
        )}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="bg-transparent"
        disabled={pending}
        onClick={async () => {
          // Back to the admin first, who records the end
          clearImpersonation();
          await run((send) => send(StopImpersonation, { memberId: member.rowId, mode: readOnly ? "view" : "act" }));
          navigate(`/o/${slug}/members`);
        }}
      >
        Stop
      </Button>
    </div>
  );
}
