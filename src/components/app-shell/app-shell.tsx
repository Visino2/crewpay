import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./nav";
import { OrgSwitcher } from "./org-switcher";
import { ProviderStatus } from "./provider-status";
import { UserMenu } from "./user-menu";

type Membership = { organizationId: string; name: string; role: "admin" | "preparer" | "approver" | "viewer" };

export function AppShell({
  current,
  memberships,
  approvalsCount,
  user,
  providerConfigured,
  children,
}: {
  current: Membership;
  memberships: Membership[];
  approvalsCount: number;
  user: { name: string; email: string };
  providerConfigured: boolean;
  children: React.ReactNode;
}) {
  const switcher = <OrgSwitcher current={current} memberships={memberships} />;
  const footer = (
    <div className="flex flex-col gap-3">
      <ProviderStatus configured={providerConfigured} />
      <UserMenu name={user.name} email={user.email} />
    </div>
  );

  return (
    <div className="flex min-h-full flex-1">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 border-r bg-sidebar p-4 lg:flex">
        <div className="px-1 pt-1">
          <Brand href={`/orgs/${current.organizationId}`} />
        </div>
        {switcher}
        <SidebarNav organizationId={current.organizationId} approvalsCount={approvalsCount} />
        <div className="mt-auto">{footer}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-card/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <MobileNav
            organizationId={current.organizationId}
            approvalsCount={approvalsCount}
            header={switcher}
            footer={footer}
          />
          <Brand href={`/orgs/${current.organizationId}`} />
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
