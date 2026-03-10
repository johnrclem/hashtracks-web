"use client";

import { ClipboardList } from "lucide-react";
import { FadeInSection } from "@/components/home/HeroAnimations";
import { MismanCTA, type CTAState } from "./MismanCTA";

interface MismanHeroProps {
  ctaState: CTAState;
}

export function MismanHero({ ctaState }: MismanHeroProps) {
  return (
    <section className="relative overflow-hidden px-4 pb-24 pt-12 sm:pb-32 sm:pt-20 lg:pb-36">
      {/* Background texture — diagonal lines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1'%3E%3Cpath d='M0 40L40 0'/%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Gradient orbs */}
      <div className="pointer-events-none absolute -top-40 right-1/4 h-96 w-96 rounded-full bg-orange-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />

      {/* Diagonal bottom clip */}
      <div
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 85%, 0 100%)",
          background:
            "linear-gradient(135deg, oklch(0.145 0.02 260 / 0.3), oklch(0.12 0.015 260 / 0.1))",
        }}
      />

      <div className="relative mx-auto max-w-5xl text-center">
        {/* Eyebrow */}
        <FadeInSection>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/[0.06] px-4 py-1.5">
            <ClipboardList className="h-3.5 w-3.5 text-orange-400" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-400/90">
              For Kennel Mismanagement
            </span>
          </div>
        </FadeInSection>

        {/* Headline */}
        <FadeInSection delay={100}>
          <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
            Stop counting heads
            <br className="hidden sm:block" />{" "}
            in a{" "}
            <span className="text-foreground/40 line-through decoration-orange-500/60 decoration-4">
              spreadsheet
            </span>
          </h1>
        </FadeInSection>

        {/* Replacement text with highlight */}
        <FadeInSection delay={200}>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            HashTracks{" "}
            <span className="relative inline-block">
              <span className="relative z-10 font-semibold text-foreground">
                Misman
              </span>
              <span
                className="absolute -bottom-0.5 left-0 right-0 z-0 h-2.5 rounded-sm bg-orange-300/40 sm:h-3"
                aria-hidden="true"
              />
            </span>{" "}
            is a mobile-first attendance tool built for hash kennel organizers.
            Tap names, track who&apos;s paid hash cash, manage your roster — all in one
            place.
          </p>
        </FadeInSection>

        {/* CTA */}
        <FadeInSection delay={300}>
          <div className="mt-10">
            <MismanCTA state={ctaState} variant="hero" />
          </div>
        </FadeInSection>
      </div>
    </section>
  );
}
