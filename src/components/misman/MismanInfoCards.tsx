"use client";

import Link from "next/link";
import { Building2, Users, MessageSquare, LinkIcon } from "lucide-react";

const cards = [
  {
    icon: Building2,
    title: "Missing a kennel?",
    description: "Request misman access for another kennel you manage.",
    href: "/misman",
    cta: "Request access",
  },
  {
    icon: Users,
    title: "Same pack, different kennels?",
    description: "Share a roster so you enter each hasher once.",
    href: "/misman",
    cta: "Request shared roster",
  },
  {
    icon: MessageSquare,
    title: "Share feedback",
    description: "Tell us what's working and what's missing.",
    href: "/misman",
    cta: "Give feedback",
  },
  {
    icon: LinkIcon,
    title: "Invite your co-mismans",
    description: "Generate invite links for other kennel managers.",
    href: "/misman",
    cta: "Create invite",
  },
];

export function MismanInfoCards() {
  return (
    <div className="relative">
      {/* Scroll fade indicators */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-background to-transparent sm:hidden" />
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              href={card.href}
              className="group snap-start min-w-[260px] shrink-0 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border"
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {card.title}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {card.description}
              </p>
              <span className="mt-3 inline-block text-xs font-medium text-foreground group-hover:text-orange-500 transition-colors">
                {card.cta} &rarr;
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
