import type { Metadata } from "next";

import { Notice } from "@/components/app/notice";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  InviteMemberForm,
  MemberRoleSelect,
  RemoveMemberButton,
  RevokeInvitationButton,
} from "@/features/organizations/components/team-controls";
import { getOrgContext } from "@/features/organizations/context";
import { listMembers, listPendingInvitations } from "@/features/organizations/data";
import { formatDate } from "@/lib/format/dates";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/format/status";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: PageProps<"/orgs/[organizationId]/team">) {
  const { organizationId } = await params;
  const context = await getOrgContext(organizationId);
  const isAdmin = context.can("manageMembers");
  const [members, invitations] = await Promise.all([
    listMembers(context.db, organizationId),
    isAdmin ? listPendingInvitations(context.db, organizationId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Who can see and act on this organization's pay runs. Whoever prepares a pay run can't approve it."
      />

      <section aria-label="Roles" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).map((role) => (
          <div key={role} className="rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">{ROLE_LABELS[role]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {isAdmin ? "Change roles or remove members. An organization always keeps at least one admin." : "Only admins can change the team."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                  <TableHead className="pl-4">Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  {isAdmin ? <TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const name = member.fullName ?? member.email;
                  const isMe = member.userId === context.user.id;
                  return (
                    <TableRow key={member.userId}>
                      <TableCell className="pl-4">
                        <span className="flex items-center gap-2 font-medium">
                          {name}
                          {isMe ? <StatusBadge tone="info">You</StatusBadge> : null}
                        </span>
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                      </TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <MemberRoleSelect organizationId={organizationId} userId={member.userId} role={member.role} name={name} />
                        ) : (
                          ROLE_LABELS[member.role]
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(member.joinedAt)}</TableCell>
                      {isAdmin ? (
                        <TableCell className="pr-4 text-right">
                          <RemoveMemberButton organizationId={organizationId} userId={member.userId} name={name} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              They join after signing in with this exact email address and confirming it. CrewPay doesn&apos;t send
              invitation emails yet, so let them know.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <InviteMemberForm organizationId={organizationId} />
            {invitations.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Pending invitations</p>
                <ul className="divide-y rounded-lg border">
                  {invitations.map((invitation) => (
                    <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
                      <span className="text-muted-foreground">{ROLE_LABELS[invitation.role]}</span>
                      <span className="text-xs text-muted-foreground">expires {formatDate(invitation.expires_at)}</span>
                      <RevokeInvitationButton invitationId={invitation.id} email={invitation.email} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Notice variant="info">Ask an admin if you need a different role.</Notice>
      )}
    </div>
  );
}
