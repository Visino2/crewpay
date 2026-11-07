import { SearchXIcon } from "lucide-react";

import { Brand } from "@/components/app-shell/brand";
import { EmptyState } from "@/components/app/empty-state";
import { LinkButton } from "@/components/app/link-button";

/**
 * Shown for unknown URLs and for organizations or records the user can't
 * access. Both look the same on purpose, so other tenants' IDs reveal nothing.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8 px-4 py-16">
      <Brand href="/account" />
      <EmptyState
        icon={SearchXIcon}
        title="Not found"
        description="This page doesn't exist, or you don't have access to it."
        action={<LinkButton href="/account">Go to your organizations</LinkButton>}
      />
    </main>
  );
}
