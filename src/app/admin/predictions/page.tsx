import * as Sentry from "@sentry/nextjs";
import { loadLedgerScorecard, loadRuleDriftSnapshot, loadRuleCoverage } from "./data";
import { PredictionsDashboard } from "@/components/admin/PredictionsDashboard";

// Admin-gated by src/app/admin/layout.tsx (getAdminUser). The data loaders below are plain
// async functions (not server actions), so they are never exposed as POST endpoints.
export const dynamic = "force-dynamic";

export default async function PredictionsPage() {
  const [ledger, drift, coverage] = await Promise.allSettled([
    loadLedgerScorecard(),
    loadRuleDriftSnapshot(),
    loadRuleCoverage(),
  ]);

  // Don't let allSettled silently swallow a failing section — surface it for debugging.
  if (ledger.status === "rejected") Sentry.captureException(ledger.reason);
  if (drift.status === "rejected") Sentry.captureException(drift.reason);
  if (coverage.status === "rejected") Sentry.captureException(coverage.reason);

  return (
    <PredictionsDashboard
      ledger={ledger.status === "fulfilled" ? { ok: true, data: ledger.value } : { ok: false }}
      drift={drift.status === "fulfilled" ? { ok: true, data: drift.value } : { ok: false }}
      coverage={coverage.status === "fulfilled" ? { ok: true, data: coverage.value } : { ok: false }}
    />
  );
}
