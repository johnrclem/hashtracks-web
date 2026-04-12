"use client";

import { useEffect, useState } from "react";
import { TravelSearchForm } from "./TravelSearchForm";
import { NearMeShortcut } from "./NearMeShortcut";

/**
 * Landing hero for /travel with no search params.
 * Client component for staggered word reveal animation + scroll parallax.
 */
export function TravelHero() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(() => {
          setScrollY(window.scrollY);
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Last-trip ghost from sessionStorage
  const [lastTrip, setLastTrip] = useState<{ label: string; url: string } | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("hashtracks:lastTravelSearch");
      if (raw) setLastTrip(JSON.parse(raw));
    } catch {
      // No stored trip
    }
  }, []);

  // Two-line headline structure prevents "roam." orphaning on its own line
  const line1 = [
    { text: "Find", accent: false },
    { text: "your", accent: false },
    { text: "trail,", accent: true },
  ];
  const line2 = [
    { text: "wherever", accent: false },
    { text: "you", accent: false },
    { text: "roam.", accent: true },
  ];

  return (
    <section className="relative overflow-hidden">
      {/* Decorative backdrop with parallax */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15] dark:opacity-[0.25]"
        aria-hidden="true"
        style={{ transform: `translateY(${scrollY * -0.15}px)` }}
      >
        <svg
          viewBox="0 0 1400 700"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full"
        >
          <g
            stroke="currentColor"
            strokeWidth="0.8"
            fill="none"
            opacity="0.5"
            className="text-muted-foreground"
          >
            <path d="M180 200 Q260 180 340 210 T500 230 Q580 240 640 220 L700 240 L760 230 Q820 250 880 240 T1020 260 Q1100 270 1180 260" />
            <path d="M150 340 Q220 320 290 330 T440 350 Q520 360 580 350 Q640 340 720 360 T890 380 Q960 390 1040 380 L1120 370" />
            <path d="M200 460 Q270 450 340 470 T490 490 Q560 500 620 480 T780 500 Q850 490 920 480" />
          </g>
          {/* Kennel pins at destinations */}
          <g>
            <circle cx="380" cy="230" r="4" className="fill-emerald-500/60" />
            <circle cx="720" cy="220" r="4" className="fill-sky-500/60" />
            <circle cx="1050" cy="260" r="4" className="fill-amber-500/60" />
            <circle cx="480" cy="390" r="4" className="fill-emerald-500/60" />
            <circle cx="820" cy="410" r="4" className="fill-violet-500/60" />
            <circle cx="290" cy="360" r="4" className="fill-sky-500/60" />
            <circle cx="640" cy="380" r="4" className="fill-rose-500/60" />
          </g>
        </svg>
      </div>

      {/* Compass rose */}
      <svg
        className="pointer-events-none absolute bottom-8 right-8 h-12 w-12 text-muted-foreground opacity-20"
        viewBox="0 0 64 64"
        aria-hidden="true"
      >
        <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        <circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
        <path d="M32 4 L36 32 L32 28 L28 32 Z" fill="currentColor" opacity="0.7" />
        <path d="M32 60 L28 32 L32 36 L36 32 Z" fill="currentColor" opacity="0.25" />
        <text x="32" y="3" textAnchor="middle" className="fill-current text-[4px] font-mono" opacity="0.6">N</text>
      </svg>

      {/* Content */}
      <div className="relative mx-auto flex min-h-[65vh] max-w-5xl flex-col items-center justify-center px-4 py-20">
        {/* Staggered headline — explicit two-line structure */}
        <h1 className="text-center font-display text-4xl font-medium tracking-tight sm:text-5xl lg:text-6xl">
          <span className="block">
            {line1.map((w, i) => (
              <span
                key={i}
                className={`travel-animate mr-[0.2em] inline-block ${w.accent ? "bg-gradient-to-r from-emerald-500 to-sky-500 bg-clip-text pr-[0.15em] font-normal italic text-transparent" : ""}`}
                style={{ opacity: 0, animation: "travel-word-reveal 500ms cubic-bezier(0.2,0.9,0.3,1.1) forwards", animationDelay: `${i * 60}ms` }}
              >
                {w.text}
              </span>
            ))}
          </span>
          <span className="block">
            {line2.map((w, i) => (
              <span
                key={i}
                className={`travel-animate mr-[0.2em] inline-block ${w.accent ? "bg-gradient-to-r from-emerald-500 to-sky-500 bg-clip-text pr-[0.15em] font-normal italic text-transparent" : ""}`}
                style={{ opacity: 0, animation: "travel-word-reveal 500ms cubic-bezier(0.2,0.9,0.3,1.1) forwards", animationDelay: `${(i + 3) * 60}ms` }}
              >
                {w.text}
              </span>
            ))}
          </span>
        </h1>

        <p
          className="travel-animate mt-5 max-w-xl text-center text-lg text-muted-foreground"
          style={{
            opacity: 0,
            animation: "travel-word-reveal 500ms ease-out forwards",
            animationDelay: "400ms",
          }}
        >
          Confirmed events, likely trails, and a few possibilities from
          HashTracks&apos; coverage across 500+ kennels worldwide.
        </p>

        {/* Boarding pass form */}
        <div
          className="travel-animate mt-10 w-full max-w-4xl"
          style={{
            opacity: 0,
            animation: "travel-card-enter 600ms ease-out forwards",
            animationDelay: "600ms",
          }}
        >
          <TravelSearchForm variant="hero" />
        </div>

        <NearMeShortcut />

        {/* Last-trip ghost */}
        {lastTrip && (
          <div className="mt-3 text-center">
            <a
              href={lastTrip.url}
              className="text-xs italic text-muted-foreground/40 underline underline-offset-4 transition-colors hover:text-muted-foreground"
            >
              Last trip: {lastTrip.label} →
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
