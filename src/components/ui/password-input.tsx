"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cn } from "cn";

import { Input } from "./input";

type PasswordInputProps = Omit<ComponentProps<"input">, "type">;

/**
 * Password field with a show/hide toggle. Hidden by default. Only the input's
 * `type` changes, so the value, validation, autocomplete and form submission
 * are exactly those of a normal password input.
 *
 * Accessibility: a real <button type="button"> (never submits the form) with
 * a constant label and aria-pressed, so screen readers announce "Show
 * password, toggle button, pressed/not pressed". The hit area is 44×44 px for
 * touch, centred on the 32 px field.
 */
export function PasswordInput({ className, id, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        disabled={disabled}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label="Show password"
        aria-pressed={visible}
        aria-controls={id}
        className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOffIcon className="size-4" aria-hidden /> : <EyeIcon className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
