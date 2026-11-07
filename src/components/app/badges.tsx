import {
  CONTRACTOR_STATUS,
  PAY_RUN_STATUS,
  PAYMENT_STATUS,
  VERIFICATION_STATUS,
  type ContractorStatus,
  type PayRunStatus,
  type VerificationStatus,
} from "@/lib/format/status";

import { StatusBadge } from "./status-badge";

export function PayRunStatusBadge({ status }: { status: PayRunStatus }) {
  const config = PAY_RUN_STATUS[status];
  return (
    <StatusBadge tone={config.tone} title={config.description}>
      {config.label}
    </StatusBadge>
  );
}

/** Always "Not sent" until a payment provider is connected. */
export function PaymentStatusBadge() {
  const config = PAYMENT_STATUS.not_sent;
  return (
    <StatusBadge tone={config.tone} title={config.description}>
      {config.label}
    </StatusBadge>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const config = VERIFICATION_STATUS[status];
  return <StatusBadge tone={config.tone}>{config.label}</StatusBadge>;
}

export function ContractorStatusBadge({ status }: { status: ContractorStatus }) {
  const config = CONTRACTOR_STATUS[status];
  return <StatusBadge tone={config.tone}>{config.label}</StatusBadge>;
}
