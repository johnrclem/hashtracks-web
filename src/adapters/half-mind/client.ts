/**
 * Honest client for Half-Mind's public finder API (half-mind.com).
 * Identifies itself, sends no disguise headers, never retries, and keeps
 * only the fields we need (never contact emails).
 */
import { safeFetch } from "@/adapters/safe-fetch";
import { toUtcNoon } from "@/lib/kennel-status";
import { safeUrl } from "@/lib/safe-url";

export const HALF_MIND_API_URL = "https://half-mind.com/api/v1/kennels.php";
export const HALF_MIND_USER_AGENT = "HashTracks/1.0 (+https://www.hashtracks.xyz)";

export type HalfMindStatus = "alive" | "unknown" | "dead" | "missing";

export interface HalfMindScope {
  country: string;
  state?: string;
}

export function scopeKey(s: HalfMindScope): string {
  return s.state ? `${s.country}/${s.state}` : s.country;
}

export interface HalfMindListing {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  status: Exclude<HalfMindStatus, "missing">;
  lastVerifiedAt: Date | null;
  schedule: string | null;
  website: string | null;
  facebookUrl: string | null;
}

export interface HalfMindResult {
  listings: HalfMindListing[];
  truncated: boolean;
  /** Request-level failures (network, non-200, non-JSON, wrong shape): the response is unusable. */
  errors: string[];
  /** Rows skipped as malformed; the other listings are good, but the response is incomplete. */
  rowErrors: string[];
}

const DAY_MS = 86_400_000;
const MAX_VERIFIED_AGE_DAYS = 365;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapStatus(row: Record<string, unknown>): Exclude<HalfMindStatus, "missing"> {
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  const state = typeof row.current_state === "string" ? row.current_state.trim().toLowerCase() : "";
  if (status === "dead" || state.includes("dead")) return "dead";
  if (state === "alive and verified") return "alive";
  return "unknown";
}

/** "YYYY-MM-DD[ HH:MM:SS]" -> that date at UTC noon; null when invalid or after today's UTC date. */
function parseVerifiedAt(v: unknown, now: Date): Date | null {
  if (typeof v !== "string") return null;
  const datePart = v.trim().slice(0, 10);
  const parts = datePart.split("-");
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) return null;
  const [y, m, d] = parts.map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1990) return null;
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.getTime() > toUtcNoon(now) ? null : date;
}

function to12Hour(token: string): string | null {
  const m = TIME_RE.exec(token);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2];
  if (h > 23 || Number(min) > 59) return null;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === "00" ? `${h12} ${suffix}` : `${h12}:${min} ${suffix}`;
}

function cleanScheduleEntry(entry: string): string | null {
  const words = entry.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lower = w.toLowerCase();
    if (lower === "all" && words[i + 1]?.toLowerCase() === "year") {
      i++;
      continue;
    }
    if (i === words.length - 1 && words.length > 1) {
      if (w === "DST") {
        out.push("(summer)");
        continue;
      }
      if (w === "ST") {
        out.push("(winter)");
        continue;
      }
    }
    out.push(to12Hour(w) ?? w);
  }
  const text = out.join(" ").trim();
  if (text === "" || text.toLowerCase() === "variable") return null;
  return text;
}

function scheduleEntries(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw !== "string") return [];
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(t.replaceAll("'", '"'));
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // fall through to bracket stripping
    }
    return t.slice(1, t.endsWith("]") ? -1 : undefined).split(",").map((s) => s.replaceAll("'", "").replaceAll('"', "").trim());
  }
  return [t];
}

export function cleanHalfMindSchedule(raw: unknown): string | null {
  const parts = scheduleEntries(raw)
    .map(cleanScheduleEntry)
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function parseHalfMindResponse(body: unknown, now: Date): HalfMindResult {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return { listings: [], truncated: false, errors: ["Half-Mind response had an unexpected shape"], rowErrors: [] };
  }
  const listings: HalfMindListing[] = [];
  const rowErrors: string[] = [];
  body.items.forEach((row: unknown, index: number) => {
    if (!isRecord(row)) {
      rowErrors.push(`Half-Mind row ${index} is not an object`);
      return;
    }
    const idNum = num(row.id);
    const name = str(row.name);
    if (idNum === null || name === null) {
      rowErrors.push(`Half-Mind row ${index} is missing id or name`);
      return;
    }
    listings.push({
      id: String(idNum),
      name,
      city: str(row.city),
      state: str(row.state),
      country: str(row.country) ?? "",
      latitude: num(row.lat),
      longitude: num(row.lng),
      status: mapStatus(row),
      lastVerifiedAt: parseVerifiedAt(row.last_verified, now),
      schedule: cleanHalfMindSchedule(row.schedules),
      website: safeUrl(str(row.website)),
      facebookUrl: safeUrl(str(row.facebook)),
    });
  });
  return { listings, truncated: body.truncated === true, errors: [], rowErrors };
}

/**
 * A Half-Mind check counts only when the listing claims active, was verified
 * within a year (by UTC date, today counting as day 1), and gives a page and a pin.
 */
export function passesImportBar(
  l: Pick<HalfMindListing, "status" | "lastVerifiedAt" | "website" | "facebookUrl" | "latitude" | "longitude">,
  now: Date,
): boolean {
  if (l.status !== "alive" || !l.lastVerifiedAt) return false;
  if (toUtcNoon(now) - toUtcNoon(l.lastVerifiedAt) >= MAX_VERIFIED_AGE_DAYS * DAY_MS) return false;
  if (!l.website && !l.facebookUrl) return false;
  return l.latitude !== null && l.longitude !== null;
}

export async function fetchHalfMindListings(scope: HalfMindScope, now: Date = new Date()): Promise<HalfMindResult> {
  const params = new URLSearchParams({ country: scope.country });
  if (scope.state) params.set("state", scope.state);
  params.set("dead", "1");
  const fail = (msg: string): HalfMindResult => ({ listings: [], truncated: false, errors: [msg], rowErrors: [] });

  let res: Response;
  try {
    res = await safeFetch(`${HALF_MIND_API_URL}?${params.toString()}`, {
      headers: { "User-Agent": HALF_MIND_USER_AGENT, Accept: "application/json" },
    });
  } catch {
    return fail("Half-Mind API request failed");
  }
  if (!res.ok) return fail(`Half-Mind API returned HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fail("Half-Mind API returned a non-JSON body");
  }
  return parseHalfMindResponse(body, now);
}
