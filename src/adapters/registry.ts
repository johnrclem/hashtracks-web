import type { SourceType } from "@/generated/prisma/client";
import type { SourceAdapter } from "./types";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { BFMAdapter } from "./html-scraper/bfm";
import { HashPhillyAdapter } from "./html-scraper/hashphilly";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";

const adapters: Partial<Record<SourceType, () => SourceAdapter>> = {
  HTML_SCRAPER: () => new HashNYCAdapter(), // default HTML scraper
  GOOGLE_CALENDAR: () => new GoogleCalendarAdapter(),
  GOOGLE_SHEETS: () => new GoogleSheetsAdapter(),
};

/** URL-based routing for HTML_SCRAPER sources with site-specific adapters */
const htmlScrapersByUrl: [RegExp, () => SourceAdapter][] = [
  [/benfranklinmob/i, () => new BFMAdapter()],
  [/hashphilly/i, () => new HashPhillyAdapter()],
];

export function getAdapter(sourceType: SourceType, sourceUrl?: string): SourceAdapter {
  // For HTML scrapers, check URL-based routing first
  if (sourceType === "HTML_SCRAPER" && sourceUrl) {
    for (const [pattern, factory] of htmlScrapersByUrl) {
      if (pattern.test(sourceUrl)) return factory();
    }
  }

  const factory = adapters[sourceType];
  if (!factory) {
    throw new Error(`Adapter not implemented for source type: ${sourceType}`);
  }
  return factory();
}
