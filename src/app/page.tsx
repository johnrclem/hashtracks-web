import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { formatDateShort, formatTimeCompact } from "@/lib/format";
import {
  AnimatedCounter,
  FadeInSection,
  PulseDot,
  RegionTicker,
} from "@/components/home/HeroAnimations";
import { Calendar, BookOpen, Users, MapPin, ArrowRight, Beer, Zap, Globe } from "lucide-react";

export default async function HomePage() {
  const clerkUser = await currentUser();
  const userId = clerkUser?.id ?? null;

  const now = new Date();
  const todayUtcNoon = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0)
  );

  const [upcomingCount, kennelCount, regionCount, nextEvents, regionNames] =
    await Promise.all([
      prisma.event.count({
        where: { date: { gte: todayUtcNoon }, status: { not: "CANCELLED" }, kennel: { isHidden: false } },
      }),
      prisma.kennel.count({ where: { isHidden: false } }),
      prisma.kennel
        .findMany({ where: { isHidden: false }, select: { regionId: true }, distinct: ["regionId"] })
        .then((rows) => rows.length),
      prisma.event.findMany({
        where: { date: { gte: todayUtcNoon }, status: { not: "CANCELLED" }, kennel: { isHidden: false } },
        select: {
          id: true,
          date: true,
          runNumber: true,
          title: true,
          haresText: true,
          startTime: true,
          locationName: true,
          kennel: { select: { shortName: true, fullName: true, region: true } },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
        take: 6,
      }),
      prisma.region
        .findMany({
          where: { level: "METRO" },
          select: { name: true },
          orderBy: { name: "asc" },
        })
        .then((rows) => rows.map((r) => r.name)),
    ]);

  return (
    <div className="-mx-4 -mt-8">
      {/* ═══════════════════════════════════════════════
          HERO
       ═══════════════════════════════════════════════ */}
      <section className="relative overflow-hidden px-4 pb-16 pt-12 sm:pt-20 sm:pb-24">
        {/* Background texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />

        {/* Gradient orbs */}
        <div className="pointer-events-none absolute -top-40 left-1/4 h-80 w-80 rounded-full bg-orange-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-1/4 h-64 w-64 rounded-full bg-rose-200/20 blur-3xl" />

        <div className="relative mx-auto max-w-5xl text-center">
          {/* Main headline */}
          <FadeInSection>
            <h1 className="mx-auto max-w-3xl text-5xl font-extrabold tracking-tight sm:text-7xl">
              Find your next
              <span className="relative mx-2 inline-block">
                <span className="relative z-10">trail</span>
                <span
                  className="absolute -bottom-1 left-0 right-0 z-0 h-3 rounded-sm bg-orange-300/50 sm:h-4"
                  aria-hidden="true"
                />
              </span>
              before the beer gets warm
            </h1>
          </FadeInSection>

          {/* Subhead */}
          <FadeInSection delay={100}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              HashTracks aggregates harelines from{" "}
              <span className="font-semibold text-foreground">{kennelCount}</span>{" "}
              kennels into one calendar. Discover runs, track your attendance,
              and never miss circle again.
            </p>
          </FadeInSection>

          {/* CTA buttons */}
          <FadeInSection delay={200}>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              {userId ? (
                <>
                  <Link
                    href="/hareline"
                    className="group inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-8 text-sm font-semibold text-background transition-all hover:gap-3 hover:bg-foreground/90"
                  >
                    View Hareline
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    href="/logbook"
                    className="inline-flex h-12 items-center gap-2 rounded-full border border-foreground/20 px-8 text-sm font-semibold transition-colors hover:border-foreground/40 hover:bg-foreground/[0.03]"
                  >
                    My Logbook
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/sign-up"
                    className="group inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-8 text-sm font-semibold text-background transition-all hover:gap-3 hover:bg-foreground/90"
                  >
                    Get Started — It&apos;s Free
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    href="/hareline"
                    className="inline-flex h-12 items-center gap-2 rounded-full border border-foreground/20 px-8 text-sm font-semibold transition-colors hover:border-foreground/40 hover:bg-foreground/[0.03]"
                  >
                    Browse Events
                  </Link>
                </>
              )}
            </div>
          </FadeInSection>

          {/* Live stats bar */}
          <FadeInSection delay={300}>
            <div className="mx-auto mt-14 flex max-w-lg flex-wrap items-center justify-center gap-8 sm:gap-12">
              <div className="text-center">
                <div className="text-3xl font-bold tracking-tight sm:text-4xl">
                  <AnimatedCounter target={upcomingCount} />
                </div>
                <div className="mt-1 flex items-center justify-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Upcoming Runs <PulseDot />
                </div>
              </div>
              <div className="h-8 w-px bg-foreground/10" aria-hidden="true" />
              <div className="text-center">
                <div className="text-3xl font-bold tracking-tight sm:text-4xl">
                  <AnimatedCounter target={kennelCount} />
                </div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Kennels
                </div>
              </div>
              <div className="h-8 w-px bg-foreground/10" aria-hidden="true" />
              <div className="text-center">
                <div className="text-3xl font-bold tracking-tight sm:text-4xl">
                  <AnimatedCounter target={regionCount} />
                </div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Regions
                </div>
              </div>
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          REGION TICKER
       ═══════════════════════════════════════════════ */}
      {regionNames.length > 0 && (
        <div className="border-y border-foreground/5 bg-foreground/[0.015]">
          <RegionTicker regions={regionNames} />
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          COMING UP — LIVE EVENT FEED
       ═══════════════════════════════════════════════ */}
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <FadeInSection>
            <div className="mb-8 flex items-end justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Coming Up
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Next runs across all kennels
                </p>
              </div>
              <Link
                href="/hareline"
                className="group hidden items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:flex"
              >
                Full hareline
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </FadeInSection>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {nextEvents.map((event, i) => (
              <FadeInSection key={event.id} delay={i * 80}>
                <Link
                  href={`/hareline/${event.id}`}
                  className="group block rounded-xl border border-foreground/[0.07] bg-background p-4 shadow-sm transition-all hover:border-foreground/15 hover:shadow-md"
                >
                  {/* Date strip */}
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {formatDateShort(event.date.toISOString())}
                    </span>
                    <RegionBadge region={event.kennel.region} size="sm" />
                  </div>

                  {/* Kennel + run number */}
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-bold group-hover:text-orange-700 transition-colors">
                      {event.kennel.shortName}
                    </span>
                    {event.runNumber != null && (
                      <span className="text-sm text-muted-foreground">
                        #{event.runNumber}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  {event.title && (
                    <p className="mt-1 truncate text-sm text-foreground/80">
                      {event.title}
                    </p>
                  )}

                  {/* Meta row */}
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    {event.startTime && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatTimeCompact(event.startTime)}
                      </span>
                    )}
                    {event.locationName && (
                      <span className="flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{event.locationName}</span>
                      </span>
                    )}
                  </div>
                </Link>
              </FadeInSection>
            ))}
          </div>

          <div className="mt-6 text-center sm:hidden">
            <Link
              href="/hareline"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground"
            >
              View all events <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          VALUE PROPS — THREE PILLARS
       ═══════════════════════════════════════════════ */}
      <section className="border-t border-foreground/5 bg-foreground/[0.015] px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <FadeInSection>
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              One place for everything hash
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-center text-muted-foreground">
              No more checking five different websites, spreadsheets, and Facebook
              groups to find your next run.
            </p>
          </FadeInSection>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {/* Discover */}
            <FadeInSection delay={0}>
              <div className="group relative rounded-2xl border border-foreground/[0.07] bg-background p-6 transition-all hover:border-foreground/15 hover:shadow-md">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
                  <Calendar className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold">Discover</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Every hareline, every kennel, one calendar. Filter by day,
                  region, or distance. List, calendar, or map view.
                </p>
                <Link
                  href="/hareline"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-orange-700 transition-colors hover:text-orange-800"
                >
                  Browse the hareline <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </FadeInSection>

            {/* Track */}
            <FadeInSection delay={100}>
              <div className="group relative rounded-2xl border border-foreground/[0.07] bg-background p-6 transition-all hover:border-foreground/15 hover:shadow-md">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <BookOpen className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold">Track</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Log attendance, link Strava activities, and build your personal
                  hashing history. See stats, milestones, and streaks.
                </p>
                <Link
                  href={userId ? "/logbook" : "/sign-up"}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800"
                >
                  {userId ? "Open your logbook" : "Start tracking"}{" "}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </FadeInSection>

            {/* Connect */}
            <FadeInSection delay={200}>
              <div className="group relative rounded-2xl border border-foreground/[0.07] bg-background p-6 transition-all hover:border-foreground/15 hover:shadow-md">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold">Connect</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Subscribe to your home kennels. Find new ones when you travel.{" "}
                  {kennelCount} kennels across {regionCount} regions and counting.
                </p>
                <Link
                  href="/kennels"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 transition-colors hover:text-blue-800"
                >
                  Explore kennels <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </FadeInSection>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          SOCIAL PROOF / WHY HASHTRACKS
       ═══════════════════════════════════════════════ */}
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <FadeInSection>
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              Built different
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-center text-muted-foreground">
              HashTracks automatically pulls events from kennel websites, Google
              Calendars, spreadsheets, and more — so the hareline is always up to date.
            </p>
          </FadeInSection>

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            <FadeInSection delay={0}>
              <div className="flex gap-4 rounded-xl border border-foreground/[0.07] p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05]">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Auto-updated harelines</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Events are scraped daily from 41 sources. No manual data entry.
                  </p>
                </div>
              </div>
            </FadeInSection>

            <FadeInSection delay={80}>
              <div className="flex gap-4 rounded-xl border border-foreground/[0.07] p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-lg">
                  <Beer className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Strava integration</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Link your Strava activities to runs with one click. Unique in hashing.
                  </p>
                </div>
              </div>
            </FadeInSection>

            <FadeInSection delay={160}>
              <div className="flex gap-4 rounded-xl border border-foreground/[0.07] p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05]">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Works everywhere</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Web-first. No app to install. Open it on your phone, laptop, anything.
                  </p>
                </div>
              </div>
            </FadeInSection>

            <FadeInSection delay={240}>
              <div className="flex gap-4 rounded-xl border border-foreground/[0.07] p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05]">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Calendar export</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add runs to Google Calendar or any .ics-compatible app with one click.
                  </p>
                </div>
              </div>
            </FadeInSection>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FINAL CTA
       ═══════════════════════════════════════════════ */}
      <section className="border-t border-foreground/5 bg-foreground/[0.015] px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <FadeInSection>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              On&mdash;on!
            </h2>
            <p className="mt-3 text-muted-foreground">
              {userId
                ? "Your hareline is waiting. Go find your next trail."
                : "Join the pack. Find runs, track your hashes, never miss circle."}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              {userId ? (
                <Link
                  href="/hareline"
                  className="group inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-8 text-sm font-semibold text-background transition-all hover:gap-3 hover:bg-foreground/90"
                >
                  View Hareline
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/sign-up"
                    className="group inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-8 text-sm font-semibold text-background transition-all hover:gap-3 hover:bg-foreground/90"
                  >
                    Get Started — It&apos;s Free
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    href="/sign-in"
                    className="inline-flex h-12 items-center rounded-full border border-foreground/20 px-8 text-sm font-semibold transition-colors hover:border-foreground/40 hover:bg-foreground/[0.03]"
                  >
                    Sign In
                  </Link>
                </>
              )}
            </div>
          </FadeInSection>
        </div>
      </section>
    </div>
  );
}
