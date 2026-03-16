import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FadeInSection } from "@/components/home/HeroAnimations";

export const metadata: Metadata = {
  title: "About",
  description:
    "HashTracks is the Strava of hashing — aggregated harelines, personal logbooks, and kennel directories for the global hashing community.",
  alternates: { canonical: "https://hashtracks.xyz/about" },
};

export default function AboutPage() {
  return (
    <div className="-mx-4 -mt-8">
      <section className="px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <FadeInSection>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              About HashTracks
            </h1>
          </FadeInSection>

          <FadeInSection delay={100}>
            <div className="mt-8 space-y-6 text-base leading-relaxed text-muted-foreground">
              <p>
                HashTracks aggregates harelines from kennel websites, Google
                Calendars, spreadsheets, and more into one searchable calendar.
                No more checking five different sites to find your next run.
              </p>
              <p>
                Beyond discovery, HashTracks gives every hasher a personal{" "}
                <span className="font-medium text-foreground">logbook</span> to
                track attendance, milestones, and streaks — and optionally link
                Strava activities to each run.
              </p>
              <p>
                For kennel organizers, our{" "}
                <span className="font-medium text-foreground">
                  Misman tools
                </span>{" "}
                replace the spreadsheet with a mobile-first attendance form,
                smart suggestions, shared rosters, and full audit trails.
              </p>
              <p>
                HashTracks is built by hashers, for hashers. We&apos;re a small
                team and we&apos;re actively developing new features based on
                community feedback.
              </p>
            </div>
          </FadeInSection>

          <FadeInSection delay={200}>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:gap-4">
              <Link
                href="/hareline"
                className="group inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition-all hover:gap-3 hover:bg-foreground/90"
              >
                Browse the Hareline
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/for-misman"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-foreground/20 px-6 text-sm font-semibold transition-colors hover:border-foreground/40 hover:bg-foreground/[0.03]"
              >
                For Kennel Organizers
              </Link>
            </div>
          </FadeInSection>
        </div>
      </section>
    </div>
  );
}
