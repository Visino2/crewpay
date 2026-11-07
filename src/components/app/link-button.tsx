import type { VariantProps } from "class-variance-authority";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LinkButtonProps = VariantProps<typeof buttonVariants> & {
  href: string;
  className?: string;
  children: React.ReactNode;
  /** Plain anchor with the download attribute, for file exports. */
  download?: boolean;
};

/**
 * A real link styled as a button. Navigation stays a link for assistive tech
 * (rendering Base UI's Button as an anchor would announce it as a button).
 */
export function LinkButton({ href, className, children, variant, size, download = false }: LinkButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (download) {
    return (
      <a href={href} download className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
