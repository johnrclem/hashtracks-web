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
    <section className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      {/* Section divider — thin decorative line with label */}
      <div className="mb-10 flex items-center gap-5">
        <span className="h-px w-12 bg-gradient-to-r from-transparent to-border" aria-hidden="true" />
        <h2 className="whitespace-nowrap font-display text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
          Start from somewhere
        </h2>
        <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {POPULAR_DESTINATIONS.map((dest, idx) => (
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
              travel-animate group relative overflow-hidden rounded-lg
              border border-border/60 bg-card p-5 pl-7 text-left
              transition-all duration-300
              hover:-translate-y-1 hover:border-border hover:shadow-xl
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
            "
            style={{
              opacity: 0,
              animation: "travel-card-enter 400ms ease-out forwards",
              animationDelay: `${800 + idx * 60}ms`,
            }}
          >
            {/* Pin color accent stripe — thicker, with glow on hover */}
            <span
              className="absolute left-0 top-0 bottom-0 w-[3px] transition-all duration-300 group-hover:w-[4px] group-hover:shadow-[2px_0_12px_-2px_var(--pin)]"
              style={{ backgroundColor: dest.pinColor, "--pin": dest.pinColor } as React.CSSProperties}
              aria-hidden="true"
            />

            <div className="font-display text-[15px] font-medium tracking-tight">
              {dest.city}
            </div>
            <div className="mt-1 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/50">
              {dest.kennelCount} kennels
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground/60">
              {dest.teaser}
            </p>

            {/* Subtle arrow on hover */}
            <span className="absolute bottom-4 right-4 text-[10px] text-muted-foreground/0 transition-all duration-300 group-hover:text-muted-foreground/40">
              →
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
