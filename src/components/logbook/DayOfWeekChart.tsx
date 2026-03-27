"use client";

import { useInView } from "@/hooks/useInView";

interface DayData {
  day: number;
  label: string;
  count: number;
}

export function DayOfWeekChart({ data }: { data: DayData[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const { ref, visible } = useInView();

  return (
    <div
      ref={ref}
      className="rounded-xl border border-border/50 bg-card p-5"
    >
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Your Hash Days
      </h3>
      <div className="flex items-end justify-between gap-2" style={{ height: 180 }}>
        {data.map((d, i) => {
          const pct = (d.count / max) * 100;
          const isPeak = d.count === max && d.count > 0;
          return (
            <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
              <span
                className="text-xs font-semibold tabular-nums transition-opacity duration-500"
                style={{ opacity: visible ? 1 : 0, transitionDelay: `${i * 60 + 400}ms` }}
              >
                {d.count > 0 ? d.count : ""}
              </span>
              <div className="relative w-full" style={{ height: 130 }}>
                <div
                  className="absolute bottom-0 left-1/2 w-[70%] -translate-x-1/2 rounded-t-md transition-all duration-700 ease-out"
                  style={{
                    height: visible ? `${Math.max(pct, d.count > 0 ? 4 : 0)}%` : "0%",
                    transitionDelay: `${i * 60}ms`,
                    background: isPeak
                      ? "linear-gradient(to top, #6366f1, #8b5cf6)"
                      : "linear-gradient(to top, rgba(99,102,241,0.7), rgba(139,92,246,0.7))",
                  }}
                />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{d.label}</span>
              <span
                className="h-4 text-[10px] font-bold uppercase tracking-wide text-amber-500 dark:text-amber-400 transition-opacity duration-500"
                style={{ opacity: isPeak && visible ? 1 : 0, transitionDelay: `${i * 60 + 600}ms` }}
              >
                Fave
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
