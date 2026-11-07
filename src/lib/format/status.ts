/**
 * User-facing wording for workflow states. Approval and payment are kept
 * strictly separate: an approved pay run has NOT been paid. Payment execution
 * is not connected yet, so every run's payment status is "Not sent".
 */

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

export type PayRunStatus = "draft" | "pending_approval" | "approved" | "rejected" | "cancelled";

export const PAY_RUN_STATUS: Record<PayRunStatus, { label: string; tone: Tone; description: string }> = {
  draft: { label: "Draft", tone: "neutral", description: "Being prepared. Not visible to approvers yet." },
  pending_approval: {
    label: "Awaiting approval",
    tone: "warning",
    description: "Submitted and frozen. Waiting for an approver's decision.",
  },
  approved: {
    label: "Approved",
    tone: "success",
    description: "Approved for payment. No money has been sent: payouts are not connected yet.",
  },
  rejected: { label: "Rejected", tone: "danger", description: "Returned by an approver with a comment." },
  cancelled: { label: "Cancelled", tone: "neutral", description: "Closed without being paid." },
};

export type PaymentStatus = "not_sent";

/** The only payment state that exists until a payment provider is connected. */
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone; description: string }> = {
  not_sent: {
    label: "Not sent",
    tone: "neutral",
    description: "No payout has been initiated. Payment execution is not connected yet.",
  },
};

export type VerificationStatus = "not_started" | "pending" | "verified" | "rejected";

export const VERIFICATION_STATUS: Record<VerificationStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not verified", tone: "neutral" },
  pending: { label: "Verification pending", tone: "info" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Verification failed", tone: "danger" },
};

export type ContractorStatus = "active" | "archived";

export const CONTRACTOR_STATUS: Record<ContractorStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export const ROLE_LABELS = {
  admin: "Admin",
  preparer: "Preparer",
  approver: "Approver",
  viewer: "Viewer",
} as const;

export const ROLE_DESCRIPTIONS = {
  admin: "Manages the team and can prepare or approve pay runs.",
  preparer: "Adds contractors and prepares pay runs.",
  approver: "Reviews and approves or rejects submitted pay runs.",
  viewer: "Read-only access to contractors, pay runs and history.",
} as const;

export const RAIL_LABELS = {
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  ach: "ACH",
  wire: "Wire",
  interac: "Interac",
} as const;
