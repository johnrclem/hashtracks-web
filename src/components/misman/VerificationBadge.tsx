import type { VerificationStatus } from "@/lib/misman/verification";

interface VerificationBadgeProps {
  status: VerificationStatus;
}

const config: Record<
  VerificationStatus,
  { label: string; className: string; title: string } | null
> = {
  verified: {
    label: "V",
    className: "text-green-600",
    title: "Verified — recorded by misman and user",
  },
  "misman-only": {
    label: "M",
    className: "text-yellow-600",
    title: "Misman only — not yet confirmed by user",
  },
  "user-only": {
    label: "U",
    className: "text-blue-600",
    title: "User only — not recorded by misman",
  },
  none: null,
};

export function VerificationBadge({ status }: VerificationBadgeProps) {
  const cfg = config[status];
  if (!cfg) return null;

  return (
    <span className={`text-xs font-medium ${cfg.className}`} title={cfg.title}>
      {cfg.label}
    </span>
  );
}
