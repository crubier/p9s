"use client";

import { IconDots, IconEye, IconHistory, IconTrash, IconUserShare, IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createTeam, deleteTeam, inviteMember, removeMember, setTeamMembership, startImpersonation } from "@/app/o/[org]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MemberRow, TeamRow } from "@/src/service";
import { useAction } from "./use-action";

export function InviteForm({ orgSlug }: { orgSlug: string }) {
  const [email, setEmail] = useState("");
  const { pending, run } = useAction();
  return (
    <form
      className="flex flex-1 gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!(await run(() => inviteMember(orgSlug, email), "Member added")).error) setEmail("");
      }}
    >
      <Input type="email" required placeholder="Email of someone who signed up" value={email} onChange={(event) => setEmail(event.target.value)} />
      <Button type="submit" disabled={pending}>Add member</Button>
    </form>
  );
}

export function MemberTable({ orgSlug, members, teams, isAdmin, currentMemberId }: {
  orgSlug: string;
  members: MemberRow[];
  teams: TeamRow[];
  isAdmin: boolean;
  currentMemberId: string;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const impersonate = async (memberId: string, mode: "view" | "act") => {
    if (!(await run(() => startImpersonation(orgSlug, memberId, mode))).error) router.push(`/o/${orgSlug}`);
  };

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
          <TableRow key={member.id}>
            <TableCell>
              <div className="font-medium">
                {member.name} {member.id === currentMemberId && <span className="text-muted-foreground font-normal">(you)</span>}
              </div>
              <div className="text-muted-foreground text-xs">{member.email}</div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {member.teamIds.map((teamId) => (
                  <Badge key={teamId} variant="outline">{teamNames.get(teamId)}</Badge>
                ))}
              </div>
            </TableCell>
            {isAdmin && (
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Manage ${member.name}`} disabled={pending}>
                      <IconDots />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {member.id !== currentMemberId && (
                      <>
                        <DropdownMenuItem onClick={() => impersonate(member.id, "view")}>
                          <IconEye /> View as {member.name}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => impersonate(member.id, "act")}>
                          <IconUserShare /> Act as {member.name}
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem asChild>
                      <Link href={`/o/${orgSlug}/audit?member=${member.id}`}>
                        <IconHistory /> Activity
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Teams</DropdownMenuLabel>
                    {teams.map((team) => {
                      const isMember = member.teamIds.includes(team.id);
                      return (
                        <DropdownMenuCheckboxItem
                          key={team.id}
                          checked={isMember}
                          onCheckedChange={(checked) => run(() => setTeamMembership(orgSlug, team.id, member.id, checked))}
                        >
                          {team.name}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={member.id === currentMemberId} onClick={() => run(() => removeMember(orgSlug, member.id), "Member removed")}>
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

export function TeamList({ orgSlug, teams, isAdmin }: { orgSlug: string; teams: TeamRow[]; isAdmin: boolean }) {
  const [name, setName] = useState("");
  const { pending, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-lg border">
        {teams.map((team) => (
          <li key={team.id} className="flex items-center gap-3 px-4 py-2">
            <IconUsers className="text-muted-foreground size-5" />
            <span className="flex-1 text-sm font-medium">{team.name}</span>
            {team.administers && <Badge>Administers the organization</Badge>}
            <span className="text-muted-foreground text-xs">{team.members} {team.members === 1 ? "member" : "members"}</span>
            {isAdmin && !team.administers && (
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${team.name}`} disabled={pending} onClick={() => run(() => deleteTeam(orgSlug, team.id), "Team deleted")}>
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
            if (!(await run(() => createTeam(orgSlug, name), "Team created")).error) setName("");
          }}
        >
          <Input required placeholder="New team" value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" variant="outline" disabled={pending}>Create team</Button>
        </form>
      )}
    </div>
  );
}
