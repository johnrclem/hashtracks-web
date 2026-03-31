import { getActivityStatus, type ActivityStatus } from "@/lib/activity-status";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const STATUS_CONFIG: Record<Exclude<ActivityStatus, "active">, { label: string; classes: string; tooltip: string }> = {
  "possibly-inactive": {
    label: "Possibly Inactive",
    classes: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    tooltip: "No events in the last 90 days",
  },
  inactive: {
    label: "Inactive",
    classes: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    tooltip: "No events in over a year",
  },
  unknown: {
    label: "No Data",
    classes: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    tooltip: "No run data on HashTracks yet",
  },
};

interface ActivityStatusBadgeProps {
  lastEventDate: Date | string | null;
  hasUpcomingEvent?: boolean;
  size?: "sm" | "md";
}

export function ActivityStatusBadge({ lastEventDate, hasUpcomingEvent, size = "sm" }: ActivityStatusBadgeProps) {
  const date = lastEventDate ? new Date(lastEventDate) : null;
  const status = getActivityStatus(date, hasUpcomingEvent);

  // Active kennels don't get a badge
  if (status === "active") return null;

  const config = STATUS_CONFIG[status];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center rounded-full font-medium shrink-0 ${config.classes} ${
            size === "sm"
              ? "h-5 px-1.5 text-[10px] leading-5"
              : "px-2 py-0.5 text-xs"
          }`}
          aria-label={config.label}
        >
          {config.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{config.tooltip}</TooltipContent>
    </Tooltip>
  );
}
