"use client";

import Link from "next/link";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils";

// Renders a number formatted with locale grouping. Previously this animated
// from 0 → target via IntersectionObserver, but the count-up effect left
// SSR/no-JS/static-snapshot views permanently rendering "0" (issue #911), so
// the animation was dropped in favor of correctness.
export function AnimatedCounter({ target }: { target: number }) {
  return <span>{target.toLocaleString()}</span>;
}

/* ── Staggered slide-in for sections ── */
// Content is always visible: only a small slide animates, so server-rendered,
// no-JS, screenshot and slow-phone views never show blank sections. Visitors
// who prefer reduced motion get no animation at all. (Name kept for the ~15 call sites.)
export function FadeInSection({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, visible } = useInView<HTMLDivElement>(0);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:translate-y-0 motion-reduce:transition-none",
        visible ? "translate-y-0" : "translate-y-3",
        className,
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ── Live activity pulse dot ── */
export function PulseDot() {
  return (
    <span className="relative ml-1.5 inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

/* ── Scrolling region ticker ── */
export function RegionTicker({ regions }: { regions: string[] }) {
  // Double the list for seamless loop
  const doubled = [...regions, ...regions];

  return (
    <div
      className="group relative w-full overflow-hidden py-4"
      style={{
        maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        WebkitMaskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
      }}
    >
      <div className="flex w-max animate-[ticker_40s_linear_infinite] gap-4 group-hover:[animation-play-state:paused]">
        {doubled.map((r, i) => (
          <Link
            key={`${r}-${i}`}
            href={`/kennels?regions=${encodeURIComponent(r)}`}
            className="whitespace-nowrap rounded-full border border-foreground/10 bg-foreground/[0.03] px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/[0.06] hover:text-foreground hover:underline"
          >
            {r}
          </Link>
        ))}
      </div>
    </div>
  );
}
