import { Badge } from "@/components/ui/badge";
import { SCHEDULE_ONLY_LABEL, SCHEDULE_ONLY_TITLE } from "@/lib/event-display";

interface ScheduleOnlyTagProps {
  isScheduleOnly?: boolean;
  /** card: compact badge on event cards; page: full-size badge; pill: homepage rounded pill. */
  variant?: "card" | "page" | "pill";
}

/** "Usual schedule" tag for runs generated from a kennel's schedule; null for posted runs. */
export function ScheduleOnlyTag({ isScheduleOnly, variant = "card" }: Readonly<ScheduleOnlyTagProps>) {
  if (isScheduleOnly !== true) return null;
  if (variant === "pill") {
    return (
      <span
        className="rounded-full border border-dashed px-1.5 text-[10px] text-muted-foreground"
        title={SCHEDULE_ONLY_TITLE}
      >
        {SCHEDULE_ONLY_LABEL}
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className={
        variant === "card"
          ? "text-[10px] px-1.5 py-0 text-muted-foreground border-dashed"
          : "text-muted-foreground border-dashed"
      }
      title={SCHEDULE_ONLY_TITLE}
    >
      {SCHEDULE_ONLY_LABEL}
    </Badge>
  );
}
