import { PlugZapIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Makes the payment boundary visible everywhere: approvals are records, and
 * no money moves until a payment provider integration is built and verified.
 */
export function ProviderStatus({ configured }: { configured: boolean }) {
  const label = configured ? "Provider credentials set · payouts not built" : "Payouts not connected";
  return (
    <Tooltip>
      <TooltipTrigger
        className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-describedby="provider-status-detail"
      >
        <PlugZapIcon className="size-3.5 shrink-0" aria-hidden />
        <span>{label}</span>
      </TooltipTrigger>
      <TooltipContent id="provider-status-detail" side="right" className="max-w-64">
        CrewPay records and approves pay runs. Sending money through the payment provider (Blaaiz) is not connected yet,
        so no payout has been made for any pay run.
      </TooltipContent>
    </Tooltip>
  );
}
