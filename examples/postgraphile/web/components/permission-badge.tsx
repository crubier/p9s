import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ACCESS_LEVELS, capabilities, levelOf, type Flags } from "@/lib/permissions";

// The access a member has, with its bitmap on hover
export function PermissionBadge({ permission }: { permission: Flags | null }) {
  const level = levelOf(permission);
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant={level === "manager" ? "default" : "secondary"} className="cursor-default" />}>
        {level ? ACCESS_LEVELS[level].label : "No access"}
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-mono">{permission?.bitmap ?? "null"}</div>
        <div>{capabilities(permission).join(", ") || "nothing"}</div>
      </TooltipContent>
    </Tooltip>
  );
}
