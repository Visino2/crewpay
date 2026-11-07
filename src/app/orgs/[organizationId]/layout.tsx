import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell/app-shell";
import { getOrgContext } from "@/features/organizations/context";
import { getPeople, listMyMemberships } from "@/features/organizations/data";
import { countPayRuns } from "@/features/pay-runs/data";
import { getBlaaizConfig } from "@/services/blaaiz/config";

export const metadata: Metadata = { title: "Workspace" };

function isProviderConfigured(): boolean {
  try {
    return getBlaaizConfig() !== null;
  } catch {
    // Partial configuration counts as not connected.
    return false;
  }
}

export default async function OrganizationLayout({ children, params }: LayoutProps<"/orgs/[organizationId]">) {
  const { organizationId } = await params;
  const context = await getOrgContext(organizationId);

  const [memberships, people, approvalsCount] = await Promise.all([
    listMyMemberships(context.db, context.user.id),
    getPeople(context.db, [context.user.id]),
    countPayRuns(context.db, organizationId, "pending_approval"),
  ]);
  const me = people.get(context.user.id);

  return (
    <AppShell
      current={{ organizationId, name: context.organization.name, role: context.role }}
      memberships={memberships}
      approvalsCount={approvalsCount}
      user={{ name: me?.name ?? context.user.email ?? "Signed in", email: context.user.email ?? "" }}
      providerConfigured={isProviderConfigured()}
    >
      {children}
    </AppShell>
  );
}
