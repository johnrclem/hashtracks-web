"use client";

import { useRouter } from "next/navigation";
import { POPULAR_DESTINATIONS } from "@/lib/travel/popular-destinations";

export function PopularDestinations() {
  const router = useRouter();

  const today = new Date();
  const twoWeeksOut = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const fromStr = toDateString(today);
  const toStr = toDateString(twoWeeksOut);

  return (
    <section className="mx-auto max-w-5xl px-4 pb-16 pt-24">
      <div className="mb-8 flex items-center gap-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Start from somewhere
        </h2>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {POPULAR_DESTINATIONS.map((dest) => (
          <button
            key={dest.slug}
            type="button"
            onClick={() => {
              const params = new URLSearchParams({
                lat: dest.latitude.toString(),
                lng: dest.longitude.toString(),
                from: fromStr,
                to: toStr,
                q: dest.city,
                r: "50",
              });
              router.push(`/travel?${params.toString()}`);
            }}
            className="
              group relative overflow-hidden rounded-xl border border-border
              bg-card p-5 pl-7 text-left transition-all duration-200
              hover:-translate-y-0.5 hover:border-border/80 hover:shadow-lg
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
            "
          >
            {/* Pin color accent stripe */}
            <span
              className="absolute left-0 top-0 bottom-0 w-[3px] transition-all group-hover:w-[5px]"
              style={{ backgroundColor: dest.pinColor }}
              aria-hidden="true"
            />

            <div className="font-display text-base font-medium tracking-tight">
              {dest.city}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {dest.kennelCount} kennels
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground/70">
              {dest.teaser}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
