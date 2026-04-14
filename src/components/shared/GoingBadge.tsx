import { Badge } from "@/components/ui/badge";
import { RSVP_INTENDING_COLOR } from "@/lib/rsvp";

/**
 * Pulsing blue dot + "Going" badge — shown when the authenticated user has
 * RSVP'd (attendance.status === "INTENDING"). Used by both hareline's
 * EventCard and travel's ConfirmedCard so the RSVP signal reads the same
 * across surfaces.
 */
export function GoingBadge() {
  return (
    <span className="flex items-center gap-1">
      <span
        className="h-2 w-2 animate-pulse rounded-full"
        style={{ backgroundColor: RSVP_INTENDING_COLOR }}
      />
      <Badge className="border-0 bg-blue-500/15 px-1.5 py-0 text-[10px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
        Going
      </Badge>
    </span>
  );
}
