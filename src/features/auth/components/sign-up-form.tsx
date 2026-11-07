"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";

import { signUpAction, type AuthFormState } from "../actions";

const initialState: AuthFormState = { status: "idle" };

function FieldError({ messages }: { messages?: string[] }) {
  return messages?.length ? <p className="text-sm text-destructive">{messages[0]}</p> : null;
}

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  if (state.status === "success") {
    return <p role="status">{state.message}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required minLength={2} maxLength={120} aria-invalid={Boolean(fieldErrors?.fullName)} />
        <FieldError messages={fieldErrors?.fullName} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid={Boolean(fieldErrors?.email)} />
        <FieldError messages={fieldErrors?.email} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
          aria-invalid={Boolean(fieldErrors?.password)}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-sm text-muted-foreground">
          At least {PASSWORD_MIN_LENGTH} characters.
        </p>
        <FieldError messages={fieldErrors?.password} />
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
