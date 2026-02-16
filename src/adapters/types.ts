import type { SourceType, Source } from "@/generated/prisma/client";

/** Raw event data extracted from a source before kennel resolution or deduplication */
export interface RawEventData {
  date: string; // YYYY-MM-DD
  kennelTag: string; // Raw kennel identifier from source (e.g. "NYCH3", "Brooklyn")
  runNumber?: number;
  title?: string;
  description?: string;
  hares?: string;
  location?: string;
  locationUrl?: string; // Google Maps or other maps URL
  startTime?: string; // HH:MM (local time)
  sourceUrl?: string;
}

/** Structured parse error with row-level context (Phase 2A) */
export interface ParseError {
  row: number; // Which row in the source data failed
  section?: string; // Which section/table (e.g., "past_hashes", "future_hashes")
  field?: string; // Which field failed (e.g., "hares", "location", "title")
  error: string; // Error message
  partialData?: Partial<RawEventData>; // What we successfully parsed before the error
}

/** Structured error breakdown by category (Phase 2A) */
export interface ErrorDetails {
  fetch?: Array<{ url?: string; status?: number; message: string }>; // Fetch/network errors
  parse?: ParseError[]; // Parse errors with row context
  merge?: Array<{ fingerprint?: string; reason: string }>; // Merge/dedup errors
}

/** Sample event that was blocked or skipped (Phase 2B) */
export interface EventSample {
  reason: string; // Why it was blocked/skipped (e.g., "SOURCE_KENNEL_MISMATCH", "UNMATCHED_TAG")
  kennelTag: string; // The kennel tag from the event
  event: Partial<RawEventData>; // The event data
  suggestedAction?: string; // Suggested fix (e.g., "Link GGFM to this source")
}

/** Result of a single adapter scrape run */
export interface ScrapeResult {
  events: RawEventData[];
  errors: string[]; // Legacy flat errors (kept for backwards compat)
  errorDetails?: ErrorDetails; // Phase 2A: Structured error breakdown
  structureHash?: string; // HTML structural fingerprint (HTML adapters only)
  diagnosticContext?: Record<string, unknown>; // Phase 3B: Per-adapter metadata
}

/** All adapters implement this interface */
export interface SourceAdapter {
  type: SourceType;
  fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult>;
}

/** Result of the merge pipeline processing */
export interface MergeResult {
  created: number;
  updated: number;
  skipped: number;
  unmatched: string[]; // kennel tags that couldn't be resolved
  blocked: number; // events skipped due to source-kennel mismatch
  blockedTags: string[]; // kennel tags that resolved but weren't linked to source
  eventErrors: number; // count of individual events that failed to process
  eventErrorMessages: string[]; // error messages (capped at 50)
  mergeErrorDetails?: Array<{ fingerprint?: string; reason: string }>; // Phase 2A: Structured merge errors
  sampleBlocked?: EventSample[]; // Phase 2B: 3-5 example blocked events
  sampleSkipped?: EventSample[]; // Phase 2B: 3-5 example skipped events
}
