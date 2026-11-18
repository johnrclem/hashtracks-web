/**
 * Per-type row provenance (docs/onboarding-backfill-automation-design.md section 3, guard G5).
 *
 * Each archive row's `sourceUrl` must prove the row came from the origin, the
 * live feed the archive was frozen from. Types without a defined rule are
 * supervised (not automated).
 */
import type { SourceType } from "@/generated/prisma/client";

export const SUPPORTED_ORIGIN_TYPES: ReadonlySet<SourceType> = new Set<SourceType>([
  "GOOGLE_SHEETS",
  "GOOGLE_CALENDAR",
  "MEETUP",
  "HTML_SCRAPER",
]);

export interface OriginForProvenance {
  type: SourceType;
  url: string;
  config: unknown;
}

export interface ProvenanceFailure {
  row: number;
  reason: "no-url" | "bad-url" | "other-sheet" | "other-calendar" | "other-group" | "other-host" | "outside-path" | "query-mismatch";
}

export type ProvenanceResult =
  | { ok: true }
  | { ok: false; supervised: true; reason: "unsupported-type" | "shared-host" | "origin-unparseable" }
  | { ok: false; supervised: false; failures: ProvenanceFailure[] };

function parseUrl(raw: string | undefined | null): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** The spreadsheet id in a Google Sheets URL, or the bare id. */
export function sheetId(urlOrId: string): string | null {
  const m = /\/spreadsheets\/d\/([\w-]+)/.exec(urlOrId);
  if (m) return m[1];
  return /^[\w-]{20,}$/.test(urlOrId) ? urlOrId : null;
}

/** Google's short calendar-domain forms in an `eid` (section 3). */
const CALENDAR_SHORT_DOMAINS: Record<string, string> = {
  "@g": "@group.calendar.google.com",
  "@m": "@gmail.com",
  "@v": "@group.v.calendar.google.com",
  "@i": "@import.calendar.google.com",
};

/**
 * The calendar id named by a Google Calendar event link's `eid`: base64url of
 * "<event id> <calendar id>", the calendar's domain often shortened.
 */
export function calendarIdFromEventUrl(raw: string): string | null {
  const url = parseUrl(raw);
  const eid = url?.searchParams.get("eid");
  if (!eid) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(eid.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.trim().split(/\s+/);
  if (parts.length < 2) return null;
  let calendar = parts[1];
  for (const [short, full] of Object.entries(CALENDAR_SHORT_DOMAINS)) {
    if (calendar.endsWith(short)) {
      calendar = calendar.slice(0, -short.length) + full;
      break;
    }
  }
  return calendar.toLowerCase();
}

function meetupGroup(origin: OriginForProvenance): string | null {
  const cfg = origin.config as { groupUrlname?: unknown } | null;
  if (cfg && typeof cfg.groupUrlname === "string" && cfg.groupUrlname) return cfg.groupUrlname.toLowerCase();
  const url = parseUrl(origin.url);
  const seg = url?.pathname.split("/").find(Boolean);
  return seg ? seg.toLowerCase() : null;
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * G5's per-row rule. `otherKennelHosts` are the website hosts of every source
 * linked to a kennel other than the archive's; a website origin on one of them
 * is a shared host (sfh3.com serves 13 kennels) and is supervised.
 */
export function checkRowProvenance(
  origin: OriginForProvenance,
  rowUrls: ReadonlyArray<string | null | undefined>,
  otherKennelHosts: ReadonlySet<string>,
): ProvenanceResult {
  if (!SUPPORTED_ORIGIN_TYPES.has(origin.type)) return { ok: false, supervised: true, reason: "unsupported-type" };

  let check: (url: URL) => ProvenanceFailure["reason"] | null;
  switch (origin.type) {
    case "GOOGLE_SHEETS": {
      const id = sheetId(origin.url);
      if (!id) return { ok: false, supervised: true, reason: "origin-unparseable" };
      check = (u) => (sheetId(u.href) === id ? null : "other-sheet");
      break;
    }
    case "GOOGLE_CALENDAR": {
      const calendar = origin.url.trim().toLowerCase();
      check = (u) => (calendarIdFromEventUrl(u.href) === calendar ? null : "other-calendar");
      break;
    }
    case "MEETUP": {
      const group = meetupGroup(origin);
      if (!group) return { ok: false, supervised: true, reason: "origin-unparseable" };
      check = (u) =>
        hostOf(u) === "meetup.com" && u.pathname.toLowerCase().startsWith(`/${group}/events/`) ? null : "other-group";
      break;
    }
    default: {
      const base = parseUrl(origin.url);
      if (!base) return { ok: false, supervised: true, reason: "origin-unparseable" };
      const host = hostOf(base);
      if (otherKennelHosts.has(host)) return { ok: false, supervised: true, reason: "shared-host" };
      const basePath = base.pathname.endsWith("/") ? base.pathname : base.pathname.replace(/[^/]*$/, "");
      check = (u) => {
        if (hostOf(u) !== host) return "other-host";
        if (!u.pathname.startsWith(basePath)) return "outside-path";
        for (const [k, v] of base.searchParams) if (u.searchParams.get(k) !== v) return "query-mismatch";
        return null;
      };
    }
  }

  const failures: ProvenanceFailure[] = [];
  rowUrls.forEach((raw, row) => {
    if (!raw) return void failures.push({ row, reason: "no-url" });
    const url = parseUrl(raw);
    if (!url) return void failures.push({ row, reason: "bad-url" });
    const reason = check(url);
    if (reason) failures.push({ row, reason });
  });
  return failures.length ? { ok: false, supervised: false, failures } : { ok: true };
}

/** Lower-cased website hosts of a list of source URLs, ignoring non-URLs (calendar ids, sheet ids). */
export function websiteHosts(urls: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of urls) {
    const u = parseUrl(raw);
    if (u && (u.protocol === "http:" || u.protocol === "https:")) out.add(hostOf(u));
  }
  return out;
}
