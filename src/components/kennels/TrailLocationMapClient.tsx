"use client";

import dynamic from "next/dynamic";

const TrailLocationMap = dynamic(
  () => import("./TrailLocationMap").then((m) => m.TrailLocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm">
        <div className="flex items-stretch gap-3">
          <div aria-hidden className="w-[3px] shrink-0 bg-muted/60" />
          <div className="flex flex-col justify-center gap-1.5 py-3.5">
            <div className="h-2.5 w-32 rounded bg-muted/50 animate-pulse" />
            <div className="h-2 w-20 rounded bg-muted/40 animate-pulse" />
          </div>
        </div>
        <div className="h-[240px] sm:h-[300px] bg-muted/30 animate-pulse" />
      </div>
    ),
  },
);

interface TrailLocation {
  lat: number;
  lng: number;
}

export function TrailLocationMapClient({
  locations,
  region,
}: Readonly<{ locations: TrailLocation[]; region: string }>) {
  return <TrailLocationMap locations={locations} region={region} />;
}
