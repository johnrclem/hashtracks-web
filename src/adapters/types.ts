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
  startTime?: string; // HH:MM (local time)
  sourceUrl?: string;
}

/** Result of a single adapter scrape run */
export interface ScrapeResult {
  events: RawEventData[];
  errors: string[];
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
}
