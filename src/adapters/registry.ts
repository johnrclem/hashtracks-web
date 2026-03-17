import type { SourceType } from "@/generated/prisma/client";
import type { SourceAdapter } from "./types";
import { GenericHtmlAdapter, isGenericHtmlConfig } from "./html-scraper/generic";
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
import { SHITH3Adapter } from "./html-scraper/shith3";
import { BarnesHashAdapter } from "./html-scraper/barnes-hash";
import { OCH3Adapter } from "./html-scraper/och3";
import { SlashHashAdapter } from "./html-scraper/slash-hash";
import { EnfieldHashAdapter } from "./html-scraper/enfield-hash";
import { WCFHCalendarAdapter } from "./html-scraper/wcfh-calendar";
import { AtlantaHashBoardAdapter } from "./html-scraper/atlanta-hash-board";
import { NorthboroHashAdapter } from "./html-scraper/northboro-hash";
import { DublinHashAdapter } from "./html-scraper/dublin-hash";
import { BurlingtonHashAdapter } from "./html-scraper/burlington-hash";
import { RIH3Adapter } from "./html-scraper/rih3";
import { BrassMonkeyAdapter } from "./html-scraper/brass-monkey";
import { DFWHashAdapter } from "./html-scraper/dfw-hash";
import { SOH4Adapter } from "./html-scraper/soh4";
import { HalveMeinAdapter } from "./html-scraper/halvemein";
import { IthacaH3Adapter } from "./html-scraper/ithaca-h3";
import { HockessinAdapter } from "./html-scraper/hockessin";
import { RenegadeH3Adapter } from "./html-scraper/renegade-h3";
import { SWH3Adapter } from "./html-scraper/swh3";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";
import { ICalAdapter } from "./ical/adapter";
import { HashRegoAdapter } from "./hashrego/adapter";
import { MeetupAdapter } from "./meetup/adapter";
import { RssAdapter } from "./rss/adapter";
import { StaticScheduleAdapter } from "./static-schedule/adapter";

const adapters: Partial<Record<SourceType, () => SourceAdapter>> = {
  HTML_SCRAPER: () => new HashNYCAdapter(), // default HTML scraper
  GOOGLE_CALENDAR: () => new GoogleCalendarAdapter(),
  GOOGLE_SHEETS: () => new GoogleSheetsAdapter(),
  ICAL_FEED: () => new ICalAdapter(),
  HASHREGO: () => new HashRegoAdapter(),
  MEETUP: () => new MeetupAdapter(),
  RSS_FEED: () => new RssAdapter(),
  STATIC_SCHEDULE: () => new StaticScheduleAdapter(),
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
  { pattern: /makesweat\.com\/cityhash/i, name: "CityHashAdapter",     factory: () => new CityHashAdapter() },
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
  { pattern: /shith3\.com/i,                 name: "SHITH3Adapter",    factory: () => new SHITH3Adapter() },
  { pattern: /jollyrogerh3\.com/i,           name: "WCFHCalendarAdapter", factory: () => new WCFHCalendarAdapter() },
  { pattern: /board\.atlantahash\.com/i,     name: "AtlantaHashBoardAdapter", factory: () => new AtlantaHashBoardAdapter() },
  { pattern: /northboroh3\.com/i,             name: "NorthboroHashAdapter",    factory: () => new NorthboroHashAdapter() },
  { pattern: /dublinhhh\.com/i,              name: "DublinHashAdapter",       factory: () => new DublinHashAdapter() },
  { pattern: /burlingtonh3\.com/i,          name: "BurlingtonHashAdapter",   factory: () => new BurlingtonHashAdapter() },
  { pattern: /rih3\.com/i,                 name: "RIH3Adapter",             factory: () => new RIH3Adapter() },
  { pattern: /teambrassmonkey\.blogspot/i, name: "BrassMonkeyAdapter",      factory: () => new BrassMonkeyAdapter() },
  { pattern: /dfwhhh\.org/i,              name: "DFWHashAdapter",           factory: () => new DFWHashAdapter() },
  { pattern: /soh4\.com/i,               name: "SOH4Adapter",              factory: () => new SOH4Adapter() },
  { pattern: /hmhhh\.com/i,              name: "HalveMeinAdapter",         factory: () => new HalveMeinAdapter() },
  { pattern: /ithacah3\.org/i,           name: "IthacaH3Adapter",          factory: () => new IthacaH3Adapter() },
  { pattern: /hockessinhash\.org/i,     name: "HockessinAdapter",         factory: () => new HockessinAdapter() },
  { pattern: /renegadeh3\.com/i,       name: "RenegadeH3Adapter",        factory: () => new RenegadeH3Adapter() },
  { pattern: /swh3\.wordpress\.com/i, name: "SWH3Adapter",              factory: () => new SWH3Adapter() },
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

/** Factory function: returns the appropriate SourceAdapter for a given source type, URL, and optional config. URL-based routing applies for HTML_SCRAPER types; generic config routing falls back when no named adapter matches. */
export function getAdapter(
  sourceType: SourceType,
  sourceUrl?: string,
  sourceConfig?: Record<string, unknown> | null,
): SourceAdapter {
  // For HTML scrapers, check URL-based routing first (named adapters take priority)
  if (sourceType === "HTML_SCRAPER" && sourceUrl) {
    for (const [pattern, factory] of htmlScrapersByUrl) {
      if (pattern.test(sourceUrl)) return factory();
    }
  }

  // For HTML scrapers with a generic config, use GenericHtmlAdapter
  if (sourceType === "HTML_SCRAPER" && isGenericHtmlConfig(sourceConfig)) {
    return new GenericHtmlAdapter();
  }

  const factory = adapters[sourceType];
  if (!factory) {
    throw new Error(`Adapter not implemented for source type: ${sourceType}`);
  }
  return factory();
}
