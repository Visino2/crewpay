import { ArrowRightIcon, Building2Icon, LogOutIcon, MailIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/app-shell/brand";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutAction } from "@/features/auth/actions";
import { CreateOrganizationForm } from "@/features/organizations/components/create-organization-form";
import { AcceptInvitationButton } from "@/features/organizations/components/team-controls";
import { listMyInvitations, listMyMemberships } from "@/features/organizations/data";
import { requireAuthContext } from "@/lib/auth/session";
import { formatDate } from "@/lib/format/dates";
import { ROLE_LABELS } from "@/lib/format/status";

export const metadata: Metadata = { title: "Your organizations" };

export default async function AccountPage() {
  // Verified on the server for every request; the proxy redirect is only a convenience.
  const { db, user } = await requireAuthContext();
  const [memberships, invitations] = await Promise.all([listMyMemberships(db, user.id), listMyInvitations(db)]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Brand href="/account" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOutIcon aria-hidden />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Your organizations</h1>
          <p className="text-sm text-muted-foreground">Choose a workspace, accept an invitation, or create a new organization.</p>
        </div>

        {invitations.length > 0 ? (
          <Card className="border-info/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MailIcon className="size-4 text-info" aria-hidden />
                Invitations
              </CardTitle>
              <CardDescription>Sent to {user.email}.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-lg border">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{invitation.organization_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {ROLE_LABELS[invitation.role]} · invited by {invitation.invited_by_name} · expires {formatDate(invitation.expires_at)}
                      </span>
                    </div>
                    <AcceptInvitationButton invitationId={invitation.id} organizationName={invitation.organization_name} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {memberships.length === 0 ? (
          <EmptyState
            icon={Building2Icon}
            title="You're not in an organization yet"
            description="Create one below, or ask an admin to invite you with this email address."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {memberships.map((membership) => (
              <li key={membership.organizationId}>
                <Link
                  href={`/orgs/${membership.organizationId}`}
                  className="group flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/30 hover:bg-accent/30"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground">
                    {membership.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{membership.name}</span>
                    <span className="text-xs text-muted-foreground">{ROLE_LABELS[membership.role]}</span>
                  </span>
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Create an organization</CardTitle>
            <CardDescription>You&apos;ll be its first admin. Invite a second person so pay runs can be approved independently.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrganizationForm />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
