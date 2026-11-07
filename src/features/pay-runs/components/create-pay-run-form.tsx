"use client";

import { useRouter } from "next/navigation";

import { Field, FormError, NativeSelect } from "@/components/app/form-controls";
import { formValues, useActionForm } from "@/components/app/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPayRunSchema } from "@/lib/validation/pay-runs";

import { createPayRunAction } from "../actions";

/** Wallet currencies a business can fund payouts from (Blaaiz docs: USD, CAD, GBP, EUR, NGN). */
const FUNDING_CURRENCIES = ["USD", "CAD", "GBP", "EUR", "NGN"] as const;

export function CreatePayRunForm({ organizationId, defaultMonth }: { organizationId: string; defaultMonth: string }) {
  const router = useRouter();
  const form = useActionForm(createPayRunSchema, createPayRunAction, (payRunId) => {
    router.push(`/orgs/${organizationId}/pay-runs/${payRunId}`);
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const values = formValues(event.currentTarget);
        form.submit({
          organizationId,
          title: values.title ?? "",
          periodMonth: values.periodMonth ?? "",
          fundingCurrency: values.fundingCurrency ?? "",
        });
      }}
    >
      <Field id="title" label="Title" error={form.fieldErrors.title}>
        <Input
          id="title"
          name="title"
          required
          minLength={2}
          maxLength={120}
          placeholder="e.g. November contractors"
          aria-invalid={Boolean(form.fieldErrors.title)}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="periodMonth" label="Pay period" error={form.fieldErrors.periodMonth}>
          <Input
            id="periodMonth"
            name="periodMonth"
            type="month"
            defaultValue={defaultMonth}
            required
            aria-invalid={Boolean(form.fieldErrors.periodMonth)}
          />
        </Field>
        <Field
          id="fundingCurrency"
          label="Funding currency"
          hint="The wallet you plan to pay from. CrewPay does not convert currencies."
          error={form.fieldErrors.fundingCurrency}
        >
          <NativeSelect id="fundingCurrency" name="fundingCurrency" defaultValue="USD">
            {FUNDING_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <FormError message={form.formError} />
      <div className="flex justify-end">
        <Button type="submit" disabled={form.pending}>
          {form.pending ? "Creating…" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
