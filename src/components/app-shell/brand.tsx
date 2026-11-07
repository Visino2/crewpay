import Link from "next/link";

import { cn } from "@/lib/utils";

/** CrewPay wordmark: two offset bars suggest a run of payments moving forward. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex size-7 items-center justify-center rounded-lg bg-primary", className)}
    >
      <span className="absolute top-[9px] left-[7px] h-1.5 w-3 rounded-full bg-primary-foreground" />
      <span className="absolute top-[15px] left-[11px] h-1.5 w-3 rounded-full bg-primary-foreground/70" />
    </span>
  );
}

export function Brand({ href = "/account" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 font-semibold tracking-tight">
      <BrandMark />
      <span className="text-[15px]">CrewPay</span>
    </Link>
  );
}
