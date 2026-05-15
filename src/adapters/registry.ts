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
import { SDH3Adapter } from "./html-scraper/sdh3";
import { PhoenixHHHAdapter } from "./html-scraper/phoenixhhh";
import { EdinburghH3Adapter } from "./html-scraper/edinburgh-h3";
import { NorfolkH3Adapter } from "./html-scraper/norfolk-h3";
import { MerseyThirstdaysAdapter } from "./html-scraper/mersey-thirstdays";
import { BullMoonAdapter } from "./html-scraper/bull-moon";
import { GlasgowH3Adapter } from "./html-scraper/glasgow-h3";
import { FrankfurtHashAdapter } from "./html-scraper/frankfurt-hash";
import { VoodooH3Adapter } from "./html-scraper/voodoo-h3";
import { CapeFearH3Adapter } from "./html-scraper/cape-fear-h3";
import { KCH3Adapter } from "./html-scraper/kch3";
import { BigHumpAdapter } from "./html-scraper/big-hump";
import { StlH3Adapter } from "./html-scraper/stlh3";
import { BrewCityH3Adapter } from "./html-scraper/brew-city-h3";
import { BruH3Adapter } from "./html-scraper/bruh3";
import { AH3Adapter } from "./html-scraper/ah3";
import { Eh3EdmontonAdapter } from "./html-scraper/eh3-edmonton";
import { TrueTrailH3Adapter } from "./html-scraper/true-trail-h3";
import { HagueH3Adapter } from "./html-scraper/hague-h3";
import { F3H3Adapter } from "./html-scraper/f3h3";
import { SumoH3Adapter } from "./html-scraper/sumo-h3";
import { YokoYokoH3Adapter } from "./html-scraper/yoko-yoko-h3";
import { SamuraiH3Adapter } from "./html-scraper/samurai-h3";
import { NewTokyoKatchAdapter } from "./html-scraper/new-tokyo-katch";
import { Hayama4HAdapter } from "./html-scraper/hayama-4h";
import { SevenHillsH3Adapter } from "./html-scraper/seven-hills-h3";
import { Oh3OttawaAdapter } from "./html-scraper/oh3-ottawa";
import { CalgaryH3HomeAdapter } from "./html-scraper/calgary-h3-home";
import { CalgaryH3ScribeAdapter } from "./html-scraper/calgary-h3-scribe";
import { Bfh3Adapter } from "./html-scraper/bfh3";
import { IndyH3Adapter } from "./html-scraper/indyh3";
import { ChooChooH3Adapter } from "./html-scraper/choo-choo-h3";
import { LionCityH3Adapter } from "./html-scraper/lion-city-h3";
import { KampongH3Adapter } from "./html-scraper/kampong-h3";
import { HashHorrorsAdapter } from "./html-scraper/hash-horrors";
import { SeletarH3Adapter } from "./html-scraper/seletar-h3";
import { MotherHashAdapter } from "./html-scraper/mother-hash";
import { YiiHarelineAdapter } from "./html-scraper/yii-hareline";
import { KljH3Adapter } from "./html-scraper/klj-h3";
import { GoHashAdapter } from "./html-scraper/gohash";
import { KjHarimauAdapter } from "./html-scraper/kj-harimau";
import { Sh3AuAdapter } from "./html-scraper/sh3-au";
import { AdelaideH3Adapter } from "./html-scraper/adelaide-h3";
import { GoldCoastH3Adapter } from "./html-scraper/gold-coast-h3";
import { LarrikinsAdapter } from "./html-scraper/larrikins";
import { SydneyThirstyH3Adapter } from "./html-scraper/sydney-thirsty-h3";
import { N2TH3Adapter } from "./html-scraper/n2th3";
import { LswH3Adapter } from "./html-scraper/lsw-h3";
import { LadiesH4HkAdapter } from "./html-scraper/ladies-h4-hk";
import { Hkh3Adapter } from "./html-scraper/hkh3";
import { Cah3Adapter } from "./html-scraper/cah3";
import { Crh3Adapter } from "./html-scraper/crh3";
import { BkkHarriettesAdapter } from "./html-scraper/bkk-harriettes";
import { PhuketHHHAdapter } from "./html-scraper/phuket-hhh";
import { ChiangMaiHHHAdapter } from "./html-scraper/chiangmai-hhh";
import { BangkokHashAdapter } from "./html-scraper/bangkokhash";
import { PattayaH3Adapter } from "./html-scraper/pattaya-h3";
import { BangkokBikersAdapter } from "./html-scraper/bangkok-bikers";
import { BangkokH3Adapter } from "./html-scraper/bangkok-h3";
import { LVH3Adapter } from "./html-scraper/lvh3";
import { BoulderH3Adapter } from "./html-scraper/boulder-h3";
import { Ch4DkAdapter } from "./html-scraper/ch4-dk";
import { MiteriHarelineAdapter } from "./html-scraper/miteri-hareline";
import { AucklandHussiesAdapter } from "./html-scraper/auckland-hussies";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";
import { ICalAdapter } from "./ical/adapter";
import { HashRegoAdapter } from "./hashrego/adapter";
import { MeetupAdapter } from "./meetup/adapter";
import { RssAdapter } from "./rss/adapter";
import { StaticScheduleAdapter } from "./static-schedule/adapter";
import { HarrierCentralAdapter } from "./harrier-central/adapter";
import { FacebookHostedEventsAdapter } from "./facebook-hosted-events/adapter";

const adapters: Partial<Record<SourceType, () => SourceAdapter>> = {
  HTML_SCRAPER: () => new HashNYCAdapter(), // default HTML scraper
  GOOGLE_CALENDAR: () => new GoogleCalendarAdapter(),
  GOOGLE_SHEETS: () => new GoogleSheetsAdapter(),
  ICAL_FEED: () => new ICalAdapter(),
  HASHREGO: () => new HashRegoAdapter(),
  MEETUP: () => new MeetupAdapter(),
  RSS_FEED: () => new RssAdapter(),
  STATIC_SCHEDULE: () => new StaticScheduleAdapter(),
  HARRIER_CENTRAL: () => new HarrierCentralAdapter(),
  FACEBOOK_HOSTED_EVENTS: () => new FacebookHostedEventsAdapter(),
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
  { pattern: /sdh3\.com/i,            name: "SDH3Adapter",              factory: () => new SDH3Adapter() },
  { pattern: /phoenixhhh\.org/i,    name: "PhoenixHHHAdapter",        factory: () => new PhoenixHHHAdapter() },
  { pattern: /edinburghh3\.com/i,  name: "EdinburghH3Adapter",       factory: () => new EdinburghH3Adapter() },
  { pattern: /norfolkh3\.co\.uk/i, name: "NorfolkH3Adapter",        factory: () => new NorfolkH3Adapter() },
  { pattern: /merseythirstdayshash/i, name: "MerseyThirstdaysAdapter", factory: () => new MerseyThirstdaysAdapter() },
  { pattern: /bullmoonh3/i,          name: "BullMoonAdapter",         factory: () => new BullMoonAdapter() },
  { pattern: /glasgowh3\.co\.uk/i, name: "GlasgowH3Adapter",        factory: () => new GlasgowH3Adapter() },
  { pattern: /frankfurt-hash\.de/i, name: "FrankfurtHashAdapter",    factory: () => new FrankfurtHashAdapter() },
  { pattern: /voodoohash\.com/i,    name: "VoodooH3Adapter",         factory: () => new VoodooH3Adapter() },
  { pattern: /capefearh3\.com/i,   name: "CapeFearH3Adapter",      factory: () => new CapeFearH3Adapter() },
  { pattern: /bruh3\.eu/i,          name: "BruH3Adapter",            factory: () => new BruH3Adapter() },
  { pattern: /ah3\.nl/i,            name: "AH3Adapter",              factory: () => new AH3Adapter() },
  { pattern: /haguehash\.nl/i,      name: "HagueH3Adapter",          factory: () => new HagueH3Adapter() },
  { pattern: /f3h3\.net/i,         name: "F3H3Adapter",            factory: () => new F3H3Adapter() },
  { pattern: /sumoh3\.gotothehash/i, name: "SumoH3Adapter",        factory: () => new SumoH3Adapter() },
  { pattern: /y2h3\.net/i,          name: "YokoYokoH3Adapter",     factory: () => new YokoYokoH3Adapter() },
  { pattern: /samuraihash.*wixsite/i, name: "SamuraiH3Adapter",    factory: () => new SamuraiH3Adapter() },
  { pattern: /newtokyohash.*wixsite/i, name: "NewTokyoKatchAdapter", factory: () => new NewTokyoKatchAdapter() },
  { pattern: /sites\.google\.com\/site\/hayama4h/i, name: "Hayama4HAdapter", factory: () => new Hayama4HAdapter() },
  { pattern: /sites\.google\.com\/view\/7h4/i, name: "SevenHillsH3Adapter", factory: () => new SevenHillsH3Adapter() },
  { pattern: /kansascityh3\.com/i, name: "KCH3Adapter", factory: () => new KCH3Adapter() },
  { pattern: /big-hump\.com/i, name: "BigHumpAdapter", factory: () => new BigHumpAdapter() },
  { pattern: /stlh3\.com/i, name: "StlH3Adapter", factory: () => new StlH3Adapter() },
  { pattern: /brewcityh3\.com/i, name: "BrewCityH3Adapter", factory: () => new BrewCityH3Adapter() },
  { pattern: /eh3\.org/i, name: "Eh3EdmontonAdapter", factory: () => new Eh3EdmontonAdapter() },
  { pattern: /truetrailh3\.com/i, name: "TrueTrailH3Adapter", factory: () => new TrueTrailH3Adapter() },
  { pattern: /docs\.google\.com\/document\/d\/1jGyBUKxOYkxrZg8WVfpBYDP84fbacanoX_TJuyCmtAI/i, name: "Oh3OttawaAdapter", factory: () => new Oh3OttawaAdapter() },
  { pattern: /home\.onon\.org/i, name: "CalgaryH3HomeAdapter", factory: () => new CalgaryH3HomeAdapter() },
  { pattern: /scribe\.onon\.org/i, name: "CalgaryH3ScribeAdapter", factory: () => new CalgaryH3ScribeAdapter() },
  { pattern: /bfh3\.com/i, name: "Bfh3Adapter", factory: () => new Bfh3Adapter() },
  { pattern: /indyhhh\.com/i, name: "IndyH3Adapter", factory: () => new IndyH3Adapter() },
  { pattern: /choochooh3\.com/i, name: "ChooChooH3Adapter", factory: () => new ChooChooH3Adapter() },
  { pattern: /lioncityhhh\.com/i, name: "LionCityH3Adapter", factory: () => new LionCityH3Adapter() },
  { pattern: /kampong\.hash\.org\.sg/i, name: "KampongH3Adapter", factory: () => new KampongH3Adapter() },
  { pattern: /hashhousehorrors\.com/i, name: "HashHorrorsAdapter", factory: () => new HashHorrorsAdapter() },
  { pattern: /sh3app\.hash\.org\.sg/i, name: "SeletarH3Adapter", factory: () => new SeletarH3Adapter() },
  // ── Malaysia (Phase 1: KL + Penang founder pack) ──
  { pattern: /motherhash\.org/i, name: "MotherHashAdapter", factory: () => new MotherHashAdapter() },
  { pattern: /ph3\.org/i, name: "YiiHarelineAdapter", factory: () => new YiiHarelineAdapter() },
  { pattern: /klfullmoonhash\.com/i, name: "YiiHarelineAdapter", factory: () => new YiiHarelineAdapter() },
  { pattern: /kljhhh\.org/i, name: "KljH3Adapter", factory: () => new KljH3Adapter() },
  { pattern: /penanghash3\.org/i, name: "GoHashAdapter", factory: () => new GoHashAdapter() },
  { pattern: /hashhouseharrietspenang\.com/i, name: "GoHashAdapter", factory: () => new GoHashAdapter() },
  { pattern: /khhhkj\.blogspot\.com/i, name: "KjHarimauAdapter", factory: () => new KjHarimauAdapter() },
  // ── Australia (Phase 1b: Sydney + Adelaide + Gold Coast) ──
  { pattern: /sh3\.link/i, name: "Sh3AuAdapter", factory: () => new Sh3AuAdapter() },
  { pattern: /ah3\.com\.au/i, name: "AdelaideH3Adapter", factory: () => new AdelaideH3Adapter() },
  { pattern: /goldcoasthash\.org/i, name: "GoldCoastH3Adapter", factory: () => new GoldCoastH3Adapter() },
  { pattern: /sydney\.larrikins\.org/i, name: "LarrikinsAdapter", factory: () => new LarrikinsAdapter() },
  { pattern: /sth3\.org/i, name: "SydneyThirstyH3Adapter", factory: () => new SydneyThirstyH3Adapter() },
  // ── Hong Kong (Phase 1) ──
  { pattern: /n2th3\.org|n2th3\.wordpress/i, name: "N2TH3Adapter", factory: () => new N2TH3Adapter() },
  { pattern: /datadesignfactory\.com\/lsw/i, name: "LswH3Adapter", factory: () => new LswH3Adapter() },
  { pattern: /hkladiesh4\.wixsite/i, name: "LadiesH4HkAdapter", factory: () => new LadiesH4HkAdapter() },
  { pattern: /^https?:\/\/(?:www\.)?hkhash\.com(?:[/?#].*)?$/i, name: "Hkh3Adapter", factory: () => new Hkh3Adapter() },
  // ── Thailand (Phase 1a) ──
  { pattern: /cah3\.net/i, name: "Cah3Adapter", factory: () => new Cah3Adapter() },
  { pattern: /chiangraihhh\.blogspot/i, name: "Crh3Adapter", factory: () => new Crh3Adapter() },
  { pattern: /bangkokharriettes\.wordpress/i, name: "BkkHarriettesAdapter", factory: () => new BkkHarriettesAdapter() },
  { pattern: /phuket-hhh\.com/i, name: "PhuketHHHAdapter", factory: () => new PhuketHHHAdapter() },
  { pattern: /chiangmaihhh\.com/i, name: "ChiangMaiHHHAdapter", factory: () => new ChiangMaiHHHAdapter() },
  { pattern: /bangkokhash\.com/i, name: "BangkokHashAdapter", factory: () => new BangkokHashAdapter() },
  { pattern: /pattayah3\.com/i, name: "PattayaH3Adapter", factory: () => new PattayaH3Adapter() },
  { pattern: /bangkokbikehash\.org/i, name: "BangkokBikersAdapter", factory: () => new BangkokBikersAdapter() },
  { pattern: /bangkokhhh\.org/i, name: "BangkokH3Adapter", factory: () => new BangkokH3Adapter() },
  // ── Nevada ──
  { pattern: /lvh3\.org/i, name: "LVH3Adapter", factory: () => new LVH3Adapter() },
  // ── Colorado ──
  { pattern: /boulderh3\.com/i, name: "BoulderH3Adapter", factory: () => new BoulderH3Adapter() },
  // ── Denmark ──
  { pattern: /ch4\.dk/i, name: "Ch4DkAdapter", factory: () => new Ch4DkAdapter() },
  // ── New Zealand (Phase 1) ──
  { pattern: /gardencityhash\.co\.nz/i,    name: "MiteriHarelineAdapter", factory: () => new MiteriHarelineAdapter() },
  { pattern: /christchurchhash\.net\.nz/i, name: "MiteriHarelineAdapter", factory: () => new MiteriHarelineAdapter() },
  { pattern: /aucklandhussies\.co\.nz/i,   name: "AucklandHussiesAdapter", factory: () => new AucklandHussiesAdapter() },
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
