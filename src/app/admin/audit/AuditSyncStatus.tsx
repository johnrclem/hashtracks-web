"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import {
  resyncAuditIssues,
  type AuditSyncFreshness,
  type ResyncAuditIssuesResult,
} from "@/app/admin/audit/actions";

/**
 * Surfaces the freshness of the AuditIssue mirror that feeds every
 * dashboard widget, and offers a one-click re-sync. The mirror is
 * repopulated by a daily cron; when that cron fails (e.g. an expired
 * GITHUB_TOKEN — #1958) the whole dashboard silently freezes. This
 * banner converts that silent freeze into a loud, self-diagnosing
 * signal and gives operators an immediate catch-up path.
 */
export function AuditSyncStatus({
  freshness,
}: Readonly<{
  /** Result of `getAuditSyncFreshness`; null when the probe itself failed. */
  freshness: AuditSyncFreshness | null;
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResyncAuditIssuesResult | null>(null);

  function handleResync() {
    setResult(null);
    startTransition(async () => {
      const res = await resyncAuditIssues();
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  // The probe failing, an empty mirror, or an over-threshold age all
  // warrant the loud treatment — the only "all clear" state is a recent
  // successful sync.
  const stale = freshness === null || freshness.stale;

  const resyncControls = (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={stale ? "default" : "outline"}
        size="sm"
        onClick={handleResync}
        disabled={pending}
        className="shrink-0"
      >
        <RefreshCw className={pending ? "animate-spin" : undefined} />
        {pending ? "Syncing…" : "Re-sync now"}
      </Button>
      <ResyncFeedback result={result} />
    </div>
  );

  if (!stale && freshness?.lastSyncAt) {
    // Healthy: subtle one-liner with a quiet re-sync affordance.
    return (
      <div className="mb-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Audit mirror synced {formatRelativeTime(freshness.lastSyncAt)}.
        </span>
        {resyncControls}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              {stalenessHeadline(freshness)}
            </p>
            <p className="text-muted-foreground">
              Every widget below reads from the GitHub audit mirror, which a
              daily cron refreshes. The sync has not succeeded recently — most
              likely an expired <code className="font-mono">GITHUB_TOKEN</code>.
              Rotate the token in Vercel, then re-sync.
            </p>
          </div>
        </div>
        {resyncControls}
      </div>
    </div>
  );
}

/** Inline success/error feedback for the last re-sync attempt. */
function ResyncFeedback({ result }: Readonly<{ result: ResyncAuditIssuesResult | null }>) {
  if (!result) return null;
  if (result.ok) {
    const r = result.result;
    const summary = `Synced ${r.scanned} issues (${r.opened} opened, ${r.closed} closed)`;
    // A non-throwing sync can still skip individual issues (per-issue
    // errors collected in result.errors — the cron treats this as 207,
    // not 200). Surface it as a warning so "Synced" never implies a
    // clean run when some issues were dropped.
    if (r.errors.length > 0) {
      return (
        <span className="max-w-xs text-right text-xs text-amber-600 dark:text-amber-400">
          {summary} — {r.errors.length} skipped; see server logs.
        </span>
      );
    }
    return (
      <span className="text-right text-xs text-emerald-600 dark:text-emerald-400">
        {summary}.
      </span>
    );
  }
  return (
    <span className="max-w-xs text-right text-xs text-destructive">
      Re-sync failed: {result.error}
    </span>
  );
}

/** Headline that quantifies how stale the mirror is. */
function stalenessHeadline(freshness: AuditSyncFreshness | null): string {
  if (freshness === null) {
    return "Audit sync status unavailable.";
  }
  if (freshness.lastSyncAt === null || freshness.ageHours === null) {
    return "Audit mirror has never been synced.";
  }
  const days = Math.floor(freshness.ageHours / 24);
  let age: string;
  if (days >= 1) {
    age = `${days} day${days === 1 ? "" : "s"}`;
  } else {
    age = `${Math.floor(freshness.ageHours)}h`;
  }
  return `Audit dashboard data is ${age} stale (last synced ${formatRelativeTime(freshness.lastSyncAt)}).`;
}
