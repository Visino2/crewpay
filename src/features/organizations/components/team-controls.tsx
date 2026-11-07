"use client";

import { MailPlusIcon, UserMinusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { ConfirmAction } from "@/components/app/confirm-action";
import { Field, FormError, NativeSelect } from "@/components/app/form-controls";
import { formValues, useActionForm } from "@/components/app/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/format/status";
import { inviteMemberSchema } from "@/lib/validation/organizations";

import {
  acceptInvitationAction,
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from "../actions";

type Role = keyof typeof ROLE_LABELS;
const ROLES = Object.keys(ROLE_LABELS) as Role[];

export function InviteMemberForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [formKey, setFormKey] = useState(0);
  const [invited, setInvited] = useState<string | null>(null);
  const submitted = useRef<string | null>(null);
  const form = useActionForm(inviteMemberSchema, inviteMemberAction, () => {
    setInvited(submitted.current);
    setFormKey((key) => key + 1);
    router.refresh();
  });

  return (
    <form
      key={formKey}
      noValidate
      className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const values = formValues(event.currentTarget);
        submitted.current = values.email ?? null;
        setInvited(null);
        form.submit({ organizationId, email: values.email ?? "", role: values.role ?? "" });
      }}
    >
      <Field id="invite-email" label="Email" error={form.fieldErrors.email}>
        <Input id="invite-email" name="email" type="email" required maxLength={254} placeholder="colleague@company.com" aria-invalid={Boolean(form.fieldErrors.email)} />
      </Field>
      <Field id="invite-role" label="Role" error={form.fieldErrors.role}>
        <NativeSelect id="invite-role" name="role" defaultValue="preparer">
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" disabled={form.pending}>
        <MailPlusIcon aria-hidden />
        {form.pending ? "Inviting…" : "Invite"}
      </Button>
      <div className="sm:col-span-3">
        <FormError message={form.formError} />
        {invited ? (
          <p role="status" className="text-sm text-success">
            Invitation created for {invited}. They&apos;ll see it after signing in with that email.
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function MemberRoleSelect({
  organizationId,
  userId,
  role,
  name,
}: {
  organizationId: string;
  userId: string;
  role: Role;
  name: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        aria-label={`Role for ${name}`}
        defaultValue={role}
        disabled={pending}
        className="h-8"
        containerClassName="w-36"
        onChange={(event) => {
          const next = event.target.value;
          setError(null);
          startTransition(async () => {
            const result = await changeMemberRoleAction({ organizationId, userId, role: next });
            if (!result.ok) {
              setError(result.error.message);
              event.target.value = role;
              return;
            }
            router.refresh();
          });
        }}
      >
        {ROLES.map((option) => (
          <option key={option} value={option} title={ROLE_DESCRIPTIONS[option]}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </NativeSelect>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function RemoveMemberButton({ organizationId, userId, name }: { organizationId: string; userId: string; name: string }) {
  return (
    <ConfirmAction
      variant="ghost"
      size="sm"
      destructive
      label={
        <>
          <UserMinusIcon aria-hidden />
          <span className="sr-only">Remove {name}</span>
        </>
      }
      title={`Remove ${name}?`}
      description="They lose access to this organization immediately. Their past actions stay in the records."
      confirmLabel="Remove member"
      action={() => removeMemberAction({ organizationId, userId })}
    />
  );
}

export function RevokeInvitationButton({ invitationId, email }: { invitationId: string; email: string }) {
  return (
    <ConfirmAction
      variant="ghost"
      size="sm"
      label={
        <>
          <XIcon aria-hidden />
          Revoke
        </>
      }
      title={`Revoke the invitation for ${email}?`}
      description="They won't be able to join with this invitation."
      confirmLabel="Revoke invitation"
      action={() => revokeInvitationAction({ invitationId })}
    />
  );
}

export function AcceptInvitationButton({ invitationId, organizationName }: { invitationId: string; organizationName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        aria-label={`Accept invitation to ${organizationName}`}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInvitationAction({ invitationId });
            if (!result.ok) {
              setError(result.error.message);
              return;
            }
            router.push(`/orgs/${result.data}`);
          })
        }
      >
        {pending ? "Joining…" : "Accept"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
