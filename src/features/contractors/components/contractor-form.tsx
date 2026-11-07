"use client";

import { useRouter } from "next/navigation";

import { Field, FormError, NativeSelect } from "@/components/app/form-controls";
import { formValues, useActionForm } from "@/components/app/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COUNTRY_OPTIONS } from "@/lib/format/countries";
import { createContractorSchema, updateContractorSchema } from "@/lib/validation/contractors";

import { createContractorAction, updateContractorAction } from "../actions";

type Defaults = { fullName: string; email: string | null; countryCode: string };

export function ContractorForm(
  props:
    | { mode: "create"; organizationId: string }
    | { mode: "edit"; contractorId: string; defaults: Defaults; onDone: () => void },
) {
  const router = useRouter();
  const schema = props.mode === "create" ? createContractorSchema : updateContractorSchema;
  const action = props.mode === "create" ? createContractorAction : updateContractorAction;
  const form = useActionForm(schema, action, (data) => {
    if (props.mode === "create" && typeof data === "string") {
      router.push(`/orgs/${props.organizationId}/contractors/${data}`);
    } else if (props.mode === "edit") {
      props.onDone();
      router.refresh();
    }
  });
  const defaults: Defaults = props.mode === "edit" ? props.defaults : { fullName: "", email: null, countryCode: "" };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const values = formValues(event.currentTarget);
        const scope =
          props.mode === "create" ? { organizationId: props.organizationId } : { contractorId: props.contractorId };
        form.submit({
          ...scope,
          fullName: values.fullName ?? "",
          email: values.email ?? "",
          countryCode: values.countryCode ?? "",
        });
      }}
    >
      <Field id="fullName" label="Full name" error={form.fieldErrors.fullName}>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={defaults.fullName}
          autoComplete="off"
          required
          maxLength={120}
          aria-invalid={Boolean(form.fieldErrors.fullName)}
        />
      </Field>
      <Field
        id="email"
        label="Email (optional)"
        hint="Used to identify the contractor; CrewPay does not email contractors yet."
        error={form.fieldErrors.email}
      >
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={defaults.email ?? ""}
          autoComplete="off"
          maxLength={254}
          aria-invalid={Boolean(form.fieldErrors.email)}
        />
      </Field>
      <Field id="countryCode" label="Country of residence" error={form.fieldErrors.countryCode}>
        <NativeSelect
          id="countryCode"
          name="countryCode"
          defaultValue={defaults.countryCode}
          required
          aria-invalid={Boolean(form.fieldErrors.countryCode)}
        >
          <option value="" disabled>
            Select a country
          </option>
          {COUNTRY_OPTIONS.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <FormError message={form.formError} />
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={form.pending}>
          {form.pending ? "Saving…" : props.mode === "create" ? "Add contractor" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
