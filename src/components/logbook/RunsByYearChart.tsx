"use client";

import { useInView } from "@/hooks/useInView";

interface YearData {
  year: number;
  count: number;
}

export function RunsByYearChart({ data }: { data: YearData[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const currentYear = new Date().getUTCFullYear();
  const { ref, visible } = useInView();

  return (
    <div
      ref={ref}
      className="rounded-xl border border-border/50 bg-card p-5"
    >
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Year by Year
      </h3>
      <div className="space-y-2">
        {data.map((d, i) => {
          const pct = (d.count / max) * 100;
          const isCurrent = d.year === currentYear;
          return (
            <div key={d.year} className="flex items-center gap-3">
              <span className="w-10 text-right text-xs font-medium tabular-nums text-muted-foreground">
                {d.year}
              </span>
              <div className="relative flex-1 h-6">
                <div
                  className="absolute inset-y-0 left-0 rounded-r-md transition-all duration-700 ease-out"
                  style={{
                    width: visible ? `${Math.max(pct, 4)}%` : "0%",
                    transitionDelay: `${i * 80}ms`,
                    background: "linear-gradient(to right, #14b8a6, #10b981)",
                  }}
                />
              </div>
              <span
                className="flex w-10 items-center gap-1 text-xs font-semibold tabular-nums transition-opacity duration-500"
                style={{ opacity: visible ? 1 : 0, transitionDelay: `${i * 80 + 400}ms` }}
              >
                {d.count}
                {isCurrent && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
