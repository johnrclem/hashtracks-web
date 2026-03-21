"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { QuickAddDialog } from "./QuickAddDialog";
import { LogUnlistedRunDialog } from "./LogUnlistedRunDialog";
import { StravaBackfillWizard } from "./StravaBackfillWizard";
import { ClipboardList, Search, PenLine, ExternalLink } from "lucide-react";
import Link from "next/link";

// ─── Tier 1: Full Onboarding (0 runs) ───────────────────────────────

interface LogbookOnboardingProps {
  readonly stravaConnected: boolean;
}

export function LogbookOnboarding({ stravaConnected }: LogbookOnboardingProps) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [unlistedOpen, setUnlistedOpen] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);

  return (
    <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
      {/* Icon */}
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-blue-50">
        <ClipboardList size={28} className="text-emerald-600" />
      </div>

      {/* Heading */}
      <h2 className="text-xl font-bold">Start Your Logbook</h2>
      <p className="mx-auto mb-7 mt-2 max-w-md text-sm text-muted-foreground">
        Track every run, see your stats grow, and never forget a trail.
      </p>

      {/* Strava connect banner (only when not connected) */}
      {!stravaConnected && (
        <div className="mb-4 rounded-xl border border-dashed border-strava bg-strava/5 p-3">
          <a
            href="/api/auth/strava"
            className="text-sm font-medium text-strava hover:underline"
          >
            Connect Strava to auto-discover hash runs &rarr;
          </a>
        </div>
      )}

      {/* CTA grid */}
      <div
        className={`grid gap-4 ${
          stravaConnected ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"
        }`}
      >
        {/* Find a Run */}
        <button
          type="button"
          onClick={() => setQuickAddOpen(true)}
          className="rounded-xl border p-5 text-center cursor-pointer transition hover:border-muted-foreground hover:shadow-sm"
        >
          <Search size={24} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-semibold">Find a Run</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Search the hareline for events you attended
          </p>
        </button>

        {/* Log Unlisted Run */}
        <button
          type="button"
          onClick={() => setUnlistedOpen(true)}
          className="rounded-xl border p-5 text-center cursor-pointer transition hover:border-muted-foreground hover:shadow-sm"
        >
          <PenLine size={24} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-semibold">Log Unlisted Run</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a run that isn&apos;t on the hareline yet
          </p>
        </button>

        {/* Sync from Strava (only when connected) */}
        {stravaConnected && (
          <button
            type="button"
            onClick={() => setBackfillOpen(true)}
            className="rounded-xl border border-strava bg-strava/5 p-5 text-center cursor-pointer transition hover:border-strava/80 hover:shadow-sm"
          >
            <ExternalLink size={24} className="mx-auto mb-2 text-strava" />
            <p className="text-sm font-semibold">Sync from Strava</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Review recent activities and link them to runs
            </p>
          </button>
        )}
      </div>

      {/* Footer link */}
      <p className="mt-6 text-sm text-muted-foreground">
        Or{" "}
        <Link href="/hareline" className="text-blue-500 hover:text-blue-600 transition-colors">
          browse upcoming runs and RSVP
        </Link>
      </p>

      {/* Dialogs */}
      <QuickAddDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onRequestUnlistedRun={() => {
          setQuickAddOpen(false);
          setUnlistedOpen(true);
        }}
      />
      <LogUnlistedRunDialog
        open={unlistedOpen}
        onOpenChange={setUnlistedOpen}
      />
      <StravaBackfillWizard
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
      />
    </div>
  );
}

// ─── Tier 2: Strava Connect Banner (1-19 runs, no Strava) ───────────

const STRAVA_CONNECT_KEY = "hashtracks:strava-connect-dismissed";

export function StravaConnectBanner() {
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash

  useEffect(() => {
    const stored = localStorage.getItem(STRAVA_CONNECT_KEY);
    setDismissed(stored === "true");
  }, []);

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(STRAVA_CONNECT_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-strava/30 bg-strava/5 p-4">
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-strava">
        <ExternalLink size={18} className="text-white" />
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          Connect Strava to auto-discover hash runs
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          We&apos;ll match your activities to hash events for one-tap check-in.
        </p>
      </div>

      {/* Buttons */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          asChild
          size="sm"
          className="bg-strava text-white hover:bg-strava/90 h-8 text-xs px-3"
        >
          <a href="/api/auth/strava">Connect</a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs px-2 text-muted-foreground"
          onClick={handleDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

// ─── Tier 3: Quick Start Guide (1-19 runs) ──────────────────────────

const QUICKSTART_KEY = "hashtracks:quickstart-dismissed";

export function QuickStartGuide() {
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash

  useEffect(() => {
    const stored = localStorage.getItem(QUICKSTART_KEY);
    setDismissed(stored === "true");
  }, []);

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(QUICKSTART_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">&#128161;</span>
          <span className="text-sm font-semibold">
            Getting the most out of your logbook
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2 text-muted-foreground"
          onClick={handleDismiss}
        >
          Hide forever
        </Button>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold">+ Add Run</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Search the hareline for events you attended, or log a run at any kennel.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold">Strava Suggestions</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When we detect a Strava activity near a hash event, we&apos;ll suggest it for one-tap check-in.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold">View Stats</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Track your milestones, see runs by kennel and region, and celebrate your 25th, 50th, 69th, and 100th runs.
          </p>
        </div>
      </div>
    </div>
  );
}
