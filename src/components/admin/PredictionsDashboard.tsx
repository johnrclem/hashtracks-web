"use client";

import { useState, useTransition } from "react";
import {
  Target,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  CircleSlash,
  ShieldQuestion,
  CalendarClock,
  RefreshCw,
  AlertTriangle,
  Layers,
  CalendarRange,
  Hash,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { StatCard, SectionHeader } from "./dashboard-shared";
import { recomputeRuleDrift } from "@/app/admin/predictions/actions";
import type {
  LedgerScorecard,
  RuleDriftView,
  RuleCoverage,
} from "@/app/admin/predictions/data";

type Loadable<T> = { ok: true; data: T } | { ok: false };

interface Props {
  ledger: Loadable<LedgerScorecard>;
  drift: Loadable<RuleDriftView>;
  coverage: Loadable<RuleCoverage>;
}

const DAY_MS = 86_400_000;

/** Deterministic UTC date format (no hydration drift). */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function addDaysISO(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

function ErrorCard({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-500">
      <AlertTriangle className="mb-1 inline h-4 w-4" /> Failed to load {what}.
    </div>
  );
}

// ── Horizon-maturity timeline (hero) ─────────────────────────────────────────
const BANDS: { band: number; bin: string }[] = [
  { band: 30, bin: "0–45" },
  { band: 90, bin: "46–120" },
  { band: 180, bin: "121–200" },
];

function MaturityTimeline({ ledger }: { ledger: LedgerScorecard }) {
  const scoredBins = new Set(
    ledger.precision.filter((c) => c.hit + c.miss > 0).map((c) => c.bin),
  );
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {BANDS.map(({ band, bin }) => {
        const eta = ledger.firstSnapshotISO ? addDaysISO(ledger.firstSnapshotISO, band) : null;
        const status = ledger.total === 0 ? "idle" : scoredBins.has(bin) ? "scoring" : "maturing";
        const tone =
          status === "scoring"
            ? "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-500"
            : status === "maturing"
              ? "border-amber-500/40 bg-amber-500/[0.07] text-amber-500"
              : "border-border/60 bg-muted/30 text-muted-foreground";
        const label = status === "scoring" ? "Scoring" : status === "maturing" ? "Maturing" : "Not started";
        return (
          <div key={band} className={`rounded-xl border p-4 transition-colors ${tone}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider">{band}-day band</span>
              <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
            </div>
            <div className="mt-2 text-lg font-bold tracking-tight text-foreground">
              {status === "scoring" ? "Scores in" : "First scores"}
            </div>
            <div className="text-sm text-muted-foreground">
              {eta ? `~${fmtDate(eta)}` : "awaiting first snapshot"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Precision heatmap ────────────────────────────────────────────────────────
const BINS = ["0–45", "46–120", "121–200"] as const;

function precisionBg(p: number | null): string {
  if (p === null) return "transparent";
  // single-hue emerald ramp; min 0.08 so even low precision reads as "has data"
  return `rgba(16, 185, 129, ${(0.08 + p * 0.5).toFixed(3)})`;
}

function PrecisionHeatmap({ ledger }: { ledger: LedgerScorecard }) {
  const cell = (conf: "HIGH" | "MEDIUM", bin: string) =>
    ledger.precision.find((c) => c.confidence === conf && c.bin === bin);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left font-medium">Confidence</th>
            {BINS.map((b) => (
              <th key={b} className="px-2 text-center font-medium">{b} days out</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(["HIGH", "MEDIUM"] as const).map((conf) => (
            <tr key={conf}>
              <td className="py-1 pr-2 font-semibold">{conf}</td>
              {BINS.map((bin) => {
                const c = cell(conf, bin);
                const p = c?.precision ?? null;
                return (
                  <td
                    key={bin}
                    className="rounded-md border border-border/40 px-2 py-2 text-center align-middle tabular-nums"
                    style={{ backgroundColor: precisionBg(p) }}
                  >
                    {p === null ? (
                      <span className="text-muted-foreground/60">—</span>
                    ) : (
                      <>
                        <div className="font-bold">{Math.round(p * 100)}%</div>
                        <div className="text-[10px] text-muted-foreground">{c!.hit}H / {c!.miss}M</div>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Rule-drift section ───────────────────────────────────────────────────────
function DriftSection({ drift }: { drift: RuleDriftView }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onRecompute = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await recomputeRuleDrift();
      setMsg(r.ok ? { ok: true, text: `Re-ran — ${r.driftCount} drifted kennel(s).` } : { ok: false, text: r.error });
    });
  };

  const { findings, ranAtISO, everRun } = drift;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader icon={Target} title="Rule-drift findings" color="bg-amber-500/10 text-amber-500" />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {everRun && <span>last checked {fmtDate(ranAtISO)}</span>}
          <button
            onClick={onRecompute}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
            {isPending ? "Re-running…" : "Re-run now"}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
          {msg.text}
        </div>
      )}

      {!everRun ? (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
          The weekly rule-drift check hasn&apos;t run yet — it runs Mondays, or use “Re-run now”.
        </div>
      ) : findings.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-sm text-emerald-600">
          <CheckCircle className="mb-0.5 mr-1 inline h-4 w-4" /> No drift — every active rule agrees with recent reality.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Kennel</th>
                <th className="px-3 py-2 text-left">Region</th>
                <th className="px-3 py-2 text-left">Rule predicts</th>
                <th className="px-3 py-2 text-left">Recent actual</th>
                <th className="px-3 py-2 text-left">Active rule(s)</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.kennelCode} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{f.shortName} <span className="text-muted-foreground">({f.kennelCode})</span></td>
                  <td className="px-3 py-2 text-muted-foreground">{f.region}</td>
                  <td className="px-3 py-2">{f.predictedWeekdays.join("/")}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-amber-600">{f.actualWeekday}</span>{" "}
                    <span className="text-muted-foreground">({Math.round(f.actualShare * 100)}%, {f.recentEventCount} ev)</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{f.activeRules}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <a
        href="https://github.com/johnrclem/hashtracks-web/issues?q=is%3Aissue+label%3Arule-drift"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-muted-foreground underline hover:text-foreground"
      >
        View rule-drift issues on GitHub →
      </a>
    </section>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export function PredictionsDashboard({ ledger, drift, coverage }: Props) {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Prediction Quality</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Forward calibration of Travel Mode predictions, measured against reality as cohorts mature — plus live rule-drift and schedule-rule coverage.
        </p>
      </div>

      {/* ── Ledger ── */}
      <section className="space-y-5">
        <SectionHeader icon={Activity} title="Forward-prediction ledger" color="bg-blue-500/10 text-blue-500" />
        {!ledger.ok ? (
          <ErrorCard what="the prediction ledger" />
        ) : (
          <>
            <MaturityTimeline ledger={ledger.data} />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Snapshots" value={ledger.data.total} icon={Layers} color="blue" subtitle={`${ledger.data.kennelsCovered} kennels`} />
              <StatCard label="Pending" value={ledger.data.outcomes.PENDING} icon={Clock} color="amber" />
              <StatCard label="Hit" value={ledger.data.outcomes.HIT} icon={CheckCircle} color="emerald" />
              <StatCard label="Miss" value={ledger.data.outcomes.MISS} icon={XCircle} color="red" />
              <StatCard label="Preconfirmed" value={ledger.data.outcomes.PRECONFIRMED} icon={CircleSlash} color="teal" subtitle="excluded" />
              <StatCard label="Unobserved" value={ledger.data.outcomes.UNOBSERVED} icon={ShieldQuestion} color="teal" subtitle="excluded" />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Precision — HIT / (HIT + MISS), by confidence × actual days-out</h3>
              {ledger.data.scored === 0 ? (
                <div className="flex items-start gap-2 rounded-xl border border-blue-500/30 bg-blue-500/[0.06] p-4 text-sm text-blue-600">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Still accumulating — no matured HIT/MISS rows yet.{" "}
                    {ledger.data.firstMaturityISO
                      ? <>First scores arrive ~<strong>{fmtDate(ledger.data.firstMaturityISO)}</strong> (earliest pending target date).</>
                      : "Snapshots begin on the weekly Monday cron."}
                  </span>
                </div>
              ) : (
                <PrecisionHeatmap ledger={ledger.data} />
              )}
              <p className="text-xs text-muted-foreground">
                PRECONFIRMED + UNOBSERVED are excluded. Recall is a deferred follow-up (computed from events vs snapshot coverage, not snapshot rows).
              </p>
            </div>

            {ledger.data.weekly.length > 1 && (
              <div className="h-56 rounded-xl border border-border/50 bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold">Snapshots accumulated per week</h3>
                <ResponsiveContainer width="100%" height="85%">
                  <LineChart data={ledger.data.weekly} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Rule-drift ── */}
      {!drift.ok ? <ErrorCard what="rule-drift findings" /> : <DriftSection drift={drift.data} />}

      {/* ── Coverage ── */}
      <section className="space-y-5">
        <SectionHeader icon={CalendarRange} title="Schedule-rule coverage" color="bg-purple-500/10 text-purple-500" />
        {!coverage.ok ? (
          <ErrorCard what="schedule-rule coverage" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Active rules" value={coverage.data.activeRules} icon={Hash} color="purple" />
              <StatCard label="Kennels w/ rule" value={coverage.data.kennelsWithRule} icon={CheckCircle} color="emerald" subtitle={`of ${coverage.data.totalVisibleKennels} visible`} />
              <StatCard label="Seasonal kennels" value={coverage.data.seasonalKennels} icon={CalendarRange} color="amber" />
              <StatCard label="Dark kennels" value={coverage.data.darkKennels} icon={CircleSlash} color="red" subtitle="no active rule" />
              <StatCard label="HIGH confidence" value={coverage.data.byConfidence.HIGH} icon={Target} color="blue" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="h-56 rounded-xl border border-border/50 bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold">Active rules by confidence</h3>
                <ResponsiveContainer width="100%" height="85%">
                  <BarChart
                    data={[
                      { tier: "HIGH", count: coverage.data.byConfidence.HIGH },
                      { tier: "MEDIUM", count: coverage.data.byConfidence.MEDIUM },
                      { tier: "LOW", count: coverage.data.byConfidence.LOW },
                    ]}
                    margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="tier" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-xl border border-border/50 bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold">Active rules by source</h3>
                <ul className="space-y-1.5 text-sm">
                  {coverage.data.bySource.map((s) => (
                    <li key={s.source} className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground">{s.source}</span>
                      <span className="font-semibold tabular-nums">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
