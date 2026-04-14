import { Badge } from "@/components/ui/badge";
import { RSVP_INTENDING_COLOR } from "@/lib/rsvp";

/**
 * Pulsing blue dot + "Going" badge — shown when the authenticated user has
 * RSVP'd (attendance.status === "INTENDING").
 *
 * Badge fill is deliberately neutral (outline, no fill) so the treatment
 * reads against any tier-tinted card background — emerald-confirmed, sky,
 * amber, or plain card. Earlier versions used a blue fill that fought
 * emerald cards visually. The pulsing blue DOT carries the "active RSVP"
 * signal independent of the badge fill.
 */
export function GoingBadge() {
  return (
    <span className="flex items-center gap-1">
      <span
        className="h-2 w-2 animate-pulse rounded-full"
        style={{ backgroundColor: RSVP_INTENDING_COLOR }}
      />
      <Badge
        variant="outline"
        className="px-1.5 py-0 text-[10px] font-bold tracking-wide text-foreground"
      >
        Going
      </Badge>
    </span>
  );
}
