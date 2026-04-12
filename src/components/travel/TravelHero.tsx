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
      {/* Decorative backdrop with parallax — denser map lines + more visible pins */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.2] dark:opacity-[0.35]"
        aria-hidden="true"
        style={{ transform: `translateY(${scrollY * -0.15}px)` }}
      >
        <svg
          viewBox="0 0 1400 700"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full"
        >
          {/* Continent-like strokes — slightly thicker for visibility */}
          <g
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            opacity="0.4"
            className="text-muted-foreground"
          >
            <path d="M120 180 Q200 160 300 190 T480 210 Q560 225 640 200 L720 220 L800 210 Q880 235 960 225 T1120 250 Q1200 260 1280 250" />
            <path d="M80 310 Q160 290 250 300 T420 325 Q510 340 590 330 Q680 315 760 340 T940 360 Q1020 375 1100 365 L1200 355" />
            <path d="M160 440 Q240 430 320 450 T480 475 Q560 490 640 470 T820 495 Q900 485 980 475 L1060 465" />
            <path d="M250 560 Q330 545 420 565 T590 580 Q680 595 760 575 L850 570" />
          </g>
          {/* Kennel pins with subtle glow rings */}
          <g>
            <circle cx="350" cy="210" r="6" className="fill-emerald-500/20" />
            <circle cx="350" cy="210" r="3" className="fill-emerald-500/70" />
            <circle cx="740" cy="205" r="6" className="fill-sky-500/20" />
            <circle cx="740" cy="205" r="3" className="fill-sky-500/70" />
            <circle cx="1100" cy="250" r="6" className="fill-amber-500/20" />
            <circle cx="1100" cy="250" r="3" className="fill-amber-500/70" />
            <circle cx="460" cy="350" r="6" className="fill-emerald-500/20" />
            <circle cx="460" cy="350" r="3" className="fill-emerald-500/70" />
            <circle cx="850" cy="380" r="6" className="fill-violet-500/20" />
            <circle cx="850" cy="380" r="3" className="fill-violet-500/70" />
            <circle cx="270" cy="330" r="6" className="fill-sky-500/20" />
            <circle cx="270" cy="330" r="3" className="fill-sky-500/70" />
            <circle cx="640" cy="355" r="6" className="fill-rose-500/20" />
            <circle cx="640" cy="355" r="3" className="fill-rose-500/70" />
            <circle cx="550" cy="470" r="6" className="fill-amber-500/20" />
            <circle cx="550" cy="470" r="3" className="fill-amber-500/70" />
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
      <div className="relative mx-auto flex min-h-[70vh] max-w-5xl flex-col items-center justify-center px-4 py-24">
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
          className="travel-animate mt-6 max-w-lg text-center text-base leading-relaxed text-muted-foreground/80"
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
          className="travel-animate mt-12 w-full max-w-4xl"
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
