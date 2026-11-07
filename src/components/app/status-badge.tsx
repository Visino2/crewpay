import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/format/status";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground ring-border",
  info: "bg-info-soft text-info ring-info/20",
  warning: "bg-warning-soft text-warning ring-warning/25",
  success: "bg-success-soft text-success ring-success/20",
  danger: "bg-danger-soft text-destructive ring-destructive/20",
};

const DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-destructive",
};

export function StatusBadge({
  tone,
  children,
  className,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASSES[tone])} />
      {children}
    </span>
  );
}
