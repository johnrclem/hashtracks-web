import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import {
  AnimatedCounter,
  FadeInSection,
} from "@/components/home/HeroAnimations";
import { MismanHero } from "@/components/misman/landing/MismanHero";
import { FeatureShowcase } from "@/components/misman/landing/FeatureShowcase";
import { HowItWorks } from "@/components/misman/landing/HowItWorks";
import { MismanCTA, type CTAState } from "@/components/misman/landing/MismanCTA";
import { ArrowRight, Lightbulb } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Misman — Attendance Tools for Kennel Organizers · HashTracks",
  description:
    "Mobile-first attendance recording, smart suggestions, roster management, and audit trails for hash kennel mismanagement.",
};

export default async function MismanAboutPage() {
  // Run auth + stats in parallel (stats don't depend on auth)
  const [clerkUser, [attendanceCount, mismanKennelCount, rosterCount]] =
    await Promise.all([
      currentUser(),
      Promise.all([
        prisma.kennelAttendance.count(),
        prisma.userKennel
          .groupBy({
            by: ["kennelId"],
            where: { role: { in: ["MISMAN", "ADMIN"] } },
          })
          .then((groups) => groups.length),
        prisma.kennelHasher.count(),
      ]),
    ]);

  // Determine CTA state (site admins get automatic misman access)
  let ctaState: CTAState = "unauthenticated";
  if (clerkUser) {
    const metadata = clerkUser.publicMetadata as { role?: string } | null;
    if (metadata?.role === "admin") {
      ctaState = "misman";
    } else {
      const mismanRole = await prisma.userKennel.findFirst({
        where: {
          user: { clerkId: clerkUser.id },
          role: { in: ["MISMAN", "ADMIN"] },
        },
      });
      ctaState = mismanRole ? "misman" : "authenticated";
    }
  }

  return (
    <div className="-mx-4 -mt-8">
      {/* ═══ HERO ═══ */}
      <MismanHero ctaState={ctaState} />

      {/* ═══ STATS BAR ═══ */}
      <div className="border-y border-foreground/5 bg-foreground/[0.015]">
        <div className="mx-auto flex max-w-lg flex-wrap items-center justify-center gap-8 py-8 sm:gap-12">
          <FadeInSection>
            <div className="text-center">
              <div className="text-3xl font-bold tracking-tight sm:text-4xl">
                <AnimatedCounter target={attendanceCount} />
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Attendance Records
              </div>
            </div>
          </FadeInSection>

          <div className="h-8 w-px bg-foreground/10" aria-hidden="true" />

          <FadeInSection delay={100}>
            <div className="text-center">
              <div className="text-3xl font-bold tracking-tight sm:text-4xl">
                <AnimatedCounter target={mismanKennelCount} />
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Active Kennels
              </div>
            </div>
          </FadeInSection>

          <div className="h-8 w-px bg-foreground/10" aria-hidden="true" />

          <FadeInSection delay={200}>
            <div className="text-center">
              <div className="text-3xl font-bold tracking-tight sm:text-4xl">
                <AnimatedCounter target={rosterCount} />
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Hashers on Rosters
              </div>
            </div>
          </FadeInSection>
        </div>
      </div>

      {/* ═══ FEATURES ═══ */}
      <FeatureShowcase />

      {/* ═══ HOW IT WORKS ═══ */}
      <HowItWorks />

      {/* ═══ FEEDBACK CALLOUT ═══ */}
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <FadeInSection>
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/[0.05]">
              <Lightbulb className="h-5 w-5 text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Help us build this for you
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Misman is actively evolving. We&apos;re building this alongside
              the kennel organizers who use it — your feedback shapes what comes
              next. Tell us what&apos;s working, what&apos;s missing, and what
              would make your life easier.
            </p>
            <Link
              href={clerkUser ? "/misman" : "/sign-up"}
              className="group mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-500 transition-colors hover:text-orange-400"
            >
              Share your feedback
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </FadeInSection>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="border-t border-foreground/5 bg-foreground/[0.015] px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <FadeInSection>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Ready to ditch the spreadsheet?
            </h2>
            <p className="mt-3 text-muted-foreground">
              {ctaState === "misman"
                ? "Your dashboard is waiting. Go manage your kennels."
                : ctaState === "authenticated"
                  ? "Request misman access for your kennel and start recording attendance today."
                  : "Join HashTracks and start managing your kennel's attendance the easy way."}
            </p>
            <div className="mt-8">
              <MismanCTA state={ctaState} variant="footer" />
            </div>
          </FadeInSection>
        </div>
      </section>
    </div>
  );
}
