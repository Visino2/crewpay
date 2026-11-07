"use client";

import { useRouter } from "next/navigation";

import { Field, FormError } from "@/components/app/form-controls";
import { formValues, useActionForm } from "@/components/app/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOrganizationSchema } from "@/lib/validation/organizations";

import { createOrganizationAction } from "../actions";

export function CreateOrganizationForm() {
  const router = useRouter();
  const form = useActionForm(createOrganizationSchema, createOrganizationAction, (organizationId) => {
    router.push(`/orgs/${organizationId}`);
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit({ name: formValues(event.currentTarget).name ?? "" });
      }}
    >
      <Field id="organization-name" label="Organization name" error={form.fieldErrors.name} className="flex-1">
        <Input
          id="organization-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="e.g. Northwind Studio"
          aria-invalid={Boolean(form.fieldErrors.name)}
        />
      </Field>
      <Button type="submit" disabled={form.pending}>
        {form.pending ? "Creating…" : "Create organization"}
      </Button>
      <FormError message={form.formError} />
    </form>
  );
}
