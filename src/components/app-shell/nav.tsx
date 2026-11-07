"use client";

import {
  ClipboardCheckIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  UsersIcon,
  UserCogIcon,
  WalletCardsIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function SidebarNav({
  organizationId,
  approvalsCount,
  onNavigate,
}: {
  organizationId: string;
  approvalsCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const base = `/orgs/${organizationId}`;
  const items = [
    { href: base, label: "Overview", icon: LayoutDashboardIcon, exact: true },
    { href: `${base}/pay-runs`, label: "Pay runs", icon: WalletCardsIcon },
    { href: `${base}/approvals`, label: "Approvals", icon: ClipboardCheckIcon, count: approvalsCount },
    { href: `${base}/contractors`, label: "Contractors", icon: UsersIcon },
    { href: `${base}/history`, label: "History", icon: HistoryIcon },
    { href: `${base}/team`, label: "Team", icon: UserCogIcon },
  ];

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-secondary hover:text-sidebar-foreground",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}
              aria-hidden
            />
            <span className="flex-1">{item.label}</span>
            {item.count ? (
              <span className="min-w-5 rounded-full bg-warning-soft px-1.5 text-center text-xs font-semibold text-warning tabular-nums">
                {item.count}
                <span className="sr-only"> awaiting approval</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
