import { ConfirmedCard } from "./ConfirmedCard";
import { LikelyCard } from "./LikelyCard";
import { PossibleSection } from "./PossibleSection";

interface SerializedConfirmed {
  type: "confirmed";
  eventId: string;
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelRegion: string;
  kennelPinColor: string | null;
  date: string;
  startTime: string | null;
  title: string | null;
  runNumber: number | null;
  haresText: string | null;
  locationName: string | null;
  locationCity: string | null;
  sourceUrl: string | null;
  distanceKm: number;
  distanceTier: "nearby" | "area" | "drive";
  sourceLinks: { url: string; label: string; type: string }[];
  weather: { highTempC: number; lowTempC: number; condition: string; conditionType: string; precipProbability: number } | null;
}

interface SerializedLikely {
  type: "likely";
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelRegion: string;
  kennelPinColor: string | null;
  date: string;
  startTime: string | null;
  confidence: "high" | "medium";
  distanceKm: number;
  distanceTier: "nearby" | "area" | "drive";
  explanation: string;
  evidenceWindow: string;
  evidenceTimeline: { weeks: boolean[]; totalEvents: number };
  sourceLinks: { url: string; label: string; type: string }[];
}

interface SerializedPossible {
  type: "possible";
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelRegion: string;
  date: string | null;
  confidence: "low";
  distanceKm: number;
  distanceTier: "nearby" | "area" | "drive";
  explanation: string;
  sourceLinks: { url: string; label: string; type: string }[];
}

interface TravelResultsProps {
  results: {
    confirmed: SerializedConfirmed[];
    likely: SerializedLikely[];
    possible: SerializedPossible[];
  };
}

const TIER_LABELS: Record<string, { title: string; description: string }> = {
  nearby: { title: "Walking distance", description: "≤ 10 km" },
  area: { title: "Across town", description: "10–25 km" },
  drive: { title: "Day trip material", description: "25+ km" },
};

/**
 * Server component rendering the three-tier result list.
 * Cards use CSS keyframe entrance animation with staggered delays.
 */
export function TravelResults({ results }: TravelResultsProps) {
  const { confirmed, likely, possible } = results;
  const allDated = [
    ...confirmed.map((r) => ({ ...r, _sort: "a" as const })),
    ...likely.map((r) => ({ ...r, _sort: "b" as const })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Group by distance tier for narrative headers
  const tiers = ["nearby", "area", "drive"] as const;
  let cardIndex = 0;

  return (
    <div className="mt-8 border-l border-[var(--destination-pin,oklch(0.65_0.18_42))] pl-6 lg:pl-8">
      {tiers.map((tier) => {
        const tierConfirmed = confirmed.filter((r) => r.distanceTier === tier);
        const tierLikely = likely.filter((r) => r.distanceTier === tier);
        const total = tierConfirmed.length + tierLikely.length;
        if (total === 0) return null;

        const label = TIER_LABELS[tier];

        return (
          <section key={tier} className="mb-10">
            <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-2">
              <h2 className="font-display text-lg font-medium">{label.title}</h2>
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {total} trail{total !== 1 ? "s" : ""} · {label.description}
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {tierConfirmed.map((result) => {
                const delay = cardIndex * 50;
                cardIndex++;
                return (
                  <div
                    key={result.eventId}
                    className="travel-animate"
                    style={{
                      opacity: 0,
                      animation: `travel-card-enter 400ms ease-out forwards`,
                      animationDelay: `${delay}ms`,
                    }}
                  >
                    <ConfirmedCard result={result} />
                  </div>
                );
              })}
              {tierLikely.map((result) => {
                const delay = cardIndex * 50;
                cardIndex++;
                return (
                  <div
                    key={`${result.kennelId}-${result.date}`}
                    className="travel-animate"
                    style={{
                      opacity: 0,
                      animation: `travel-card-enter 400ms ease-out forwards`,
                      animationDelay: `${delay}ms`,
                    }}
                  >
                    <LikelyCard result={result} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Possible activity section */}
      {possible.length > 0 && (
        <PossibleSection results={possible} />
      )}
    </div>
  );
}
