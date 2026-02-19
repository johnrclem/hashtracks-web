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
  [/barnesh3\.com/i, () => new BarnesHashAdapter()],
  [/och3\.org/i, () => new OCH3Adapter()],
  [/londonhash\.org\/slah3/i, () => new SlashHashAdapter()],
  [/londonhash\.org/i, () => new LondonHashAdapter()],
  [/enfieldhash\.org/i, () => new EnfieldHashAdapter()],
  [/chicagohash\.org/i, () => new ChicagoHashAdapter()],
  [/chicagoth3\.com/i, () => new ChicagoTH3Adapter()],
  [/sfh3\.com/i, () => new SFH3Adapter()],
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
