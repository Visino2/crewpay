"use client";

import { LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormError, NativeSelect } from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPayoutMethodSchema } from "@/lib/validation/contractors";

import { setPayoutMethodAction } from "../actions";
import { PAYOUT_OPTIONS } from "../payout-options";

/**
 * Collects new payout details. Existing details are never loaded into the
 * browser: saving always creates a new immutable version.
 */
export function PayoutMethodForm({
  contractorId,
  hasExisting,
  onDone,
}: {
  contractorId: string;
  hasExisting: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [optionId, setOptionId] = useState(PAYOUT_OPTIONS[0]!.id);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const option = PAYOUT_OPTIONS.find((candidate) => candidate.id === optionId)!;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const data = new FormData(event.currentTarget);
    const details = Object.fromEntries(option.fields.map((field) => [field.key, String(data.get(field.key) ?? "")]));
    const input = {
      contractorId,
      payoutMethod: { rail: option.rail, currency: option.currency, details },
    };

    const parsed = setPayoutMethodSchema.safeParse(input);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.at(-1);
        if (typeof key === "string" && option.fields.some((field) => field.key === key) && !errors[key]) {
          errors[key] = issue.message;
        }
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFormError("Check the payout details and try again.");
      }
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await setPayoutMethodAction(input);
      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <form noValidate autoComplete="off" onSubmit={onSubmit} className="flex flex-col gap-5">
      {hasExisting ? (
        <Notice variant="warning" title="This replaces the current payout details">
          Any pay run awaiting approval or approved for this contractor returns to draft so it can be checked again.
        </Notice>
      ) : null}
      <Field id="payout-option" label="Payout method">
        <NativeSelect
          id="payout-option"
          value={optionId}
          onChange={(event) => {
            setOptionId(event.target.value);
            setFieldErrors({});
          }}
        >
          {PAYOUT_OPTIONS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <div key={option.id} className="grid gap-4 sm:grid-cols-2">
        {option.fields.map((field) => (
          <Field
            key={field.key}
            id={`payout-${field.key}`}
            label={field.label}
            hint={field.hint}
            error={fieldErrors[field.key]}
            className={field.options ? undefined : field.key === "street" ? "sm:col-span-2" : undefined}
          >
            {field.options ? (
              <NativeSelect id={`payout-${field.key}`} name={field.key} defaultValue={field.options[0]?.value}>
                {field.options.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id={`payout-${field.key}`}
                name={field.key}
                inputMode={field.inputMode}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                maxLength={140}
                aria-invalid={Boolean(fieldErrors[field.key])}
              />
            )}
          </Field>
        ))}
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Account details are sent to the server once and never shown again. CrewPay displays only a masked label, such as
        the last four digits.
      </p>
      <FormError message={formError} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save payout details"}
        </Button>
      </div>
    </form>
  );
}
