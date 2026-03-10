"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export type CTAState = "unauthenticated" | "authenticated" | "misman";

interface MismanCTAProps {
  state: CTAState;
  variant?: "hero" | "footer";
}

const ctaConfig: Record<
  CTAState,
  {
    href: string;
    label: string;
    secondary: { href: string; label: string } | null;
  }
> = {
  misman: {
    href: "/misman",
    label: "Go to Dashboard",
    secondary: null,
  },
  authenticated: {
    href: "/misman",
    label: "Request Access for Your Kennel",
    secondary: { href: "/hareline", label: "Browse Events" },
  },
  unauthenticated: {
    href: "/sign-up",
    label: "Get Started \u2014 It\u2019s Free",
    secondary: { href: "#features", label: "See What It Does" },
  },
};

export function MismanCTA({ state, variant = "hero" }: MismanCTAProps) {
  const isHero = variant === "hero";
  const btnHeight = isHero ? "h-12 sm:h-14" : "h-12";
  const btnPadding = isHero ? "px-8 sm:px-10" : "px-8";
  const textSize = isHero ? "text-sm sm:text-base" : "text-sm";

  const { href, label, secondary } = ctaConfig[state];

  return (
    <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
      <Link
        href={href}
        className={`group inline-flex ${btnHeight} items-center gap-2 rounded-full bg-orange-600 ${btnPadding} ${textSize} font-semibold text-white transition-all hover:gap-3 hover:bg-orange-700`}
      >
        {label}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
      {secondary && (
        <Link
          href={secondary.href}
          className={`inline-flex ${btnHeight} items-center gap-2 rounded-full border border-foreground/20 ${btnPadding} ${textSize} font-semibold transition-colors hover:border-foreground/40 hover:bg-foreground/[0.03]`}
        >
          {secondary.label}
        </Link>
      )}
    </div>
  );
}
