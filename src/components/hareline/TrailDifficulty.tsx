import { Flame, Route } from "lucide-react";

/**
 * #890 — shared visual vocabulary for trail length + Shiggy Level.
 *
 * Lives outside `EventCard.tsx` (which is `"use client"`) so the
 * server-rendered full-page detail (`src/app/hareline/[eventId]/page.tsx`)
 * can import the same components without dragging the parent into a client
 * boundary. The presentational pieces are pure SVG + spans — no client
 * hooks needed — so they render identically on either side.
 *
 * Design notes
 * ────────────
 * Iconography:
 *   • Route  — distance/path semantic. Distinct from MapPin (location)
 *               and Footprints (hares) so each metadata field has its
 *               own glyph. Hashers learn it once on the card and
 *               recognize it on the detail panel.
 *   • Flame  — universal "intensity level" idiom (think Yelp peppers,
 *               Hot Ones flames). Reads instantly as a 1–5 difficulty
 *               cluster without legend.
 *
 * Color treatment:
 *   Filled flames take the kennel's region color (passed via the
 *   `color` prop). The same color drives the kennel-name underline,
 *   the left-border stripe, and the time-pill tint elsewhere on the
 *   card, so Shiggy Level renders as "this kennel's interpretation
 *   of difficulty" rather than a context-free heatmap. Empty flames
 *   stay at a low-alpha foreground tint so the level reads at a glance.
 */

interface ShiggyLevelFlamesProps {
  /** 1–5; values outside that range render nothing. */
  readonly level: number | null | undefined;
  /** Compact for in-card use, comfortable for detail panels. */
  readonly size?: "sm" | "md";
  /** Hex color for filled flames — typically the kennel's region color. */
  readonly color?: string;
  /** Extra wrapper classes (e.g. spacing the cluster from neighbors). */
  readonly className?: string;
}

/**
 * Render the Shiggy Level as a 5-flame row.
 * Filled flames use solid `fill="currentColor"` tinted with `color`;
 * empty flames are stroke-only at a muted foreground alpha. Returns
 * `null` when `level` is missing or out of range so callers can use
 * it freely without guards.
 */
export function ShiggyLevelFlames({
  level,
  size = "sm",
  color,
  className,
}: ShiggyLevelFlamesProps) {
  if (level == null || level < 1 || level > 5) return null;
  const dim = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <span
      role="img"
      aria-label={`Shiggy Level ${level} of 5`}
      className={`inline-flex items-center gap-px ${className ?? ""}`}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const filled = i < level;
        return (
          <Flame
            key={i}
            className={`${dim} shrink-0 ${filled ? "fill-current" : "text-foreground/15 fill-transparent"}`}
            style={filled && color ? { color } : undefined}
            aria-hidden="true"
          />
        );
      })}
    </span>
  );
}

interface TrailLengthLineProps {
  /** Verbatim trail-length text from the source ("3-5 Miles", "13 miles"). */
  readonly text: string | null | undefined;
  /** Hex color for the leading Route icon. */
  readonly color?: string;
  /** Compact for in-card use, comfortable for detail panels. */
  readonly size?: "sm" | "md";
  readonly className?: string;
}

/**
 * Single-line trail-length display: a region-tinted Route icon followed
 * by the verbatim source string in `tabular-nums`. Returns `null` when
 * `text` is empty so callers can use it without guards.
 */
export function TrailLengthLine({
  text,
  color,
  size = "sm",
  className,
}: TrailLengthLineProps) {
  if (!text) return null;
  const dim = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  const textCls = size === "md" ? "text-sm" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${textCls} ${className ?? ""}`}>
      <Route
        className={`${dim} shrink-0`}
        style={color ? { color, opacity: 0.7 } : { opacity: 0.9 }}
        aria-hidden="true"
      />
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * Preferred display string for trail length.
 *
 * Uses the source's verbatim `trailLengthText` when present (preserves
 * formatting hashers wrote: "3-5 Miles", "2.69 (miles)"). Falls back to
 * a parsed `min–max mi` composite when only the numerics are populated.
 * Returns `null` when nothing is set.
 */
export function formatTrailLength(event: {
  trailLengthText?: string | null;
  trailLengthMinMiles?: number | null;
  trailLengthMaxMiles?: number | null;
}): string | null {
  if (event.trailLengthText) return event.trailLengthText;
  const min = event.trailLengthMinMiles;
  const max = event.trailLengthMaxMiles;
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) return `${min}–${max} mi`;
  if (min != null) return `${min} mi`;
  if (max != null) return `${max} mi`;
  return null;
}
