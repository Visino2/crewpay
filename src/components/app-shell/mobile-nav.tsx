"use client";

import { MenuIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { SidebarNav } from "./nav";

export function MobileNav({
  organizationId,
  approvalsCount,
  header,
  footer,
}: {
  organizationId: string;
  approvalsCount: number;
  header: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
        <MenuIcon className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col gap-6 p-4">
        <SheetHeader className="p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {header}
        </SheetHeader>
        <SidebarNav organizationId={organizationId} approvalsCount={approvalsCount} onNavigate={() => setOpen(false)} />
        <div className="mt-auto">{footer}</div>
      </SheetContent>
    </Sheet>
  );
}
