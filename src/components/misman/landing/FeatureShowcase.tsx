"use client";

import {
  UserPlus,
  Sparkles,
  Users,
  Shield,
  FileSpreadsheet,
  Link2,
  Check,
  type LucideIcon,
} from "lucide-react";
import { FadeInSection } from "@/components/home/HeroAnimations";

/* ── Feature visual illustrations (pure Tailwind, no images) ── */

function ChipVisual() {
  const names = [
    { name: "Dances w/ Beer", checked: true },
    { name: "Trail Blazer", checked: true },
    { name: "Just John", checked: false },
    { name: "Half Mind", checked: true },
    { name: "Salty Dog", checked: false },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {names.map((n) => (
        <span
          key={n.name}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
            n.checked
              ? "border-orange-500/30 bg-orange-500/10 text-orange-300"
              : "border-foreground/10 bg-foreground/[0.03] text-muted-foreground"
          }`}
        >
          {n.checked && <Check className="h-3 w-3" />}
          {n.name}
        </span>
      ))}
    </div>
  );
}

function ScoringVisual() {
  const bars = [
    { label: "Frequency", value: 85, color: "bg-emerald-500" },
    { label: "Recency", value: 65, color: "bg-emerald-400" },
    { label: "Streak", value: 100, color: "bg-emerald-300" },
  ];
  return (
    <div className="space-y-3">
      {bars.map((bar) => (
        <div key={bar.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{bar.label}</span>
            <span className="font-mono text-foreground/60">{bar.value}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
            <div
              className={`h-full rounded-full ${bar.color}`}
              style={{ width: `${bar.value}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RosterVisual() {
  return (
    <div className="flex items-center justify-center gap-4">
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-xs font-semibold text-blue-300">
        Brooklyn H3
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="h-px w-8 border-t border-dashed border-foreground/20" />
        <div className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 py-1 text-[10px] text-muted-foreground">
          Shared Roster
        </div>
        <div className="h-px w-8 border-t border-dashed border-foreground/20" />
      </div>
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-xs font-semibold text-blue-300">
        NYC H3
      </div>
    </div>
  );
}

function AuditVisual() {
  const entries = [
    { time: "2:41 PM", action: "Marked present", who: "Trail Blazer" },
    { time: "2:38 PM", action: "Added to roster", who: "New Boot" },
    { time: "2:35 PM", action: "Paid hash cash", who: "Half Mind" },
  ];
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2 text-xs"
        >
          <span className="shrink-0 font-mono text-muted-foreground/60">
            {e.time}
          </span>
          <span className="text-muted-foreground">
            {e.action}:{" "}
            <span className="font-medium text-foreground/80">{e.who}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ImportVisual() {
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/[0.06]">
          <FileSpreadsheet className="h-5 w-5 text-amber-400" />
        </div>
        <span className="text-[10px] text-muted-foreground">.csv</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="h-px w-4 bg-foreground/20" />
        <div className="h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-foreground/20" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-orange-500/20 bg-orange-500/[0.06] text-xs font-bold text-orange-400">
          HT
        </div>
        <span className="text-[10px] text-muted-foreground">Roster</span>
      </div>
    </div>
  );
}

function InviteVisual() {
  const avatars = [
    { cls: "bg-rose-500/20 text-rose-300", label: "GM" },
    { cls: "bg-rose-400/20 text-rose-200", label: "RA" },
    { cls: "bg-rose-300/20 text-rose-100", label: "HM" },
  ];
  return (
    <div className="flex items-center justify-center -space-x-2">
      {avatars.map((avatar) => (
        <div
          key={avatar.label}
          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-background text-xs font-bold ${avatar.cls}`}
        >
          {avatar.label}
        </div>
      ))}
      <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-foreground/20 bg-foreground/[0.03] text-xs text-muted-foreground">
        +
      </div>
    </div>
  );
}

/* ── Feature data ── */

interface Feature {
  icon: LucideIcon;
  accent: string;
  iconBg: string;
  heading: string;
  description: string;
  visual: React.ReactNode;
}

const features: Feature[] = [
  {
    icon: UserPlus,
    accent: "text-orange-400",
    iconBg: "bg-orange-500/10 border-orange-500/20",
    heading: "One tap, one hasher",
    description:
      "No more typing hash names into a spreadsheet column. Tap a name chip to mark them attended — or search and add anyone from your roster instantly.",
    visual: <ChipVisual />,
  },
  {
    icon: Sparkles,
    accent: "text-emerald-400",
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
    heading: "It learns who shows up",
    description:
      "Frequency, recency, and streak scoring surfaces the hashers most likely to be at today's run. The more you use it, the smarter the suggestions get.",
    visual: <ScoringVisual />,
  },
  {
    icon: Users,
    accent: "text-blue-400",
    iconBg: "bg-blue-500/10 border-blue-500/20",
    heading: "One roster, shared across your pack",
    description:
      "Manage hash names and nerd names in one place. Share a roster across related kennels so you never add the same person twice.",
    visual: <RosterVisual />,
  },
  {
    icon: Shield,
    accent: "text-purple-400",
    iconBg: "bg-purple-500/10 border-purple-500/20",
    heading: "Every edit is tracked",
    description:
      "Full audit log for attendance changes. Know who recorded what, when. No more \"who deleted that row?\" mysteries.",
    visual: <AuditVisual />,
  },
  {
    icon: FileSpreadsheet,
    accent: "text-amber-400",
    iconBg: "bg-amber-500/10 border-amber-500/20",
    heading: "Bring your history forward",
    description:
      "Import years of attendance data from your existing spreadsheets. Smart matching connects imported names to your roster automatically.",
    visual: <ImportVisual />,
  },
  {
    icon: Link2,
    accent: "text-rose-400",
    iconBg: "bg-rose-500/10 border-rose-500/20",
    heading: "Invite your whole mismanagement",
    description:
      "Generate invite links to onboard your co-mismans. Everyone sees the same roster and attendance data.",
    visual: <InviteVisual />,
  },
];

/* ── Main component ── */

export function FeatureShowcase() {
  return (
    <section id="features" className="px-4 py-16 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <FadeInSection>
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Everything you need at the hash
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Built for the circle, not the office. Pull it up on your phone and
            you&apos;re good to go.
          </p>
        </FadeInSection>

        <div className="mt-16 space-y-12 lg:space-y-20">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            const isReversed = i % 2 === 1;

            return (
              <FadeInSection key={feature.heading} delay={i * 60}>
                <div
                  className={`flex flex-col items-center gap-8 lg:flex-row lg:gap-16 ${
                    isReversed ? "lg:flex-row-reverse" : ""
                  }`}
                >
                  {/* Content side */}
                  <div className="flex-1 text-center lg:text-left">
                    <div className="relative inline-block">
                      {/* Watermark number */}
                      <span className="absolute -left-4 -top-6 select-none font-mono text-6xl font-bold text-foreground/[0.04] lg:-left-8 lg:-top-8 lg:text-8xl">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div
                        className={`relative inline-flex h-12 w-12 items-center justify-center rounded-xl border ${feature.iconBg}`}
                      >
                        <Icon className={`h-5 w-5 ${feature.accent}`} />
                      </div>
                    </div>
                    <h3 className="mt-4 text-xl font-bold sm:text-2xl">
                      {feature.heading}
                    </h3>
                    <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground lg:max-w-none">
                      {feature.description}
                    </p>
                  </div>

                  {/* Visual side */}
                  <div className="w-full max-w-sm flex-shrink-0 lg:w-[340px]">
                    <div className="rounded-2xl border border-foreground/[0.07] bg-foreground/[0.02] p-6 shadow-sm">
                      {feature.visual}
                    </div>
                  </div>
                </div>
              </FadeInSection>
            );
          })}
        </div>
      </div>
    </section>
  );
}
