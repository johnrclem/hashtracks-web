import type { Prisma } from "@/generated/prisma/client";

/**
 * Kennel status rules, shared by the directory filter (browser), server counts,
 * the share image and the admin table. Pure and client-safe: only `type`
 * imports from Prisma. Dates are UTC noon; "today" is today's UTC noon.
 */

export type KennelState = "running" | "quiet" | "not-seen" | "stopped";

export interface KennelEvidence {
  lastRunSeenAt: Date | null;
  nextRunPostedAt: Date | null;
  lastConfirmedAt: Date | null;
  lastConfirmedVia: ConfirmationVia | null;
  stoppedAt: Date | null;
}

export type ConfirmationVia = "ADMIN" | "HALF_MIND";

export type SerializedKennelEvidence = {
  [K in keyof KennelEvidence]: K extends "lastConfirmedVia" ? ConfirmationVia | null : string | null;
};

export type StatusLine =
  | { kind: "last-run" | "next-posted" | "stopped"; date: Date }
  | { kind: "checked"; via: ConfirmationVia; date: Date }
  | { kind: "never" };

/**
 * The own-page URL to link from a status line: always for a never-seen kennel,
 * and for dated lines only when the surface asks for it (the Travel list).
 */
export function ownPageFor(
  line: StatusLine,
  ownPageUrl: string | null,
  showOwnPage: boolean,
): string | null {
  return line.kind === "never" || showOwnPage ? ownPageUrl : null;
}

// Day-count thresholds: the single source of truth for state and SQL filters.
/** Evidence this recent (today = day 1) means running. */
const RUNNING_EVIDENCE_DAYS = 90;
/** Evidence this recent (but not running) means quiet. */
const QUIET_EVIDENCE_DAYS = 365;
/** A posted run this many days out (or fewer) means running. */
const POSTED_AHEAD_DAYS = 60;
export const DAY_MS = 1000 * 60 * 60 * 24;

export const KENNEL_EVIDENCE_SELECT = {
  lastRunSeenAt: true,
  nextRunPostedAt: true,
  lastConfirmedAt: true,
  lastConfirmedVia: true,
  stoppedAt: true,
} as const satisfies Prisma.KennelSelect;

export function toUtcNoon(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0);
}

function windowStart(now: Date, days: number): Date {
  return new Date(toUtcNoon(now) - (days - 1) * DAY_MS);
}

function postedAheadLimit(now: Date): Date {
  return new Date(toUtcNoon(now) + POSTED_AHEAD_DAYS * DAY_MS);
}

/** Latest of lastRunSeenAt, lastConfirmedAt and a nextRunPostedAt that is not in the future. */
function newestEvidence(e: KennelEvidence, now: Date): number | null {
  const today = toUtcNoon(now);
  const times: number[] = [];
  if (e.lastRunSeenAt) times.push(toUtcNoon(e.lastRunSeenAt));
  if (e.lastConfirmedAt) times.push(toUtcNoon(e.lastConfirmedAt));
  if (e.nextRunPostedAt && toUtcNoon(e.nextRunPostedAt) <= today) times.push(toUtcNoon(e.nextRunPostedAt));
  return times.length ? Math.max(...times) : null;
}

export function getKennelState(e: KennelEvidence, now: Date = new Date()): KennelState {
  if (e.stoppedAt) return "stopped";
  const today = toUtcNoon(now);
  if (e.nextRunPostedAt) {
    const posted = toUtcNoon(e.nextRunPostedAt);
    if (posted >= today && posted <= postedAheadLimit(now).getTime()) return "running";
  }
  const newest = newestEvidence(e, now);
  if (newest === null) return "not-seen";
  if (newest >= windowStart(now, RUNNING_EVIDENCE_DAYS).getTime()) return "running";
  if (newest >= windowStart(now, QUIET_EVIDENCE_DAYS).getTime()) return "quiet";
  return "not-seen";
}

/**
 * A running kennel whose only running evidence is a Half-Mind check: drop the
 * check and it is no longer running. Such a kennel shows the Half-Mind line.
 */
export function isHalfMindDeciding(e: KennelEvidence, now: Date = new Date()): boolean {
  if (e.stoppedAt || e.lastConfirmedVia !== "HALF_MIND") return false;
  if (getKennelState(e, now) !== "running") return false;
  return getKennelState({ ...e, lastConfirmedAt: null }, now) !== "running";
}

export function getStatusLine(
  e: KennelEvidence,
  now: Date = new Date(),
  opts: { listingOnly?: boolean } = {},
): StatusLine | null {
  if (e.stoppedAt) return { kind: "stopped", date: e.stoppedAt };
  if (e.lastConfirmedAt && (isHalfMindDeciding(e, now) || opts.listingOnly)) {
    return { kind: "checked", via: e.lastConfirmedVia ?? "ADMIN", date: e.lastConfirmedAt };
  }
  if (getKennelState(e, now) === "running") return null;
  if (e.nextRunPostedAt && toUtcNoon(e.nextRunPostedAt) > postedAheadLimit(now).getTime()) {
    return { kind: "next-posted", date: e.nextRunPostedAt };
  }
  const newest = newestEvidence(e, now);
  if (newest === null) return { kind: "never" };
  // "Checked" only when the confirmation is the newest evidence and newer than
  // the last run; otherwise the last run is the newest date, which may be a
  // posted run that is now past.
  const confirmed = e.lastConfirmedAt ? toUtcNoon(e.lastConfirmedAt) : null;
  const seen = e.lastRunSeenAt ? toUtcNoon(e.lastRunSeenAt) : null;
  if (e.lastConfirmedAt && confirmed === newest && (seen === null || confirmed > seen)) {
    return { kind: "checked", via: e.lastConfirmedVia ?? "ADMIN", date: e.lastConfirmedAt };
  }
  return { kind: "last-run", date: new Date(newest) };
}

function formatStatusDate(date: Date, now: Date): string {
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    ...(sameYear ? { day: "numeric" } : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

export function formatStatusLine(line: StatusLine, now: Date = new Date()): string {
  switch (line.kind) {
    case "never":
      return "No runs seen on HashTracks";
    case "last-run":
      return `Last run we saw · ${formatStatusDate(line.date, now)}`;
    case "checked":
      return line.via === "HALF_MIND"
        ? `Half-Mind listing checked · ${formatStatusDate(line.date, now)}`
        : `Checked running · ${formatStatusDate(line.date, now)}`;
    case "next-posted":
      return `Next run posted · ${formatStatusDate(line.date, now)}`;
    case "stopped":
      return `Stopped · ${formatStatusDate(line.date, now)}`;
  }
}

function evidenceWhere(now: Date, days: number): Prisma.KennelWhereInput {
  const since = windowStart(now, days);
  return {
    isHidden: false,
    stoppedAt: null,
    OR: [
      { lastRunSeenAt: { gte: since } },
      { lastConfirmedAt: { gte: since } },
      { nextRunPostedAt: { gte: since, lte: postedAheadLimit(now) } },
    ],
  };
}

/** Visible, not stopped kennels whose state is "running". */
export function runningKennelWhere(now: Date = new Date()): Prisma.KennelWhereInput {
  return evidenceWhere(now, RUNNING_EVIDENCE_DAYS);
}

/** Running or quiet: the directory's "Active only" default. */
export function listedKennelWhere(now: Date = new Date()): Prisma.KennelWhereInput {
  return evidenceWhere(now, QUIET_EVIDENCE_DAYS);
}

export function serializeKennelEvidence(e: KennelEvidence): SerializedKennelEvidence {
  return {
    lastRunSeenAt: e.lastRunSeenAt?.toISOString() ?? null,
    nextRunPostedAt: e.nextRunPostedAt?.toISOString() ?? null,
    lastConfirmedAt: e.lastConfirmedAt?.toISOString() ?? null,
    lastConfirmedVia: e.lastConfirmedVia,
    stoppedAt: e.stoppedAt?.toISOString() ?? null,
  };
}

export function toKennelEvidence(s: SerializedKennelEvidence): KennelEvidence {
  const d = (v: string | null) => (v ? new Date(v) : null);
  return {
    lastRunSeenAt: d(s.lastRunSeenAt),
    nextRunPostedAt: d(s.nextRunPostedAt),
    lastConfirmedAt: d(s.lastConfirmedAt),
    lastConfirmedVia: s.lastConfirmedVia,
    stoppedAt: d(s.stoppedAt),
  };
}
