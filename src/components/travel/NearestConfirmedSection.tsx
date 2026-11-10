import { ConfirmedCard } from "./ConfirmedCard";
import { TravelHintBadge } from "./TravelHintBadge";
import type { NearestConfirmed } from "@/lib/travel/search";
import type { SerializedConfirmed } from "@/lib/travel/serialize";

/**
 * Confirmed runs just outside the search radius, shown when nothing confirmed
 * is in range for the trip dates, so the result never ends on a dead end.
 */
export function NearestConfirmedSection({ radiusKm, confirmed }: Readonly<NearestConfirmed<SerializedConfirmed>>) {
  return (
    <section aria-labelledby="nearest-confirmed-heading" className="mx-auto mt-10 max-w-3xl">
      <TravelHintBadge
        glyph="◇"
        label={`Outside your search area · within ${radiusKm} km`}
        ariaLabel={`Outside your search area, within ${radiusKm} kilometers`}
      />
      <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-2">
        <h2 id="nearest-confirmed-heading" className="font-display text-lg font-medium">
          Nearest confirmed runs
        </h2>
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {confirmed.length} trail{confirmed.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {confirmed.map((r) => (
          <ConfirmedCard key={r.eventId} result={r} />
        ))}
      </div>
    </section>
  );
}
