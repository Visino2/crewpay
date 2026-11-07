"use client";

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/format/status";

type Membership = { organizationId: string; name: string; role: keyof typeof ROLE_LABELS };

export function OrgSwitcher({ current, memberships }: { current: Membership; memberships: Membership[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-colors outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Organization: ${current.name}. Switch organization`}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">
          {current.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{current.name}</span>
          <span className="text-xs text-muted-foreground">{ROLE_LABELS[current.role]}</span>
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {memberships.map((membership) => (
            <DropdownMenuItem
              key={membership.organizationId}
              render={<Link href={`/orgs/${membership.organizationId}`} />}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{membership.name}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABELS[membership.role]}</span>
              </span>
              {membership.organizationId === current.organizationId ? (
                <CheckIcon className="size-4 text-primary" aria-label="Current" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/account" />}>
          <PlusIcon className="size-4" aria-hidden />
          Create or join an organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
