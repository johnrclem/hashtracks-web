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

  return (
    <PredictionsDashboard
      ledger={ledger.status === "fulfilled" ? { ok: true, data: ledger.value } : { ok: false }}
      drift={drift.status === "fulfilled" ? { ok: true, data: drift.value } : { ok: false }}
      coverage={coverage.status === "fulfilled" ? { ok: true, data: coverage.value } : { ok: false }}
    />
  );
}
