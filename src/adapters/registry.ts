import type { SourceType } from "@/generated/prisma/client";
import type { SourceAdapter } from "./types";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { BFMAdapter } from "./html-scraper/bfm";
import { HashPhillyAdapter } from "./html-scraper/hashphilly";
import { CityHashAdapter } from "./html-scraper/city-hash";
import { WestLondonHashAdapter } from "./html-scraper/west-london-hash";
import { LondonHashAdapter } from "./html-scraper/london-hash";
import { EWH3Adapter } from "./html-scraper/ewh3";
import { DCH4Adapter } from "./html-scraper/dch4";
import { OFH3Adapter } from "./html-scraper/ofh3";
import { HangoverAdapter } from "./html-scraper/hangover";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";
import { ICalAdapter } from "./ical/adapter";
import { HashRegoAdapter } from "./hashrego/adapter";

const adapters: Partial<Record<SourceType, () => SourceAdapter>> = {
  HTML_SCRAPER: () => new HashNYCAdapter(), // default HTML scraper
  GOOGLE_CALENDAR: () => new GoogleCalendarAdapter(),
  GOOGLE_SHEETS: () => new GoogleSheetsAdapter(),
  ICAL_FEED: () => new ICalAdapter(),
  HASHREGO: () => new HashRegoAdapter(),
};

/** URL-based routing for HTML_SCRAPER sources with site-specific adapters */
const htmlScrapersByUrl: [RegExp, () => SourceAdapter][] = [
  [/benfranklinmob/i, () => new BFMAdapter()],
  [/hashphilly/i, () => new HashPhillyAdapter()],
  [/cityhash\.org/i, () => new CityHashAdapter()],
  [/westlondonhash/i, () => new WestLondonHashAdapter()],
  [/londonhash\.org/i, () => new LondonHashAdapter()],
  [/ewh3\.com/i, () => new EWH3Adapter()],
  [/dch4\.org/i, () => new DCH4Adapter()],
  [/ofh3\.com/i, () => new OFH3Adapter()],
  [/hangoverhash\.digitalpress/i, () => new HangoverAdapter()],
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
