"use client";

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmAction } from "@/components/app/confirm-action";
import { Field, FormError, NativeSelect } from "@/components/app/form-controls";
import { formValues, useActionForm } from "@/components/app/use-action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { upsertPayRunItemSchema } from "@/lib/validation/pay-runs";

import { removePayRunItemAction, upsertPayRunItemAction } from "../actions";

export type PayableContractor = { id: string; name: string; payoutLabel: string; currency: string };

function AmountInput({ currency, defaultValue, invalid }: { currency: string; defaultValue?: string; invalid: boolean }) {
  return (
    <div className="relative">
      <Input
        id="amount"
        name="amount"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        defaultValue={defaultValue}
        className="h-9 pr-14 text-right tabular-nums"
        aria-invalid={invalid}
        aria-describedby="amount-currency"
      />
      <span id="amount-currency" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-muted-foreground">
        {currency}
      </span>
    </div>
  );
}

/** Adds a contractor line. The currency always comes from their payout details. */
export function AddLineForm({ payRunId, contractors }: { payRunId: string; contractors: PayableContractor[] }) {
  const router = useRouter();
  const [contractorId, setContractorId] = useState(contractors[0]?.id ?? "");
  const [formKey, setFormKey] = useState(0);
  const selected = contractors.find((contractor) => contractor.id === contractorId);
  const form = useActionForm(upsertPayRunItemSchema, upsertPayRunItemAction, () => {
    setFormKey((key) => key + 1);
    setContractorId("");
    router.refresh();
  });

  if (contractors.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Every active contractor with payout details is already in this pay run.
      </p>
    );
  }

  return (
    <form
      key={formKey}
      noValidate
      className="grid gap-4 rounded-lg border bg-secondary/30 p-4 md:grid-cols-[minmax(0,2fr)_minmax(11rem,1.2fr)_minmax(0,1.6fr)_auto] md:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (!contractorId) {
          form.setFieldErrors({ contractorId: "Choose a contractor" });
          return;
        }
        const values = formValues(event.currentTarget);
        form.submit({ payRunId, contractorId, amount: values.amount ?? "", memo: values.memo ?? "" });
      }}
    >
      <Field id="contractor" label="Contractor" error={form.fieldErrors.contractorId}>
        <NativeSelect id="contractor" value={contractorId} onChange={(event) => setContractorId(event.target.value)}>
          <option value="" disabled>
            Select a contractor
          </option>
          {contractors.map((contractor) => (
            <option key={contractor.id} value={contractor.id}>
              {contractor.name} · {contractor.payoutLabel}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="amount" label="Amount they receive" error={form.fieldErrors.amount}>
        <AmountInput currency={selected?.currency ?? "—"} invalid={Boolean(form.fieldErrors.amount)} />
      </Field>
      <Field id="memo" label="Reference (optional)" error={form.fieldErrors.memo}>
        <Input id="memo" name="memo" maxLength={140} placeholder="e.g. Invoice INV-104" className="h-9" />
      </Field>
      {/* Offset by the label height so the button lines up with the inputs. */}
      <Button type="submit" disabled={form.pending} className="h-9 md:mt-[1.375rem]">
        <PlusIcon aria-hidden />
        {form.pending ? "Adding…" : "Add line"}
      </Button>
      <div className="md:col-span-4">
        <FormError message={form.formError} />
      </div>
    </form>
  );
}

export function EditLineButton({
  payRunId,
  contractorId,
  contractorName,
  currency,
  amount,
  memo,
  stale,
}: {
  payRunId: string;
  contractorId: string;
  contractorName: string;
  currency: string;
  amount: string;
  memo: string | null;
  stale: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useActionForm(upsertPayRunItemSchema, upsertPayRunItemAction, () => {
    setOpen(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={stale ? "default" : "ghost"} size="sm" aria-label={`Edit line for ${contractorName}`} />}>
        <PencilIcon aria-hidden />
        {stale ? "Update" : <span className="sr-only md:not-sr-only">Edit</span>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{contractorName}</DialogTitle>
          <DialogDescription>
            {stale
              ? "Their payout details changed. Saving moves this line onto the current payout details."
              : "Change the amount or reference for this line."}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const values = formValues(event.currentTarget);
            form.submit({ payRunId, contractorId, amount: values.amount ?? "", memo: values.memo ?? "" });
          }}
        >
          <Field id="amount" label="Amount they receive" error={form.fieldErrors.amount}>
            <AmountInput currency={currency} defaultValue={amount} invalid={Boolean(form.fieldErrors.amount)} />
          </Field>
          <Field id="memo" label="Reference (optional)" error={form.fieldErrors.memo}>
            <Input id="memo" name="memo" maxLength={140} defaultValue={memo ?? ""} />
          </Field>
          <FormError message={form.formError} />
          <div className="flex justify-end">
            <Button type="submit" disabled={form.pending}>
              {form.pending ? "Saving…" : "Save line"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveLineButton({ itemId, contractorName }: { itemId: string; contractorName: string }) {
  return (
    <ConfirmAction
      variant="ghost"
      size="sm"
      destructive
      label={
        <>
          <Trash2Icon aria-hidden />
          <span className="sr-only">Remove line for {contractorName}</span>
        </>
      }
      title={`Remove ${contractorName} from this pay run?`}
      description="The line is deleted from the draft. This is recorded in the audit log."
      confirmLabel="Remove line"
      action={() => removePayRunItemAction({ itemId })}
    />
  );
}
