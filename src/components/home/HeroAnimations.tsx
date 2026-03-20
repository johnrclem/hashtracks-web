"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useInView } from "@/hooks/useInView";

/* ── Animated counter that counts up from 0 ── */
export function AnimatedCounter({ target, duration = 1500 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const start = performance.now();
          const step = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.round(eased * target));
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration]);

  return <span ref={ref}>{count.toLocaleString()}</span>;
}

/* ── Staggered fade-in for sections ── */
export function FadeInSection({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, visible } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
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
