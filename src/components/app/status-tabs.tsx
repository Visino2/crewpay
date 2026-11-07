import Link from "next/link";

import { cn } from "@/lib/utils";

export function StatusTabs({
  tabs,
  active,
  label,
}: {
  tabs: { value: string; label: string; href: string; count?: number }[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => {
        const current = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              current ? "bg-card text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums text-muted-foreground">{tab.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
