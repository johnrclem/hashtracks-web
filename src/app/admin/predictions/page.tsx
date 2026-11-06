import * as Sentry from "@sentry/nextjs";
import {
  loadLedgerScorecard,
  loadRuleDriftSnapshot,
  loadRuleCoverage,
  loadLeadTime,
  loadUnobservedByKennel,
} from "./data";
import { PredictionsDashboard } from "@/components/admin/PredictionsDashboard";

// Admin-gated by src/app/admin/layout.tsx (getAdminUser). The data loaders below are plain
// async functions (not server actions), so they are never exposed as POST endpoints.
export const dynamic = "force-dynamic";

export default async function PredictionsPage() {
  const [ledger, drift, coverage, leadTime, unobserved] = await Promise.allSettled([
    loadLedgerScorecard(),
    loadRuleDriftSnapshot(),
    loadRuleCoverage(),
    loadLeadTime(),
    loadUnobservedByKennel(),
  ]);

  // Don't let allSettled silently swallow a failing section — surface it for debugging.
  for (const r of [ledger, drift, coverage, leadTime, unobserved]) {
    if (r.status === "rejected") Sentry.captureException(r.reason);
  }

  return (
    <PredictionsDashboard
      ledger={ledger.status === "fulfilled" ? { ok: true, data: ledger.value } : { ok: false }}
      drift={drift.status === "fulfilled" ? { ok: true, data: drift.value } : { ok: false }}
      coverage={coverage.status === "fulfilled" ? { ok: true, data: coverage.value } : { ok: false }}
      leadTime={leadTime.status === "fulfilled" ? { ok: true, data: leadTime.value } : { ok: false }}
      unobserved={unobserved.status === "fulfilled" ? { ok: true, data: unobserved.value } : { ok: false }}
    />
  );
}
