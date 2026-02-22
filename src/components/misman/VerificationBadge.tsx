"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { VerificationStatus } from "@/lib/misman/verification";

interface VerificationBadgeProps {
  status: VerificationStatus;
}

const config: Record<
  VerificationStatus,
  { label: string; className: string; tooltip: string } | null
> = {
  verified: {
    label: "V",
    className: "text-green-600",
    tooltip: "Verified — both you and the hasher confirmed attendance",
  },
  "misman-only": {
    label: "M",
    className: "text-yellow-600",
    tooltip:
      "Misman only — you recorded it, but the hasher hasn't confirmed on their account yet",
  },
  "user-only": {
    label: "U",
    className: "text-blue-600",
    tooltip:
      "User only — the hasher checked in on their account, but you haven't recorded it yet",
  },
  none: null,
};

export function VerificationBadge({ status }: VerificationBadgeProps) {
  const cfg = config[status];
  if (!cfg) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`text-xs font-medium cursor-default ${cfg.className}`}>
          {cfg.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{cfg.tooltip}</TooltipContent>
    </Tooltip>
  );
}
