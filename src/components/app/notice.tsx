import { AlertTriangleIcon, InfoIcon, ShieldCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const VARIANTS = {
  info: { icon: InfoIcon, className: "border-info/20 bg-info-soft text-info" },
  warning: { icon: AlertTriangleIcon, className: "border-warning/25 bg-warning-soft text-warning" },
  secure: { icon: ShieldCheckIcon, className: "border-success/20 bg-success-soft text-success" },
} as const;

export function Notice({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: keyof typeof VARIANTS;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: variantClass } = VARIANTS[variant];
  return (
    <div role="note" className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", variantClass, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className="text-foreground/80">{children}</div>
      </div>
    </div>
  );
}
