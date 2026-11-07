"use client";

import { CheckIcon, SendIcon, Undo2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConfirmAction } from "@/components/app/confirm-action";
import { Field } from "@/components/app/form-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import {
  approvePayRunAction,
  cancelPayRunAction,
  rejectPayRunAction,
  reopenPayRunAction,
  submitPayRunAction,
  withdrawPayRunAction,
} from "../actions";

export function SubmitPayRunButton({ organizationId, payRunId, disabled }: { organizationId: string; payRunId: string; disabled: boolean }) {
  return (
    <ConfirmAction
      disabled={disabled}
      label={
        <>
          <SendIcon aria-hidden />
          Submit for approval
        </>
      }
      title="Submit this pay run for approval?"
      description="The pay run is frozen exactly as shown and recorded with a fingerprint. To change anything afterwards you must withdraw it, which invalidates this submission."
      confirmLabel="Submit for approval"
      onSuccessHref={`/orgs/${organizationId}/pay-runs/${payRunId}`}
      action={() => submitPayRunAction({ payRunId })}
    />
  );
}

export function WithdrawPayRunButton({ payRunId }: { payRunId: string }) {
  return (
    <ConfirmAction
      variant="outline"
      label={
        <>
          <Undo2Icon aria-hidden />
          Withdraw to draft
        </>
      }
      title="Withdraw this pay run?"
      description="It returns to draft so you can edit it. The current submission is superseded and can no longer be approved."
      confirmLabel="Withdraw"
      action={() => withdrawPayRunAction({ payRunId })}
    />
  );
}

export function ReopenPayRunButton({ payRunId }: { payRunId: string }) {
  return (
    <ConfirmAction
      label={
        <>
          <Undo2Icon aria-hidden />
          Reopen as draft
        </>
      }
      title="Reopen this pay run?"
      description="It returns to draft so you can address the rejection and submit again."
      confirmLabel="Reopen"
      action={() => reopenPayRunAction({ payRunId })}
    />
  );
}

export function CancelPayRunButton({ organizationId, payRunId }: { organizationId: string; payRunId: string }) {
  return (
    <ConfirmAction
      variant="ghost"
      destructive
      label="Cancel pay run"
      title="Cancel this pay run?"
      description="Cancelled pay runs can't be edited or submitted. They stay in your history."
      confirmLabel="Cancel pay run"
      onSuccessHref={`/orgs/${organizationId}/pay-runs`}
      action={() => cancelPayRunAction({ payRunId })}
    />
  );
}

type Decision = { payRunId: string; submissionId: string; snapshotHash: string };

/**
 * Sends back the exact submission and snapshot fingerprint the approver was
 * shown. The database rejects the decision if the run changed since, or if
 * this user prepared it.
 */
export function ApprovePayRunButton({ decision, summary }: { decision: Decision; summary: string }) {
  return (
    <ConfirmAction
      label={
        <>
          <CheckIcon aria-hidden />
          Approve
        </>
      }
      title="Approve this pay run?"
      description={
        <>
          {summary} Approval authorizes payment; it does not send money. Payouts are not connected yet.
        </>
      }
      confirmLabel="Approve pay run"
      action={() => approvePayRunAction(decision)}
    />
  );
}

export function RejectPayRunButton({ decision }: { decision: Decision }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reject(event: React.FormEvent) {
    event.preventDefault();
    if (comment.trim() === "") {
      setError("Explain why the pay run is rejected.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await rejectPayRunAction({ ...decision, comment });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <XIcon aria-hidden />
        Reject
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reject this pay run</DialogTitle>
          <DialogDescription>The preparer sees your comment and can reopen the pay run to fix it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={reject} className="flex flex-col gap-4">
          <Field id="reject-comment" label="Reason" error={error ?? undefined}>
            <Textarea
              id="reject-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder="e.g. Amount for Ada doesn't match invoice INV-104"
              aria-invalid={Boolean(error)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Rejecting…" : "Reject pay run"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
