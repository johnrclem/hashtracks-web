import type { SourceType } from "@/generated/prisma/client";
import type { SourceAdapter } from "./types";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { BFMAdapter } from "./html-scraper/bfm";
import { HashPhillyAdapter } from "./html-scraper/hashphilly";
import { CityHashAdapter } from "./html-scraper/city-hash";
import { WestLondonHashAdapter } from "./html-scraper/west-london-hash";
import { LondonHashAdapter } from "./html-scraper/london-hash";
import { ChicagoHashAdapter } from "./html-scraper/chicago-hash";
import { ChicagoTH3Adapter } from "./html-scraper/chicago-th3";
import { SFH3Adapter } from "./html-scraper/sfh3";
import { EWH3Adapter } from "./html-scraper/ewh3";
import { DCH4Adapter } from "./html-scraper/dch4";
import { OFH3Adapter } from "./html-scraper/ofh3";
import { HangoverAdapter } from "./html-scraper/hangover";
import { BarnesHashAdapter } from "./html-scraper/barnes-hash";
import { OCH3Adapter } from "./html-scraper/och3";
import { SlashHashAdapter } from "./html-scraper/slash-hash";
import { EnfieldHashAdapter } from "./html-scraper/enfield-hash";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";
import { ICalAdapter } from "./ical/adapter";
import { HashRegoAdapter } from "./hashrego/adapter";
import { MeetupAdapter } from "./meetup/adapter";
import { RssAdapter } from "./rss/adapter";

const adapters: Partial<Record<SourceType, () => SourceAdapter>> = {
  HTML_SCRAPER: () => new HashNYCAdapter(), // default HTML scraper
  GOOGLE_CALENDAR: () => new GoogleCalendarAdapter(),
  GOOGLE_SHEETS: () => new GoogleSheetsAdapter(),
  ICAL_FEED: () => new ICalAdapter(),
  HASHREGO: () => new HashRegoAdapter(),
  MEETUP: () => new MeetupAdapter(),
  RSS_FEED: () => new RssAdapter(),
};

/** Single source of truth for URL-routed HTML scrapers: pattern, adapter name, factory. */
interface HtmlScraperEntry {
  pattern: RegExp;
  name: string;
  factory: () => SourceAdapter;
}

const htmlScraperEntries: HtmlScraperEntry[] = [
  { pattern: /benfranklinmob/i,          name: "BFMAdapter",          factory: () => new BFMAdapter() },
  { pattern: /hashphilly/i,              name: "HashPhillyAdapter",   factory: () => new HashPhillyAdapter() },
  { pattern: /cityhash\.org/i,           name: "CityHashAdapter",     factory: () => new CityHashAdapter() },
  { pattern: /westlondonhash/i,          name: "WestLondonHashAdapter", factory: () => new WestLondonHashAdapter() },
  { pattern: /barnesh3\.com/i,           name: "BarnesHashAdapter",   factory: () => new BarnesHashAdapter() },
  { pattern: /och3\.org/i,              name: "OCH3Adapter",          factory: () => new OCH3Adapter() },
  { pattern: /londonhash\.org\/slah3/i, name: "SlashHashAdapter",     factory: () => new SlashHashAdapter() },
  { pattern: /londonhash\.org/i,        name: "LondonHashAdapter",    factory: () => new LondonHashAdapter() },
  { pattern: /enfieldhash\.org/i,       name: "EnfieldHashAdapter",   factory: () => new EnfieldHashAdapter() },
  { pattern: /chicagohash\.org/i,       name: "ChicagoHashAdapter",   factory: () => new ChicagoHashAdapter() },
  { pattern: /chicagoth3\.com/i,        name: "ChicagoTH3Adapter",    factory: () => new ChicagoTH3Adapter() },
  { pattern: /sfh3\.com/i,             name: "SFH3Adapter",           factory: () => new SFH3Adapter() },
  { pattern: /ewh3\.com/i,             name: "EWH3Adapter",           factory: () => new EWH3Adapter() },
  { pattern: /dch4\.org/i,             name: "DCH4Adapter",           factory: () => new DCH4Adapter() },
  { pattern: /ofh3\.com/i,             name: "OFH3Adapter",           factory: () => new OFH3Adapter() },
  { pattern: /hangoverhash\.digitalpress/i, name: "HangoverAdapter",  factory: () => new HangoverAdapter() },
];

/** URL-based routing for HTML_SCRAPER — derived from htmlScraperEntries (single source of truth). */
const htmlScrapersByUrl: [RegExp, () => SourceAdapter][] =
  htmlScraperEntries.map(({ pattern, factory }) => [pattern, factory]);

/**
 * Returns the adapter class name if the URL matches a site-specific HTML scraper, else null.
 * Used by the AI config suggestion to detect whether a custom adapter already exists.
 */
export function findHtmlAdapter(url: string): string | null {
  for (const { pattern, name } of htmlScraperEntries) {
    if (pattern.test(url)) return name;
  }
  return null;
}

/** Factory function: returns the appropriate SourceAdapter for a given source type and URL. URL-based routing applies for HTML_SCRAPER types. */
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
