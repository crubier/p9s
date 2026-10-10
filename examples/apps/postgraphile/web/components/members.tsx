import { IconDots, IconEye, IconHistory, IconTrash, IconUserShare, IconUsers } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction, useOrganization } from "@/lib/api";
import { CreateTeam, DeleteTeam, InviteMember, RemoveMember, SetTeamMembership } from "@/lib/operations";
import { useStartImpersonation } from "./impersonation";

export interface MemberRow {
  rowId: string;
  name: string;
  email: string;
  teamIds: string[];
}

export interface TeamRow {
  rowId: string;
  name: string;
  members: number;
  administers: boolean;
}

export function InviteForm() {
  const organization = useOrganization();
  const [email, setEmail] = useState("");
  const { pending, run } = useAction();
  return (
    <form
      className="flex flex-1 gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!(await run((send) => send(InviteMember, { orgId: organization.rowId, email }), "Member added")).error) setEmail("");
      }}
    >
      <Input type="email" required placeholder="Email of someone who signed up" value={email} onChange={(event) => setEmail(event.target.value)} />
      <Button type="submit" disabled={pending}>
        Add member
      </Button>
    </form>
  );
}

export function MemberTable({ members, teams, isAdmin }: { members: MemberRow[]; teams: TeamRow[]; isAdmin: boolean }) {
  const { slug, member: current } = useOrganization();
  const { pending, run } = useAction();
  const impersonation = useStartImpersonation();
  const teamNames = new Map(teams.map((team) => [team.rowId, team.name]));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Teams</TableHead>
          {isAdmin && <TableHead className="w-10" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.rowId}>
            <TableCell>
              <div className="font-medium">
                {member.name} {member.rowId === current.rowId && <span className="text-muted-foreground font-normal">(you)</span>}
              </div>
              <div className="text-muted-foreground text-xs">{member.email}</div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {member.teamIds.map((teamId) => (
                  <Badge key={teamId} variant="outline">
                    {teamNames.get(teamId)}
                  </Badge>
                ))}
              </div>
            </TableCell>
            {isAdmin && (
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Manage ${member.name}`} disabled={pending || impersonation.pending} />}>
                    <IconDots />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {member.rowId !== current.rowId && (
                      <>
                        <DropdownMenuItem onClick={() => impersonation.start(member.rowId, "view")}>
                          <IconEye /> View as {member.name}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => impersonation.start(member.rowId, "act")}>
                          <IconUserShare /> Act as {member.name}
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem render={<Link to={`/o/${slug}/audit?member=${member.rowId}`} />}>
                      <IconHistory /> Activity
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Teams</DropdownMenuLabel>
                      {teams.map((team) => (
                        <DropdownMenuCheckboxItem
                          key={team.rowId}
                          checked={member.teamIds.includes(team.rowId)}
                          onCheckedChange={(checked) => run((send) => send(SetTeamMembership, { teamId: team.rowId, memberId: member.rowId, isMember: checked }))}
                        >
                          {team.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={member.rowId === current.rowId}
                      onClick={() => run((send) => send(RemoveMember, { memberId: member.rowId }), "Member removed")}
                    >
                      <IconTrash /> Remove from organization
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TeamList({ teams, isAdmin }: { teams: TeamRow[]; isAdmin: boolean }) {
  const organization = useOrganization();
  const [name, setName] = useState("");
  const { pending, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-lg border">
        {teams.map((team) => (
          <li key={team.rowId} className="flex items-center gap-3 px-4 py-2">
            <IconUsers className="text-muted-foreground size-5" />
            <span className="flex-1 text-sm font-medium">{team.name}</span>
            {team.administers && <Badge>Administers the organization</Badge>}
            <span className="text-muted-foreground text-xs">
              {team.members} {team.members === 1 ? "member" : "members"}
            </span>
            {isAdmin && !team.administers && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${team.name}`}
                disabled={pending}
                onClick={() => run((send) => send(DeleteTeam, { teamId: team.rowId }), "Team deleted")}
              >
                <IconTrash />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form
          className="flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!(await run((send) => send(CreateTeam, { orgId: organization.rowId, name }), "Team created")).error) setName("");
          }}
        >
          <Input required placeholder="New team" value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" variant="outline" disabled={pending}>
            Create team
          </Button>
        </form>
      )}
    </div>
  );
}
