import { SearchXIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { LinkButton } from "@/components/app/link-button";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchXIcon}
      title="Not found"
      description="This record doesn't exist, or you don't have access to it."
      action={<LinkButton href="/account">Go to your organizations</LinkButton>}
    />
  );
}
