import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  href,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: LucideIcon;
  href?: string;
  emphasis?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            emphasis ? "bg-warning-soft text-warning" : "bg-accent text-accent-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
    </>
  );
  const className =
    "flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs transition-colors";
  return href ? (
    <Link href={href} className={cn(className, "hover:border-primary/30 hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/50 outline-none")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
