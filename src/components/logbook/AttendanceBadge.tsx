import type React from "react";
import { participationLevelLabel } from "@/lib/format";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Pencil } from "lucide-react";

interface AttendanceBadgeProps {
  level: string;
  size?: "sm" | "md";
  onClick?: () => void;
}

export function AttendanceBadge({ level, size = "md", onClick }: AttendanceBadgeProps) {
  const label = participationLevelLabel(level);

  const badge = (
    <span
      className={`inline-flex items-center gap-1 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 font-medium ${
        onClick ? "cursor-pointer hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default"
      } ${size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-xs"}`}
      onClick={onClick}
      aria-label={`Role: ${label}`}
      title={label}
      {...(onClick ? {
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      } : {})}
    >
      {label}
      {onClick && <Pencil size={10} className="opacity-60" />}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{label}{onClick ? " (click to edit)" : ""}</TooltipContent>
    </Tooltip>
  );
}
