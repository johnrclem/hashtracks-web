/**
 * Computes this week's value for every scorecard measure (`config.ts`) that has a server source:
 * production SQL (read-only SELECTs), GitHub through the server App, Google Search Console and
 * Sentry. A source that is missing its credential or fails reports its measures as "not available"
 * with the reason, and never fails the run.
 */
import { prisma } from "@/lib/db";
import { inspectHubCoverage, type HubCoverage } from "@/lib/gsc/coverage";
import { GSC_KEY_ENV, type Gsc } from "@/lib/gsc/client";
import { NO_GITHUB_CREDENTIAL } from "@/lib/github-app";
import { LANE_LABELS } from "@/lib/audit-labels";
import {
  isAgentOrWorkstreamPr,
  isWaitingOnOwner,
  mergedSince,
  numberList,
  type GhIssue,
  type GhPull,
  type OpsGithub,
} from "@/lib/ops-github";
import { DEFAULT_SITE_URL } from "@/lib/site-url";
import type { Prisma } from "@/generated/prisma/client";
import { getTodayUtcNoon } from "@/lib/date";
import {
  DISPLAY_EVENT_WHERE,
  SCHEDULE_ONLY_DISPLAY_HORIZON_DAYS,
  withinScheduleOnlyDisplayHorizon,
} from "@/lib/event-filters";

import { PREDICTION_GATE_MERGED_AT, SENTRY_N1_ISSUE, type MeasureValue, type Values } from "./config";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const na = (note: string): MeasureValue => ({ value: null, note });
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160);

/** Fill `ids` with "not available" and the reason. */
function unavailable(ids: string[], note: string): Values {
  return Object.fromEntries(ids.map((id) => [id, na(note)]));
}

/** Run one source's measures; on failure each of `ids` becomes "not available" with the error. */
async function guarded(ids: string[], compute: () => Promise<Values>): Promise<Values> {
  try {
    return await compute();
  } catch (err) {
    console.error(`[weekly-scorecard] ${ids.join(", ")} failed:`, err);
    return unavailable(ids, `failed: ${errText(err)}`);
  }
}

// ── Prod SQL ────────────────────────────────────────────────────────────────

const SQL_IDS = [
  "o2_active_users_28d",
  "o5_watchdog_not_ok",
  "o6_failing_sources",
  "o6_alerts_week",
  "o6_scrape_success_7d",
  "o7_projections_beyond_horizon",
  "o7_far_future_rows",
  "o7_kennels_real_run_60d",
  "o8_finding_filed_median_min",
  "o9_new_kennels_week",
];

/**
 * O7: runs nobody posted (schedule-only, or no RawEvent at all) that the hareline
 * and home listings would show more than the display horizon (D5) ahead. Counts
 * through the same fragments the listings use, so it measures what is shown,
 * not what is stored for Travel.
 */
export function unpostedShownBeyondHorizonWhere(today: Date): Prisma.EventWhereInput {
  return {
    ...DISPLAY_EVENT_WHERE,
    date: { gt: new Date(today.getTime() + SCHEDULE_ONLY_DISPLAY_HORIZON_DAYS * DAY_MS) },
    AND: [withinScheduleOnlyDisplayHorizon(today), { OR: [{ isScheduleOnly: true }, { rawEvents: { none: {} } }] }],
  };
}

/** Kennels whose far-future rows WS11 removes (plan section 1). */
const FAR_FUTURE_KENNELS = ["bobbh3", "pormeh3", "bullmoon"];

export async function sqlMeasures(ownerEmail: string | undefined): Promise<Values> {
  return guarded(SQL_IDS, async () => {
    const owner = (ownerEmail ?? "").trim().toLowerCase();
    const [users, watchdog, sources, alerts, scrapes, beyond, farFuture, live60, filed, newKennels] = await Promise.all([
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(DISTINCT a."userId") AS n
        FROM "Attendance" a JOIN "User" u ON u.id = a."userId"
        WHERE a."createdAt" > now() - interval '28 days' AND a.status = 'CONFIRMED'
          AND lower(u.email) <> ${owner}`,
      prisma.$queryRaw<Array<{ total: bigint; not_ok: bigint }>>`
        SELECT count(*) AS total,
               count(*) FILTER (WHERE status = 'OVERDUE' OR verdict IN ('OVERDUE', 'UNKNOWN')) AS not_ok
        FROM "AutomationState"`,
      prisma.$queryRaw<Array<{ failing: bigint }>>`
        SELECT count(*) FILTER (WHERE enabled AND "healthStatus" = 'FAILING') AS failing FROM "Source"`,
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM "Alert" WHERE "createdAt" > now() - interval '7 days'`,
      prisma.$queryRaw<Array<{ ok: bigint; total: bigint }>>`
        SELECT count(*) FILTER (WHERE status = 'SUCCESS') AS ok, count(*) AS total
        FROM "ScrapeLog" WHERE "startedAt" > now() - interval '7 days' AND status IN ('SUCCESS', 'FAILED')`,
      prisma.event.count({ where: unpostedShownBeyondHorizonWhere(new Date(getTodayUtcNoon())) }),
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM "Event" e JOIN "Kennel" k ON k.id = e."kennelId"
        WHERE e."isCanonical" AND e.status = 'CONFIRMED' AND e.date > now() + interval '365 days'
          AND k."kennelCode" = ANY(${FAR_FUTURE_KENNELS})`,
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(DISTINCT ek."kennelId") AS n
        FROM "Event" e
        JOIN "EventKennel" ek ON ek."eventId" = e.id
        JOIN "Kennel" k ON k.id = ek."kennelId"
        WHERE e."isCanonical" AND e.status = 'CONFIRMED' AND NOT e."isScheduleOnly" AND NOT e."isManualEntry"
          AND NOT k."isHidden" AND e.date >= date_trunc('day', now()) AND e.date < now() + interval '60 days'`,
      prisma.$queryRaw<Array<{ median: number | null; n: bigint }>>`
        SELECT percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY extract(epoch FROM ("promotedAt" - "submittedAt")) / 60) AS median,
               count(*) AS n
        FROM "AuditFindingDraft"
        WHERE "issueNumber" IS NOT NULL AND "promotedAt" > now() - interval '7 days'`,
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM "Kennel"
        WHERE "createdAt" > now() - interval '7 days' AND NOT "isHidden" AND NOT "listingOnly"`,
    ]);

    const w = watchdog[0];
    const total = num(w?.total);
    const notOk = num(w?.not_ok);
    const s = scrapes[0];
    const scrapeTotal = num(s?.total);
    const f = filed[0];
    return {
      o2_active_users_28d: {
        value: num(users[0]?.n),
        note: owner ? "users with a check-in, OWNER_EMAIL's account excluded" : "OWNER_EMAIL unset: owner not excluded",
      },
      o5_watchdog_not_ok: { value: notOk, display: `${total - notOk}/${total} OK` },
      o6_failing_sources: { value: num(sources[0]?.failing), note: "enabled sources with healthStatus FAILING" },
      o6_alerts_week: { value: num(alerts[0]?.n) },
      o6_scrape_success_7d: scrapeTotal
        ? { value: Math.round((num(s?.ok) / scrapeTotal) * 1000) / 10 }
        : na("no finished scrapes in 7 days"),
      o7_projections_beyond_horizon: { value: beyond },
      o7_far_future_rows: { value: num(farFuture[0]?.n) },
      o7_kennels_real_run_60d: { value: num(live60[0]?.n) },
      o8_finding_filed_median_min:
        f?.median == null ? na("no findings filed in 7 days") : { value: Math.round(Number(f.median)), note: `${num(f.n)} filed` },
      o9_new_kennels_week: { value: num(newKennels[0]?.n), note: "visible, not listing-only, created in 7 days" },
    };
  });
}

// ── GitHub ──────────────────────────────────────────────────────────────────

const GITHUB_IDS = [
  "o3_defects_closed_week",
  "o3_defects_opened_week",
  "o3_open_defects",
  "o3_not_planned_share",
  "o4_oldest_waiting_h",
  "o4_waiting_prs",
  "o4_handoffs_self_merged",
  "o5_agent_prs_merged_week",
  "o10_ruleset_on",
];

const issuesOnly = (rows: GhIssue[]) => rows.filter((i) => !i.pull);

/** A percentage measure shown with its fraction, or "not available" with `empty` when there's no denominator. */
function share(n: number, of: number, empty: string): MeasureValue {
  if (!of) return na(empty);
  const pct = Math.round((n / of) * 100);
  return { value: pct, display: `${pct}% (${n}/${of})` };
}

export async function githubMeasures(github: OpsGithub | null, now: Date): Promise<Values> {
  if (!github) return unavailable(GITHUB_IDS, NO_GITHUB_CREDENTIAL);
  return guarded(GITHUB_IDS, async () => {
    const since = new Date(now.getTime() - 7 * DAY_MS);
    const [defectsTouched, open, pulls, handoffs, fixerClosed, implClosed, rules] = await Promise.all([
      // Every lane:defect issue updated this week: it holds both this week's opens and its closes.
      github.listIssues({ labels: LANE_LABELS.defect, state: "all", sort: "updated", since, limit: 500 }),
      github.listIssues({ labels: LANE_LABELS.defect, state: "open", limit: 1000 }),
      github.listOpenPulls(),
      github.listIssues({ labels: "onboarding-handoff", state: "all", sort: "created", limit: 50 }),
      github.listIssues({ labels: "audit-fix", state: "closed", sort: "updated", since, limit: 100 }),
      github.listIssues({ labels: "onboarding-impl", state: "closed", sort: "updated", since, limit: 100 }),
      github.branchRuleCount("main").catch(() => null),
    ]);

    const defects = issuesOnly(defectsTouched);
    const closedThisWeek = defects.filter((i) => i.closedAt && i.closedAt >= since);
    const completed = closedThisWeek.filter((i) => i.stateReason === "completed").length;
    const notPlanned = closedThisWeek.filter((i) => i.stateReason === "not_planned").length;

    const waiting = pulls.filter((pr) => isWaitingOnOwner(pr) && isAgentOrWorkstreamPr(pr));
    const oldest = waiting.reduce<GhPull | null>((o, pr) => (!o || pr.createdAt < o.createdAt ? pr : o), null);
    const oldestHours = oldest ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / HOUR_MS) : 0;

    // Handoffs old enough that the research task should have merged them (2–14 days).
    const window = handoffs.filter((i) => {
      const age = now.getTime() - i.createdAt.getTime();
      return i.pull && age >= 2 * DAY_MS && age <= 14 * DAY_MS;
    });

    const agentMerged = [...mergedSince(fixerClosed, since), ...mergedSince(implClosed, since)];

    return {
      o3_defects_closed_week: { value: completed, note: `${closedThisWeek.length} closed in all` },
      o3_defects_opened_week: { value: defects.filter((i) => i.createdAt >= since).length },
      o3_open_defects: { value: issuesOnly(open).length },
      o3_not_planned_share: share(notPlanned, closedThisWeek.length, "no lane:defect closes in 7 days"),
      o4_oldest_waiting_h: { value: oldestHours, display: oldest ? `${oldestHours} h (#${oldest.number})` : "none waiting" },
      o4_waiting_prs: { value: waiting.length, display: numberList(waiting) },
      o4_handoffs_self_merged: share(window.filter((i) => i.pull?.mergedAt).length, window.length, "no handoff PRs opened 2–14 days ago"),
      o5_agent_prs_merged_week: { value: agentMerged.length, display: numberList(agentMerged) },
      o10_ruleset_on: rules === null ? na("couldn't read main's rules") : { value: rules, display: rules > 0 ? `on (${rules} rules)` : "off" },
    };
  });
}

// ── Public site (soft 404s) ─────────────────────────────────────────────────

/** One unknown id per route family; each should answer 404 to Googlebot, not 200 + noindex. */
export const SOFT_404_PROBES = [
  "/kennels/zz-scorecard-no-such-kennel",
  "/kennels/region/zz-scorecard-no-such-region",
  "/hareline/zz-scorecard-no-such-event",
];

export async function soft404Measure(fetchImpl: typeof fetch = fetch): Promise<Values> {
  return guarded(["o1_soft404_families"], async () => {
    const statuses = await Promise.all(
      SOFT_404_PROBES.map(async (path) => {
        const res = await fetchImpl(`${DEFAULT_SITE_URL}${path}`, {
          headers: { "User-Agent": GOOGLEBOT_UA },
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
        });
        await res.body?.cancel();
        return { path, status: res.status };
      }),
    );
    const soft = statuses.filter((s) => s.status === 200);
    return {
      o1_soft404_families: {
        value: soft.length,
        note: statuses.map((s) => `${s.path.split("/zz-")[0] || "/"} ${s.status}`).join(", "),
      },
    };
  });
}

// ── Google Search Console ───────────────────────────────────────────────────

const GSC_IDS = ["o1_sitemap_read", "o1_hubs_indexed", "o1_impressions_28d"];
const SITEMAP_FRESH_DAYS = 7;

/** The GSC client, or why there is none (no key yet, or a key that can't be used). */
export interface GscSetup {
  client: Gsc | null;
  error?: string;
}

export async function gscMeasures({ client: gsc, error }: GscSetup, now: Date, fetchImpl?: typeof fetch): Promise<Values> {
  if (!gsc) return unavailable(GSC_IDS, error ? `GSC key unusable: ${error}` : `no ${GSC_KEY_ENV} (owner action A7)`);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const [sitemap, impressions, coverage] = await Promise.all([
    guarded(["o1_sitemap_read"], async () => {
      const sitemaps = await gsc.listSitemaps();
      const main = sitemaps.find((s) => s.path.endsWith("/sitemap.xml")) ?? sitemaps[0];
      if (!main) return { o1_sitemap_read: { value: 0, display: "no sitemap submitted" } };
      const fresh = main.lastDownloaded !== null && now.getTime() - main.lastDownloaded.getTime() <= SITEMAP_FRESH_DAYS * DAY_MS;
      const ok = fresh && main.errors === 0;
      const read = main.lastDownloaded ? `read ${ymd(main.lastDownloaded)}` : "never read";
      const pending = main.isPending ? ", pending" : "";
      return {
        o1_sitemap_read: {
          value: ok ? 1 : 0,
          display: `${ok ? "yes" : "no"}: ${read}, ${main.errors} errors, ${main.warnings} warnings${pending}`,
          note: `${main.path}; ${main.submitted} URLs submitted`,
        },
      };
    }),
    guarded(["o1_impressions_28d"], async () => {
      const t = await gsc.searchTotals(ymd(new Date(now.getTime() - 28 * DAY_MS)), ymd(new Date(now.getTime() - DAY_MS)));
      return { o1_impressions_28d: { value: t.impressions, note: `${t.clicks} clicks` } };
    }),
    guarded(["o1_hubs_indexed"], async () => {
      const c = await inspectHubCoverage(gsc, now, { fetchImpl });
      const states = Object.entries(c.byState)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([state, n]) => `${state} ${n}`)
        .join("; ");
      return {
        o1_hubs_indexed: {
          value: c.indexed,
          display: `${c.indexed} of ${c.hubUrls}`,
          note: coverageNote(c, states),
          ...(c.inspected < c.hubUrls ? { partial: true } : {}),
        },
      };
    }),
  ]);
  return { ...sitemap, ...impressions, ...coverage };
}

// ── Sentry ──────────────────────────────────────────────────────────────────

function coverageNote(c: HubCoverage, states: string): string {
  const parts = [`${c.inspected} inspected`];
  if (c.slice) parts.push(`slice ${c.slice.start}–${c.slice.end}`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.skipped) parts.push(`${c.skipped} not reached (time budget)`);
  return `${parts.join(", ")}; ${states}`;
}

export const SENTRY_TOKEN_ENV = "SENTRY_READ_TOKEN";
const SENTRY_IDS = ["o10_sentry_n1_week", "o10_sentry_other_week"];

/** Event counts over 7 days from Sentry's Discover API. Needs a token with `event:read`. */
export async function sentryMeasures(fetchImpl: typeof fetch = fetch): Promise<Values> {
  const token = process.env[SENTRY_TOKEN_ENV]?.trim();
  const org = process.env.SENTRY_ORG?.trim();
  if (!token || !org) return unavailable(SENTRY_IDS, `no ${SENTRY_TOKEN_ENV} or SENTRY_ORG (owner action A8)`);
  const base = (process.env.SENTRY_API_URL?.trim() || "https://sentry.io").replace(/\/$/, "");
  const count = async (dataset: string, query: string): Promise<number> => {
    const params = new URLSearchParams({ field: "count()", query, statsPeriod: "7d", dataset });
    const res = await fetchImpl(`${base}/api/0/organizations/${encodeURIComponent(org)}/events/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Sentry ${dataset}: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return num(body.data?.[0]?.["count()"]);
  };
  const [n1, other] = await Promise.all([
    guarded(["o10_sentry_n1_week"], async () => ({
      o10_sentry_n1_week: { value: await count("issuePlatform", `issue:${SENTRY_N1_ISSUE}`) },
    })),
    guarded(["o10_sentry_other_week"], async () => ({
      o10_sentry_other_week: { value: await count("errors", "event.type:error") },
    })),
  ]);
  return { ...n1, ...other };
}

// ── Not yet measurable on the server ────────────────────────────────────────

export { errText };

export const MANUAL_MEASURES: Values = {
  o2_human_visitors_week: na("needs WS8's bot filter, the internal_user filter and a PostHog personal API key (A8)"),
  o3_reopened_share: na("needs per-issue timeline reads; the review counts reopened closes"),
  o7_dark_dispositions: na("counted from WS5's docs/ops/dark-kennels-2026-11.md once it exists"),
  o7_dark_to_live: na("counted from WS5's dark-kennel list once it exists"),
  o9_handoff_to_live_median: na("needs handoff ↔ implementer PR links; the review computes it"),
};

// ── Dated checks ────────────────────────────────────────────────────────────

/** Precision (HIT / (HIT + MISS)) of matured snapshots, by confidence tier. */
async function precisionByTier(where: { horizonBucket: number; snapshotAfter?: Date }) {
  const rows = await prisma.$queryRaw<Array<{ confidence: string; hit: bigint; miss: bigint }>>`
    SELECT confidence::text AS confidence,
           count(*) FILTER (WHERE outcome = 'HIT') AS hit,
           count(*) FILTER (WHERE outcome = 'MISS') AS miss
    FROM "PredictionSnapshot"
    WHERE "horizonBucket" = ${where.horizonBucket}
      AND "snapshotAt" >= ${where.snapshotAfter ?? new Date(0)}
      AND outcome IN ('HIT', 'MISS')
    GROUP BY confidence`;
  return Object.fromEntries(
    rows.map((r) => {
      const n = num(r.hit) + num(r.miss);
      return [r.confidence, { n, precision: n ? num(r.hit) / n : null }];
    }),
  ) as Record<string, { n: number; precision: number | null }>;
}

const pct = (p: number | null) => (p === null ? "—" : `${(p * 100).toFixed(1)}%`);

export async function horizon180Check(): Promise<{ ok: boolean; detail: string }> {
  const tiers = await precisionByTier({ horizonBucket: 180 });
  const n = Object.values(tiers).reduce((s, t) => s + t.n, 0);
  if (n === 0) return { ok: false, detail: "no matured 180-day snapshots yet (expected from 6 Dec)" };
  const parts = Object.entries(tiers).map(([tier, t]) => `${tier} ${pct(t.precision)} (n=${t.n})`);
  return { ok: true, detail: `${n} matured 180-day snapshots: ${parts.join(", ")}` };
}

export async function postGateCohortCheck(): Promise<{ ok: boolean | null; detail: string }> {
  const tiers = await precisionByTier({ horizonBucket: 30, snapshotAfter: new Date(PREDICTION_GATE_MERGED_AT) });
  const high = tiers.HIGH;
  const medium = tiers.MEDIUM;
  const detail = `30-day snapshots since the gate (${PREDICTION_GATE_MERGED_AT.slice(0, 10)}): HIGH ${pct(high?.precision ?? null)} (n=${high?.n ?? 0}), MEDIUM ${pct(medium?.precision ?? null)} (n=${medium?.n ?? 0})`;
  if (high?.precision == null || medium?.precision == null) return { ok: null, detail: `${detail}; not enough matured rows to compare` };
  return { ok: high.precision > medium.precision, detail };
}
