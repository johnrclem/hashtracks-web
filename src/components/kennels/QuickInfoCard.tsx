"use client";

import Link from "next/link";
import { useState } from "react";
import { formatSchedule, displayDomain, type ScheduleSlot } from "@/lib/format";
import { SocialLinks } from "@/components/kennels/SocialLinks";
import {
  Calendar,
  Banknote,
  Globe,
  Landmark,
  Dog,
  Footprints,
  ChevronDown,
  Crown,
  Megaphone,
  PartyPopper,
  Sparkles,
  GitFork,
} from "lucide-react";

interface QuickInfoCardProps {
  kennel: {
    scheduleDayOfWeek: string | null;
    scheduleTime: string | null;
    scheduleFrequency: string | null;
    scheduleRules?: ScheduleSlot[] | null;
    scheduleNotes: string | null;
    hashCash: string | null;
    paymentLink: string | null;
    website: string | null;
    foundedYear: number | null;
    dogFriendly: boolean | null;
    walkersWelcome: boolean | null;
    // Social fields for unified card
    facebookUrl: string | null;
    instagramHandle: string | null;
    twitterHandle: string | null;
    discordUrl: string | null;
    mailingListUrl: string | null;
    contactEmail: string | null;
    contactName: string | null;
    // Profile fields (#1415)
    gm: string | null;
    hareRaiser: string | null;
    signatureEvent: string | null;
    founder: string | null;
    parentKennelCode: string | null;
    // Description
    description: string | null;
  };
  // Resolved parent kennel for parentKennelCode lookup (#1415). Null when the
  // code references a kennel not present in our DB — falls back to raw text.
  parentKennel?: { slug: string; shortName: string } | null;
  regionColor?: string;
}

const DESC_TRUNCATE_LENGTH = 200;

export function QuickInfoCard({ kennel, parentKennel, regionColor }: QuickInfoCardProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const schedule = formatSchedule(kennel);

  const hasInfoData =
    schedule ||
    kennel.hashCash ||
    kennel.website ||
    kennel.foundedYear ||
    kennel.dogFriendly === true ||
    kennel.walkersWelcome === true ||
    kennel.gm ||
    kennel.hareRaiser ||
    kennel.signatureEvent ||
    kennel.founder ||
    kennel.parentKennelCode;

  const hasSocialData =
    kennel.facebookUrl ||
    kennel.instagramHandle ||
    kennel.twitterHandle ||
    kennel.discordUrl ||
    kennel.mailingListUrl ||
    kennel.contactEmail ||
    kennel.contactName;

  const hasDescription = !!kennel.description;
  const descIsLong =
    kennel.description && kennel.description.length > DESC_TRUNCATE_LENGTH;

  if (!hasInfoData && !hasSocialData && !hasDescription) return null;

  return (
    <div
      className="rounded-xl border border-border/50 bg-card overflow-hidden"
      style={
        regionColor
          ? {
              borderLeftWidth: 3,
              borderLeftColor: regionColor,
            }
          : undefined
      }
    >
      <div className="p-4 sm:p-5 space-y-4">
        {/* Info rows */}
        {hasInfoData && (
          <div className="space-y-2.5">
            {schedule && (
              <div className="flex items-center gap-2.5 text-sm">
                <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>{schedule}</span>
              </div>
            )}
            {kennel.scheduleNotes && (
              <p className="ml-[26px] text-xs text-muted-foreground">
                {kennel.scheduleNotes}
              </p>
            )}

            {kennel.hashCash && (
              <div className="flex items-center gap-2.5 text-sm">
                <Banknote className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>{kennel.hashCash} hash cash</span>
                {kennel.paymentLink && (
                  <a
                    href={kennel.paymentLink.startsWith("http") ? kennel.paymentLink : "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Pay online &rarr;
                  </a>
                )}
              </div>
            )}

            {kennel.website && (
              <div className="flex items-center gap-2.5 text-sm">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <a
                  href={kennel.website.startsWith("http") ? kennel.website : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {displayDomain(kennel.website)}
                </a>
              </div>
            )}

            {kennel.foundedYear && (
              <div className="flex items-center gap-2.5 text-sm">
                <Landmark className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>Est. {kennel.foundedYear}</span>
              </div>
            )}

            {(kennel.dogFriendly === true ||
              kennel.walkersWelcome === true) && (
              <div className="flex items-center gap-3 text-sm">
                {kennel.dogFriendly === true && (
                  <span className="flex items-center gap-1.5">
                    <Dog className="h-4 w-4 text-muted-foreground/70" />
                    Dog friendly
                  </span>
                )}
                {kennel.walkersWelcome === true && (
                  <span className="flex items-center gap-1.5">
                    <Footprints className="h-4 w-4 text-muted-foreground/70" />
                    Walkers welcome
                  </span>
                )}
              </div>
            )}

            {kennel.gm && (
              <div className="flex items-center gap-2.5 text-sm">
                <Crown className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>GM: {kennel.gm}</span>
              </div>
            )}

            {kennel.hareRaiser && (
              <div className="flex items-center gap-2.5 text-sm">
                <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>Hare raiser: {kennel.hareRaiser}</span>
              </div>
            )}

            {kennel.signatureEvent && (
              <div className="flex items-center gap-2.5 text-sm">
                <PartyPopper className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>Signature event: {kennel.signatureEvent}</span>
              </div>
            )}

            {kennel.founder && (
              <div className="flex items-center gap-2.5 text-sm">
                <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>Founder: {kennel.founder}</span>
              </div>
            )}

            {kennel.parentKennelCode && (
              <div className="flex items-center gap-2.5 text-sm">
                <GitFork className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>
                  Parent kennel:{" "}
                  {parentKennel ? (
                    <Link href={`/kennels/${parentKennel.slug}`} className="text-primary hover:underline">
                      {parentKennel.shortName}
                    </Link>
                  ) : (
                    kennel.parentKennelCode
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Description */}
        {hasDescription && (
          <>
            {hasInfoData && (
              <hr className="border-border/40" />
            )}
            <div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {descIsLong && !descExpanded
                  ? kennel.description!.slice(0, DESC_TRUNCATE_LENGTH) + "..."
                  : kennel.description}
              </p>
              {descIsLong && (
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                  onClick={() => setDescExpanded(!descExpanded)}
                >
                  {descExpanded ? "Show less" : "Read more"}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${descExpanded ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </div>
          </>
        )}

        {/* Social links */}
        {hasSocialData && (
          <>
            {(hasInfoData || hasDescription) && (
              <hr className="border-border/40" />
            )}
            <SocialLinks kennel={kennel} />
          </>
        )}
      </div>
    </div>
  );
}
