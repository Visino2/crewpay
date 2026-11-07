/**
 * Application error codes. The database raises the same codes as exception
 * messages (see supabase/migrations), so they survive the round trip and can
 * be mapped to safe user-facing text here.
 */
export const APP_ERROR_CODES = [
  "not_authenticated",
  "not_authorized",
  "not_found",
  "invalid_input",
  "invalid_state",
  "conflict",
  "last_admin",
  "self_approval_forbidden",
  "snapshot_mismatch",
  "stale_submission",
  "email_not_confirmed",
  "immutable_record",
  "unexpected",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const PUBLIC_MESSAGES: Record<AppErrorCode, string> = {
  not_authenticated: "Please sign in to continue.",
  not_authorized: "You don't have permission to do that.",
  not_found: "We couldn't find that record.",
  invalid_input: "Some details are invalid. Check them and try again.",
  invalid_state: "That action isn't available right now.",
  conflict: "That already exists.",
  last_admin: "An organization must keep at least one admin.",
  self_approval_forbidden:
    "You prepared or edited this pay run, so someone else must approve it.",
  snapshot_mismatch:
    "This pay run changed after you reviewed it. Review it again before deciding.",
  stale_submission: "This pay run was resubmitted. Review the latest version.",
  email_not_confirmed: "Confirm your email address first.",
  immutable_record: "This record can't be changed.",
  unexpected: "Something went wrong. Please try again.",
};

/** More specific text for known `detail` reasons raised by the database. */
const REASON_MESSAGES: Record<string, string> = {
  pay_run_not_draft: "Only draft pay runs can be edited.",
  pay_run_not_pending: "This pay run is not waiting for approval.",
  empty_pay_run: "Add at least one contractor before submitting.",
  stale_payout_method:
    "A contractor's payout details changed. Save their line again before submitting.",
  no_payout_method: "Add payout details for this contractor first.",
  contractor_archived: "This contractor is archived.",
  contractor_in_active_pay_run:
    "This contractor is in a pay run awaiting approval or payment.",
  unsupported_rail_currency: "That payout method isn't supported for this currency.",
  already_member: "That person is already a member.",
  invitation_pending: "That person already has a pending invitation.",
  invitation_closed: "This invitation is no longer valid.",
  contractor_email_exists: "A contractor with that email already exists.",
};

const REASON_PATTERN = /^[a-z_]{1,64}$/;

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly reason?: string;

  constructor(code: AppErrorCode, reason?: string) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.reason = reason;
  }
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && (APP_ERROR_CODES as readonly string[]).includes(value);
}

type DatabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string | null;
  detail?: string | null;
};

/**
 * Converts a PostgREST/Postgres error into an AppError. Only stable codes and
 * short snake_case reasons pass through; raw database text never does.
 */
export function fromDatabaseError(error: DatabaseErrorLike | null | undefined): AppError {
  const rawReason = error?.details ?? error?.detail ?? undefined;
  const reason = rawReason && REASON_PATTERN.test(rawReason) ? rawReason : undefined;

  if (isAppErrorCode(error?.message)) {
    return new AppError(error.message, reason);
  }

  switch (error?.code) {
    case "23505":
      return new AppError("conflict");
    case "22023":
    case "22P02":
    case "23502":
    case "23514":
      return new AppError("invalid_input");
    case "42501":
      return new AppError("not_authorized");
    case "PGRST116":
      return new AppError("not_found");
    default:
      return new AppError("unexpected");
  }
}

export function publicMessage(code: AppErrorCode, reason?: string): string {
  return (reason && REASON_MESSAGES[reason]) || PUBLIC_MESSAGES[code];
}
