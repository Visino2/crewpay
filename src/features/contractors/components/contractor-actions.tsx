"use client";

import { ArchiveIcon, CreditCardIcon, PencilIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmAction } from "@/components/app/confirm-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { archiveContractorAction } from "../actions";
import { ContractorForm } from "./contractor-form";
import { PayoutMethodForm } from "./payout-method-form";

export function EditContractorButton({
  contractorId,
  defaults,
}: {
  contractorId: string;
  defaults: { fullName: string; email: string | null; countryCode: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <PencilIcon aria-hidden />
        Edit details
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit contractor</DialogTitle>
          <DialogDescription>
            Changing details returns pay runs awaiting approval or approved for this contractor to draft.
          </DialogDescription>
        </DialogHeader>
        <ContractorForm mode="edit" contractorId={contractorId} defaults={defaults} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function SetPayoutMethodButton({ contractorId, hasExisting }: { contractorId: string; hasExisting: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={hasExisting ? "outline" : "default"} />}>
        <CreditCardIcon aria-hidden />
        {hasExisting ? "Replace payout details" : "Add payout details"}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{hasExisting ? "Replace payout details" : "Add payout details"}</DialogTitle>
          <DialogDescription>Where this contractor should be paid. Saved as a new version; old versions stay on record.</DialogDescription>
        </DialogHeader>
        <PayoutMethodForm contractorId={contractorId} hasExisting={hasExisting} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveContractorButton({ contractorId, name }: { contractorId: string; name: string }) {
  return (
    <ConfirmAction
      variant="ghost"
      destructive
      label={
        <>
          <ArchiveIcon aria-hidden />
          Archive
        </>
      }
      title={`Archive ${name}?`}
      description="Archived contractors can't be added to new pay runs. Their payment history is kept. Contractors in a pay run awaiting approval or approved can't be archived."
      confirmLabel="Archive contractor"
      action={() => archiveContractorAction({ contractorId })}
    />
  );
}
