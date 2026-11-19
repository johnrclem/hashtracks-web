import { prisma } from "@/lib/db";
import {
  compileKennelPatterns,
  matchCompiledKennelPatterns,
  type CompiledKennelPattern,
  type KennelPattern,
} from "@/adapters/kennel-patterns";

/** Outcome of resolving a raw kennel tag to a database Kennel record. */
export interface ResolveResult {
  /** The matched Kennel ID, or null if no match was found. */
  kennelId: string | null;
  /** Whether the tag was resolved to exactly one kennel. */
  matched: boolean;
  /**
   * Set when the tag went unmatched because a lookup found two or more
   * kennels and nothing narrowed it to one (R6). Callers report these
   * like any unmatched tag, with the candidates in the message.
   */
  reason?: "ambiguous";
  /** kennelCodes of the competing kennels, when `reason` is "ambiguous". */
  candidates?: string[];
}

type KennelRow = { id: string; kennelCode: string };

/** Hit = one kennel; ambiguous = two or more; null = none. */
type StepOutcome =
  | { kind: "hit"; kennelId: string }
  | { kind: "ambiguous"; candidates: string[] }
  | null;

const UNMATCHED: ResolveResult = { kennelId: null, matched: false };

// In-memory caches for a single scrape run
const cache = new Map<string, ResolveResult>();
const sourcePatternCache = new Map<string, CompiledKennelPattern[]>();

/** Clear the resolver caches (call between scrape runs and after alias/kennel/source edits). */
export function clearResolverCache() {
  cache.clear();
  sourcePatternCache.clear();
}

function toOutcome(rows: KennelRow[]): StepOutcome {
  if (rows.length === 0) return null;
  if (rows.length === 1) return { kind: "hit", kennelId: rows[0].id };
  return { kind: "ambiguous", candidates: rows.map((r) => r.kennelCode).sort((a, b) => a.localeCompare(b)) };
}

const KENNEL_SELECT = { id: true, kennelCode: true } as const;

/** Find up to two kennels for a field match; two means ambiguous. */
function findKennels(
  field: "kennelCode" | "shortName" | "fullName",
  value: string,
  sourceId?: string,
): Promise<KennelRow[]> {
  return prisma.kennel.findMany({
    where: {
      [field]: { equals: value, mode: "insensitive" },
      ...(sourceId ? { sources: { some: { sourceId } } } : {}),
    },
    select: KENNEL_SELECT,
    orderBy: { kennelCode: "asc" },
    take: 2,
  });
}

/** Find up to two distinct kennels holding an alias; two means ambiguous. */
async function findAliasKennels(value: string, sourceId?: string): Promise<KennelRow[]> {
  const rows = await prisma.kennelAlias.findMany({
    where: {
      alias: { equals: value, mode: "insensitive" },
      ...(sourceId ? { kennel: { sources: { some: { sourceId } } } } : {}),
    },
    select: { kennel: { select: KENNEL_SELECT } },
    distinct: ["kennelId"],
    orderBy: { kennelId: "asc" },
    take: 2,
  });
  return rows.map((r) => r.kennel);
}

type Lookup = (value: string, sourceId?: string) => Promise<KennelRow[]>;

const LOOKUPS: readonly Lookup[] = [
  (v, s) => findKennels("kennelCode", v, s), // Step 0: immutable identifier
  (v, s) => findKennels("shortName", v, s), // Step 1
  findAliasKennels, // Step 2
];

/**
 * Run one lookup source-scoped first, then global. A source-scoped hit wins
 * over global matches, so a tag shared by several kennels still resolves
 * when exactly one of them is linked to the source.
 */
async function runLookup(lookup: Lookup, value: string, sourceId?: string): Promise<StepOutcome> {
  if (sourceId) {
    const scoped = toOutcome(await lookup(value, sourceId));
    if (scoped) return scoped;
  }
  return toOutcome(await lookup(value));
}

/**
 * Steps 0–2 (kennelCode → shortName → alias). An ambiguous step does not
 * stop the walk: a later step can still settle the tag on one kennel. The
 * first ambiguity is reported only when no step finds exactly one.
 */
async function resolveDirect(value: string, sourceId?: string): Promise<StepOutcome> {
  let firstAmbiguous: StepOutcome = null;
  for (const lookup of LOOKUPS) {
    const outcome = await runLookup(lookup, value, sourceId);
    if (outcome?.kind === "hit") return outcome;
    firstAmbiguous ??= outcome;
  }
  return firstAmbiguous;
}

/** Step 3: Kennel.fullName, limited to kennels linked to the source. */
async function resolveViaFullName(value: string, sourceId?: string): Promise<StepOutcome> {
  if (!sourceId) return null;
  return toOutcome(await findKennels("fullName", value, sourceId));
}

/** The source's own `config.kennelPatterns`, compiled once per run. */
async function loadSourcePatterns(sourceId: string): Promise<CompiledKennelPattern[]> {
  const cached = sourcePatternCache.get(sourceId);
  if (cached) return cached;
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { config: true },
  });
  const raw = (source?.config as { kennelPatterns?: unknown } | null)?.kennelPatterns;
  const compiled = Array.isArray(raw)
    ? compileKennelPatterns(raw.filter(isKennelPattern))
    : [];
  sourcePatternCache.set(sourceId, compiled);
  return compiled;
}

function isKennelPattern(entry: unknown): entry is KennelPattern {
  if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") return false;
  const value: unknown = entry[1];
  return typeof value === "string"
    || (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string"));
}

/**
 * Map a raw tag to a kennelCode with the source's own `config.kennelPatterns`.
 * Returns null without a source or when no pattern matches. Patterns are
 * per source (R6): a "moon" or "summit" rule for one calendar no longer
 * catches tags from every other source.
 */
export async function mapKennelTagForSource(
  tag: string,
  sourceId: string | undefined,
): Promise<string | null> {
  if (!sourceId) return null;
  const compiled = await loadSourcePatterns(sourceId);
  if (compiled.length === 0) return null;
  return matchCompiledKennelPatterns(tag.trim(), compiled)[0] ?? null;
}

/** Step 4: source pattern mapping, then steps 0–2 again with the mapped kennelCode. */
async function resolveViaSourcePatterns(value: string, sourceId?: string): Promise<StepOutcome> {
  const mapped = await mapKennelTagForSource(value, sourceId);
  if (!mapped) return null;
  return resolveDirect(mapped, sourceId);
}

/**
 * Resolve an array of raw kennel tags to ResolveResults (#1023). Per-tag
 * results preserve order — `kennelTags[0]` becomes the primary kennel for
 * the event, the rest become EventKennel co-host rows. Unmatched tags
 * surface as `{ kennelId: null, matched: false }` so the caller can decide
 * to skip the event or alert.
 */
export async function resolveKennelTags(
  tags: string[],
  sourceId?: string,
): Promise<ResolveResult[]> {
  return Promise.all(tags.map((tag) => resolveKennelTag(tag, sourceId)));
}

/**
 * Resolve a raw kennel tag to a Kennel ID.
 *
 * Pipeline (each lookup source-scoped first, then global):
 * 0. Kennel.kennelCode (case-insensitive, immutable identifier)
 * 1. Kennel.shortName
 * 2. KennelAlias.alias
 * 3. Kennel.fullName — source-linked kennels only
 * 4. The source's `config.kennelPatterns` → retry steps 0–2 with the mapped code
 * 5. No match → `{ kennelId: null, matched: false }`
 *
 * A lookup that finds two or more kennels never picks one (R6). If no step
 * finds exactly one kennel, the result is unmatched with
 * `reason: "ambiguous"` and the competing kennelCodes.
 *
 * @param tag - Raw kennel tag from scraper
 * @param sourceId - Source the tag came from; scopes lookups, full names and patterns
 */
export async function resolveKennelTag(
  tag: string,
  sourceId?: string,
): Promise<ResolveResult> {
  const normalized = tag.trim();
  if (!normalized) return { ...UNMATCHED };

  const cacheKey = sourceId ? `${normalized.toLowerCase()}:${sourceId}` : normalized.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const result = await resolveUncached(normalized, sourceId);
  cache.set(cacheKey, result);
  return result;
}

async function resolveUncached(normalized: string, sourceId?: string): Promise<ResolveResult> {
  let firstAmbiguous: StepOutcome = null;
  const steps = [resolveDirect, resolveViaFullName, resolveViaSourcePatterns];
  for (const step of steps) {
    const outcome = await step(normalized, sourceId);
    if (outcome?.kind === "hit") return { kennelId: outcome.kennelId, matched: true };
    firstAmbiguous ??= outcome;
  }
  if (firstAmbiguous?.kind === "ambiguous") {
    return { kennelId: null, matched: false, reason: "ambiguous", candidates: firstAmbiguous.candidates };
  }
  return { ...UNMATCHED };
}

/** Human-readable reason for an unmatched tag, for samples and alerts. */
export function describeUnmatched(tag: string, result: ResolveResult): string {
  if (result.reason === "ambiguous") {
    return `"${tag}" matches several kennels (${result.candidates?.join(", ") ?? "?"}); `
      + "add an alias on the right kennel or link it to this source";
  }
  return `Create kennel or alias for "${tag}"`;
}
