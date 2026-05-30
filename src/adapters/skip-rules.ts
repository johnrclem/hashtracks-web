/**
 * Systemic phantom-event skip mechanism (#1739).
 *
 * One shared matcher backs two consumers:
 *   1. Per-source `Source.config.silentlySkipPatterns` (compiled + matched in
 *      `src/pipeline/scrape.ts`, before events become RawEvents) — drops known
 *      source pollution (admin notes, "no run" holiday rows, sister-kennel
 *      events) with NO `SOURCE_KENNEL_MISMATCH` alert.
 *   2. The global built-in rule sets below (medical / platform-departure /
 *      farewell), consumed by `google-calendar` + `meetup` adapters at their
 *      existing call sites — same regex semantics as the old hard-coded
 *      one-offs, now centralized here.
 *
 * Imported only by server-side adapters and the scrape pipeline — never by
 * client components — so it can reuse the adapter `utils` helpers freely.
 */
import isSafeRegex from "safe-regex2";
import { compilePatterns } from "./utils";
import type { RawEventData, SilentSkipRule } from "./types";

type SkipField = NonNullable<SilentSkipRule["field"]>;

export interface CompiledSkipRule {
  re: RegExp;
  field: SkipField;
  unlessHashSignal: boolean;
  /** Original pattern string — surfaced in scrape diagnostics. */
  source: string;
}

const VALID_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "location",
  "hares",
]);

const HASH_KEYWORD_RE = /\bhash\b/i;
const TITLE_RUN_NUMBER_RE = /#\s?\d/;

/**
 * Compile per-source `silentlySkipPatterns` config (untrusted JSON). Validates
 * shape and ReDoS-safety; silently drops malformed entries with a one-line
 * warning rather than throwing, so a single bad rule never breaks a scrape.
 */
export function compileSilentSkipRules(raw: unknown): CompiledSkipRule[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    console.warn("[skip-rules] silentlySkipPatterns must be an array — ignoring");
    return [];
  }
  const out: CompiledSkipRule[] = [];
  for (const entry of raw) {
    const rule = entry as Partial<SilentSkipRule> | null | undefined;
    if (!rule || typeof rule.pattern !== "string" || rule.pattern.length === 0) {
      console.warn("[skip-rules] dropping malformed silentlySkipPatterns entry (missing pattern)");
      continue;
    }
    const field = rule.field ?? "title";
    if (!VALID_FIELDS.has(field)) {
      console.warn(`[skip-rules] dropping rule with invalid field "${field}"`);
      continue;
    }
    // Compile via the shared helper so the (suppressed) dynamic-RegExp call
    // lives in exactly one place (utils.ts). Malformed patterns yield [].
    const [re] = compilePatterns([rule.pattern], "i");
    if (!re) {
      console.warn(`[skip-rules] dropping rule with invalid regex "${rule.pattern}"`);
      continue;
    }
    if (!isSafeRegex(re)) {
      console.warn(`[skip-rules] dropping ReDoS-unsafe rule "${rule.pattern}"`);
      continue;
    }
    out.push({
      re,
      field: field as SkipField,
      unlessHashSignal: rule.unlessHashSignal === true,
      source: rule.pattern,
    });
  }
  return out;
}

/** Hash-confirming signal present in a title alone (word "hash" or a `#NN`). */
export function titleHasHashSignal(title: string | null | undefined): boolean {
  if (!title) return false;
  return HASH_KEYWORD_RE.test(title) || TITLE_RUN_NUMBER_RE.test(title);
}

/** Hash-confirming signal on a (partial) event: real runNumber, hares, or title keyword. */
export function hasHashSignal(
  ev: Pick<RawEventData, "title" | "runNumber" | "hares">,
): boolean {
  return ev.runNumber != null || !!ev.hares || titleHasHashSignal(ev.title);
}

function fieldValue(ev: RawEventData, field: SkipField): string | null | undefined {
  switch (field) {
    case "title":
      return ev.title;
    case "description":
      return ev.description;
    case "location":
      return ev.location;
    case "hares":
      return ev.hares;
  }
}

export interface SkipMatch {
  field: SkipField;
  pattern: string;
}

/**
 * First rule (if any) that drops `ev`: the chosen field matches the regex and,
 * for `unlessHashSignal` rules, no hash signal rescues it. The signal is
 * computed lazily and at most once per event.
 */
export function matchSilentSkip(
  ev: RawEventData,
  rules: CompiledSkipRule[],
): SkipMatch | null {
  if (rules.length === 0) return null;
  let signal: boolean | undefined;
  for (const rule of rules) {
    const value = fieldValue(ev, rule.field);
    if (!value || !rule.re.test(value)) continue;
    if (rule.unlessHashSignal) {
      signal ??= hasHashSignal(ev);
      if (signal) continue;
    }
    return { field: rule.field, pattern: rule.source };
  }
  return null;
}

// ───────────────────────── Global built-in rule sets ─────────────────────────
// Trusted RegExp literals (not user input → no isSafeRegex gate needed).
// Consumed by adapters at their existing call sites; behavior matches the
// pre-#1739 hard-coded one-offs, except FAREWELL_RES is now signal-gated.

/**
 * Medical / telehealth appointment titles (#1690, cycle-13 Houston PII leak).
 * Used by `google-calendar/adapter.ts` together with its explicit
 * `runNumber === undefined && !hares && !/\bhash\b/i` gate, so a real
 * "Sleep Study Trail" with a hare still ingests.
 */
export const MEDICAL_SKIP_RES: readonly RegExp[] = [
  /^\s*sleep\s+study\b/i,
  /^\s*(?:medical|telehealth|virtual)\s+(?:appointment|visit|consultation|consult)\b/i,
  /\bremote\s+visit\b/i,
];

/**
 * Platform-departure admin posts (#1689 Narwhal, #1728 Miami). Unconditional —
 * no run number / location / hares rehabilitates a "we're leaving" notice.
 * `leaving meetup` is narrow on purpose ("Leaving Las Vegas Trail" ingests).
 * Consumed only via `isPlatformDepartureTitle` below.
 *
 * NOTE: `facebook-hosted-events/constants.ts` keeps a parallel
 * `ADMIN_NOTICE_PATTERNS` copy (applied unconditionally, no farewell gate).
 * Unifying FB onto this matcher is a deliberate follow-up — out of scope here.
 */
const PLATFORM_DEPARTURE_RES: readonly RegExp[] = [
  /\bmoving\s+to\s+(?:a\s+)?new\s+(?:website|site|home|platform)\b/i,
  /\blast\s+day\s+(?:in|on|at)\b/i,
  /\bnew\s+website\b/i,
  /\bleaving\s+meetup\b/i,
  /\bplease\s+(?:use|visit|follow)\s+(?:our\s+)?new\b/i,
];

/**
 * Broad farewell words. GATED by `titleHasHashSignal` (#1739): a real
 * "Farewell Run Trail #42" / "Goodbye Trail #138" carries a run number and
 * ingests, while a bare "Farewell, we're done" departure post (no number)
 * drops. `RIP` stays case-sensitive — lowercase "rip" appears in real prose.
 * Consumed only via `isPlatformDepartureTitle` below.
 */
const FAREWELL_RES: readonly RegExp[] = [
  /\bfarewell\b/i,
  /\bgoodbye\b/i,
  /\bRIP\b/,
  /\bdeprecated\b/i,
];

/**
 * True when a Meetup/FB-style title is a platform-departure post, or an
 * un-signalled farewell post. The single entry point adapters call to drop
 * admin-notice events. Replaces the old unconditional `isAdminNoticeTitle`
 * path for Meetup (FB keeps its own copy in `facebook-hosted-events`).
 */
export function isPlatformDepartureTitle(title: string): boolean {
  if (PLATFORM_DEPARTURE_RES.some((re) => re.test(title))) return true;
  if (FAREWELL_RES.some((re) => re.test(title)) && !titleHasHashSignal(title)) return true;
  return false;
}
