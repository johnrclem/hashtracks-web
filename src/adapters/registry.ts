import type { SourceType } from "@/generated/prisma/client";
import type { SourceAdapter } from "./types";
import { onHost, type HostMatcher } from "./host-matcher";
import { GenericHtmlAdapter, isGenericHtmlConfig } from "./html-scraper/generic";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { BFMAdapter } from "./html-scraper/bfm";
import { BfmSpecialEventsAdapter } from "./html-scraper/bfm-special-events";
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
import { BaliHash2Adapter } from "./html-scraper/bali-hash-2";
import { SHITH3Adapter } from "./html-scraper/shith3";
import { BarnesHashAdapter } from "./html-scraper/barnes-hash";
import { MijasHashAdapter } from "./html-scraper/mijas-hash";
import { MadridHashAdapter } from "./html-scraper/madrid-hash";
import { AucklandHashAdapter } from "./html-scraper/auckland-hash";
import { OCH3Adapter } from "./html-scraper/och3";
import { SlashHashAdapter } from "./html-scraper/slash-hash";
import { TamarValleyH3Adapter } from "./html-scraper/tamar-valley-h3";
import { EnfieldHashAdapter } from "./html-scraper/enfield-hash";
import { WCFHCalendarAdapter } from "./html-scraper/wcfh-calendar";
import { AtlantaHashBoardAdapter } from "./html-scraper/atlanta-hash-board";
import { NorthboroHashAdapter } from "./html-scraper/northboro-hash";
import { DublinHashAdapter } from "./html-scraper/dublin-hash";
import { HertsHashAdapter } from "./html-scraper/herts-hash";
import { WarwickHashAdapter } from "./html-scraper/warwick-hash";
import { MkH3Adapter } from "./html-scraper/mkh3";
import { CambridgeHashAdapter } from "./html-scraper/cambridge-hash";
import { EssexHashAdapter } from "./html-scraper/essex-hash";
import { QuornH3Adapter } from "./html-scraper/quorn-h3";
import { DonningtonHashAdapter } from "./html-scraper/donnington-hash";
import { NewCotswoldH3Adapter } from "./html-scraper/new-cotswold-h3";
import { OxfordH3Adapter } from "./html-scraper/oxford-h3";
import { SurreyHashAdapter } from "./html-scraper/surrey-hash";
import { FukFullMoonH3Adapter } from "./html-scraper/fuk-full-moon";
import { SouthHamsH4Adapter } from "./html-scraper/south-hams-h4";
import { WyreForestHashAdapter } from "./html-scraper/wyre-forest-hash";
import { TidewaterH3Adapter } from "./html-scraper/tidewater-h3";
import { DesertHashAdapter } from "./html-scraper/desert-hash";
import { CreekHashAdapter } from "./html-scraper/creek-hash";
import { H5HareHoundsAdapter } from "./html-scraper/h5-hare-hounds";
import { BurlingtonHashAdapter } from "./html-scraper/burlington-hash";
import { RIH3Adapter } from "./html-scraper/rih3";
import { BrassMonkeyAdapter } from "./html-scraper/brass-monkey";
import { BrasiliaH3Adapter } from "./html-scraper/brasilia-h3";
import { TeignValleyH3Adapter } from "./html-scraper/teign-valley-h3";
import { CityOfExeterH3Adapter } from "./html-scraper/city-of-exeter-h3";
import { DevonportH3Adapter } from "./html-scraper/devonport-h3";
import { DFWHashAdapter } from "./html-scraper/dfw-hash";
import { SOH4Adapter } from "./html-scraper/soh4";
import { HalveMeinAdapter } from "./html-scraper/halvemein";
import { IthacaH3Adapter } from "./html-scraper/ithaca-h3";
import { HockessinAdapter } from "./html-scraper/hockessin";
import { NorthWiltsHashAdapter } from "./html-scraper/north-wilts-hash";
import { RenegadeH3Adapter } from "./html-scraper/renegade-h3";
import { SWH3Adapter } from "./html-scraper/swh3";
import { GATRH3Adapter } from "./html-scraper/gatrh3";
import { MaconHashAdapter } from "./html-scraper/macon-hash";
import { ONH3Adapter } from "./html-scraper/onh3";
import { AsuncionH3Adapter } from "./html-scraper/asuncion-h3";
import { SDH3Adapter } from "./html-scraper/sdh3";
import { NCH3Adapter } from "./html-scraper/nch3";
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
import { DCFMH3Adapter } from "./html-scraper/dcfmh3";
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
import { HHHSAdapter } from "./html-scraper/hhhs";
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
import { BangkokMondayHashAdapter } from "./html-scraper/bangkok-monday-hash";
import { TaipeiHashAdapter } from "./html-scraper/taipei-hash";
import { NewTaipeiHashAdapter } from "./html-scraper/new-taipei-hash";
import { KaohsiungHashAdapter } from "./html-scraper/kaohsiung-hash";
import { BoomCalendarAdapter } from "./html-scraper/boom-calendar";
import { PhnomPenhH3Adapter } from "./html-scraper/phnom-penh-h3";
import { VindobonaH3Adapter } from "./html-scraper/vindobona-h3";
import { LarnacaHashAdapter } from "./html-scraper/larnaca-hash";
import { DhekeliaHashAdapter } from "./html-scraper/dhekelia-hash";
import { NicosiaHashAdapter } from "./html-scraper/nicosia-hash";
import { LVH3Adapter } from "./html-scraper/lvh3";
import { BoulderH3Adapter } from "./html-scraper/boulder-h3";
import { BoiseH3Adapter } from "./html-scraper/boiseh3";
import { MuscateersHashAdapter } from "./html-scraper/muscateers-hash";
import { NSWHHHAdapter } from "./html-scraper/nswhhh";
import { ManilaH3Adapter } from "./html-scraper/manila-h3";
import { WarsawH3Adapter } from "./html-scraper/warsaw-h3";
import { ColomboHarriettesAdapter } from "./html-scraper/colombo-harriettes";
import { SeoulH3Adapter } from "./html-scraper/seoul-h3";
import { HimalayanHashAdapter } from "./html-scraper/himalayan-h3";
import { CebuHashAdapter } from "./html-scraper/cebu-hash";
import { BucharestHashAdapter } from "./html-scraper/bucharest-hash";
import { SubicBayHashAdapter } from "./html-scraper/subic-bay-hash";
import { PuertoGaleraHashAdapter } from "./html-scraper/puerto-galera-hash";
import { BombayHashAdapter } from "./html-scraper/bombay-hash";
import { SaigonH3Adapter } from "./html-scraper/saigon-h3";
import { HanoiH3Adapter } from "./html-scraper/hanoi-h3";
import { LaosHashAdapter } from "./html-scraper/laos-hash";
import { JamaicaHashAdapter } from "./html-scraper/jamaica-hash";
import { GrenadaHashAdapter } from "./html-scraper/grenada-hash";
import { VictoriaH3Adapter } from "./html-scraper/victoria-h3";
import { NurembergHashAdapter } from "./html-scraper/nuremberg-hash";
import { Ch4DkAdapter } from "./html-scraper/ch4-dk";
import { MiteriHarelineAdapter } from "./html-scraper/miteri-hareline";
import { AucklandHussiesAdapter } from "./html-scraper/auckland-hussies";
import { CapitalH3Adapter } from "./html-scraper/capital-h3";
import { MoolooHhhAdapter } from "./html-scraper/mooloo-hhh";
import { GeriatrixH3Adapter } from "./html-scraper/geriatrix-h3";
import { HogtownAdapter } from "./html-scraper/hogtown";
import { MhhhCaAdapter } from "./html-scraper/mhhh-ca";
import { SquarespaceEventsAdapter } from "./html-scraper/squarespace-events";
import { TribeEventsAdapter, isTribeEventsConfig } from "./html-scraper/tribe-events-adapter";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";
import { ICalAdapter } from "./ical/adapter";
import { HashRegoAdapter } from "./hashrego/adapter";
import { MeetupAdapter } from "./meetup/adapter";
import { RssAdapter } from "./rss/adapter";
import { StaticScheduleAdapter } from "./static-schedule/adapter";
import { HarrierCentralAdapter } from "./harrier-central/adapter";
import { FacebookHostedEventsAdapter } from "./facebook-hosted-events/adapter";
import { HashStatsAdapter } from "./hashstats/adapter";
import { RiyadhH3Adapter } from "./html-scraper/riyadh-h3";
import { HellgateHashAdapter } from "./html-scraper/hellgate-hash";

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

/**
 * Single source of truth for URL-routed HTML scrapers: host route, adapter name, factory.
 *
 * Routes are `onHost()` matchers, never regexes: a substring regex can claim
 * another kennel's site (`/eh3\.org/` matched `boiseh3.org`). The first matching
 * entry wins, so a path-scoped route on a shared host goes before that host's
 * catch-all route. `registry-routing.test.ts` checks every seeded source.
 */
interface HtmlScraperEntry {
  pattern: HostMatcher;
  name: string;
  factory: () => SourceAdapter;
}

const htmlScraperEntries: HtmlScraperEntry[] = [
  // MORE-SPECIFIC first: the /bfm-special-events/ page is a separate WordPress.com
  // page (marquee annual events) with its own parser; the generic benfranklinmob
  // entry below handles the weekly Thursday runs. (#765)
  { pattern: onHost("benfranklinmob.com", { path: "/bfm-special-events" }), name: "BfmSpecialEventsAdapter", factory: () => new BfmSpecialEventsAdapter() },
  { pattern: onHost("benfranklinmob.com"), name: "BFMAdapter", factory: () => new BFMAdapter() },
  { pattern: onHost("hashphilly.com"), name: "HashPhillyAdapter", factory: () => new HashPhillyAdapter() },
  { pattern: onHost("makesweat.com", { path: "/cityhash" }), name: "CityHashAdapter", factory: () => new CityHashAdapter() },
  { pattern: onHost("westlondonhash.com"), name: "WestLondonHashAdapter", factory: () => new WestLondonHashAdapter() },
  { pattern: onHost("barnesh3.com"), name: "BarnesHashAdapter", factory: () => new BarnesHashAdapter() },
  { pattern: onHost("mijash3.com"), name: "MijasHashAdapter", factory: () => new MijasHashAdapter() },
  { pattern: onHost("madridhhh.com"), name: "MadridHashAdapter", factory: () => new MadridHashAdapter() },
  { pattern: onHost("aucklandhashhouseharriers.co.nz"), name: "AucklandHashAdapter", factory: () => new AucklandHashAdapter() },
  { pattern: onHost("och3.org.uk"), name: "OCH3Adapter", factory: () => new OCH3Adapter() },
  { pattern: onHost("londonhash.org", { path: "/slah3" }), name: "SlashHashAdapter", factory: () => new SlashHashAdapter() },
  { pattern: onHost("londonhash.org"), name: "LondonHashAdapter", factory: () => new LondonHashAdapter() },
  { pattern: onHost("enfieldhash.org"), name: "EnfieldHashAdapter", factory: () => new EnfieldHashAdapter() },
  { pattern: onHost("chicagohash.org"), name: "ChicagoHashAdapter", factory: () => new ChicagoHashAdapter() },
  { pattern: onHost("chicagoth3.com"), name: "ChicagoTH3Adapter", factory: () => new ChicagoTH3Adapter() },
  { pattern: onHost("tvh3.co.uk"), name: "TamarValleyH3Adapter", factory: () => new TamarValleyH3Adapter() },
  { pattern: onHost("sfh3.com"), name: "SFH3Adapter", factory: () => new SFH3Adapter() },
  { pattern: onHost("ewh3.com"), name: "EWH3Adapter", factory: () => new EWH3Adapter() },
  { pattern: onHost("dch4.org"), name: "DCH4Adapter", factory: () => new DCH4Adapter() },
  { pattern: onHost("ofh3.com"), name: "OFH3Adapter", factory: () => new OFH3Adapter() },
  { pattern: onHost("hangoverhash.digitalpress.blog"), name: "HangoverAdapter", factory: () => new HangoverAdapter() },
  { pattern: onHost("balihash2.com"), name: "BaliHash2Adapter", factory: () => new BaliHash2Adapter() },
  { pattern: onHost("shith3.com"), name: "SHITH3Adapter", factory: () => new SHITH3Adapter() },
  { pattern: onHost("jollyrogerh3.com"), name: "WCFHCalendarAdapter", factory: () => new WCFHCalendarAdapter() },
  { pattern: onHost("board.atlantahash.com"), name: "AtlantaHashBoardAdapter", factory: () => new AtlantaHashBoardAdapter() },
  { pattern: onHost("northboroh3.com"), name: "NorthboroHashAdapter", factory: () => new NorthboroHashAdapter() },
  { pattern: onHost("dublinhhh.com"), name: "DublinHashAdapter", factory: () => new DublinHashAdapter() },
  { pattern: onHost("hertshash.co.uk"), name: "HertsHashAdapter", factory: () => new HertsHashAdapter() },
  { pattern: onHost("mkh3.co.uk"), name: "MkH3Adapter", factory: () => new MkH3Adapter() },
  { pattern: onHost("ch3.co.uk", { subdomains: "www" }), name: "CambridgeHashAdapter", factory: () => new CambridgeHashAdapter() },
  { pattern: onHost("essexhhh.co.uk"), name: "EssexHashAdapter", factory: () => new EssexHashAdapter() },
  { pattern: onHost("quornh3.org.uk"), name: "QuornH3Adapter", factory: () => new QuornH3Adapter() },
  { pattern: onHost("donningtonh3.co.uk"), name: "DonningtonHashAdapter", factory: () => new DonningtonHashAdapter() },
  { pattern: onHost("oxfordh3.org.uk"), name: "OxfordH3Adapter", factory: () => new OxfordH3Adapter() },
  { pattern: onHost("warwickhash.org.uk"), name: "WarwickHashAdapter", factory: () => new WarwickHashAdapter() },
  { pattern: onHost("surreyhashhouseharriers.com"), name: "SurreyHashAdapter", factory: () => new SurreyHashAdapter() },
  { pattern: onHost("fukfmh3.co.uk"), name: "FukFullMoonH3Adapter", factory: () => new FukFullMoonH3Adapter() },
  { pattern: onHost("sh4.org.uk"), name: "SouthHamsH4Adapter", factory: () => new SouthHamsH4Adapter() },
  { pattern: onHost("wyreforesthhh.org.uk"), name: "WyreForestHashAdapter", factory: () => new WyreForestHashAdapter() },
  { pattern: onHost("tidewaterh3.org"), name: "TidewaterH3Adapter", factory: () => new TidewaterH3Adapter() },
  // Desert H3 (HashTracks' first UAE kennel, Dubai's oldest hash, est. 1979) — deserthash.org
  // WordPress/Elementor + Modern Events Calendar, fully SSR'd; wp-json + MEC/Tribe REST all
  // disabled → static Cheerio of the home MEC calendar (upcoming) + Hare Line page (recent).
  // Title-filters to "DH3 – Run NNNN" so Moonshine / Interhash entries never ingest under dh3-ae.
  { pattern: onHost("deserthash.org"), name: "DesertHashAdapter", factory: () => new DesertHashAdapter() },
  // Creek H3 (HashTracks' second UAE kennel, Desert H3's sister) — creekhash.org is a
  // self-hosted WordPress site with WP REST disabled (404) → static Cheerio of the home
  // "This Week's Meet Point" flexslider + per-run detail page (labeled fields). Date parsed
  // from the year-bearing post title; the contact-hare phone PII is never scraped.
  { pattern: onHost("creekhash.org"), name: "CreekHashAdapter", factory: () => new CreekHashAdapter() },
  // Riyadh H3 / R3H4 (HashTracks' first Saudi Arabia kennel) — riyadhhash.com is a
  // Lovable React/Vite SPA whose run data is a public Supabase (PostgREST) JSON API.
  // Routed on the full project-ref host (not bare supabase.co), so another
  // Supabase-backed source is never claimed by this entry.
  { pattern: onHost("uleyjftvdnpniabomdpi.supabase.co"), name: "RiyadhH3Adapter", factory: () => new RiyadhH3Adapter() },
  { pattern: onHost("burlingtonh3.com"), name: "BurlingtonHashAdapter", factory: () => new BurlingtonHashAdapter() },
  { pattern: onHost("rih3.com"), name: "RIH3Adapter", factory: () => new RIH3Adapter() },
  { pattern: onHost("teambrassmonkey.blogspot.com"), name: "BrassMonkeyAdapter", factory: () => new BrassMonkeyAdapter() },
  { pattern: onHost("brasiliah3.blogspot.com"), name: "BrasiliaH3Adapter", factory: () => new BrasiliaH3Adapter() },
  { pattern: onHost("teignvalleyh3.com"), name: "TeignValleyH3Adapter", factory: () => new TeignValleyH3Adapter() },
  { pattern: onHost("cityofexeterhhh.blogspot.com"), name: "CityOfExeterH3Adapter", factory: () => new CityOfExeterH3Adapter() },
  { pattern: onHost("dhash.com", { subdomains: "www" }), name: "DevonportH3Adapter", factory: () => new DevonportH3Adapter() },
  { pattern: onHost("dfwhhh.org"), name: "DFWHashAdapter", factory: () => new DFWHashAdapter() },
  { pattern: onHost("soh4.com"), name: "SOH4Adapter", factory: () => new SOH4Adapter() },
  { pattern: onHost("hmhhh.com"), name: "HalveMeinAdapter", factory: () => new HalveMeinAdapter() },
  { pattern: onHost("ithacah3.org"), name: "IthacaH3Adapter", factory: () => new IthacaH3Adapter() },
  { pattern: onHost("newch3.org.uk"), name: "NewCotswoldH3Adapter", factory: () => new NewCotswoldH3Adapter() },
  { pattern: onHost("hockessinhash.org"), name: "HockessinAdapter", factory: () => new HockessinAdapter() },
  { pattern: onHost("renegadeh3.com"), name: "RenegadeH3Adapter", factory: () => new RenegadeH3Adapter() },
  { pattern: onHost("swh3.wordpress.com"), name: "SWH3Adapter", factory: () => new SWH3Adapter() },
  { pattern: onHost("gatrh3.wordpress.com"), name: "GATRH3Adapter", factory: () => new GATRH3Adapter() },
  { pattern: onHost("mgh4.com"), name: "MaconHashAdapter", factory: () => new MaconHashAdapter() },
  // The old substring regex `/onh3\.wordpress\.com/` matched inside
  // `asunci‹onh3›.wordpress.com`, so every Asunción scrape ran the Nairobi (ONH3)
  // adapter and was dropped by the source-kennel guard (#1869/#1968 class).
  { pattern: onHost("onh3.wordpress.com"), name: "ONH3Adapter", factory: () => new ONH3Adapter() },
  { pattern: onHost("asuncionh3.wordpress.com"), name: "AsuncionH3Adapter", factory: () => new AsuncionH3Adapter() },
  { pattern: onHost("nch3.com"), name: "NCH3Adapter", factory: () => new NCH3Adapter() },
  { pattern: onHost("sdh3.com"), name: "SDH3Adapter", factory: () => new SDH3Adapter() },
  { pattern: onHost("phoenixhhh.org"), name: "PhoenixHHHAdapter", factory: () => new PhoenixHHHAdapter() },
  { pattern: onHost("edinburghh3.com"), name: "EdinburghH3Adapter", factory: () => new EdinburghH3Adapter() },
  { pattern: onHost("norfolkh3.co.uk"), name: "NorfolkH3Adapter", factory: () => new NorfolkH3Adapter() },
  { pattern: onHost("merseythirstdayshash.com"), name: "MerseyThirstdaysAdapter", factory: () => new MerseyThirstdaysAdapter() },
  { pattern: onHost("bullmoonh3.co.uk"), name: "BullMoonAdapter", factory: () => new BullMoonAdapter() },
  { pattern: onHost("glasgowh3.co.uk"), name: "GlasgowH3Adapter", factory: () => new GlasgowH3Adapter() },
  { pattern: onHost("h5hashers.org.uk"), name: "H5HareHoundsAdapter", factory: () => new H5HareHoundsAdapter() },
  { pattern: onHost("frankfurt-hash.de"), name: "FrankfurtHashAdapter", factory: () => new FrankfurtHashAdapter() },
  { pattern: onHost("voodoohash.com"), name: "VoodooH3Adapter", factory: () => new VoodooH3Adapter() },
  { pattern: onHost("capefearh3.com"), name: "CapeFearH3Adapter", factory: () => new CapeFearH3Adapter() },
  { pattern: onHost("bruh3.eu"), name: "BruH3Adapter", factory: () => new BruH3Adapter() },
  { pattern: onHost("ah3.nl"), name: "AH3Adapter", factory: () => new AH3Adapter() },
  { pattern: onHost("haguehash.nl"), name: "HagueH3Adapter", factory: () => new HagueH3Adapter() },
  { pattern: onHost("f3h3.net"), name: "F3H3Adapter", factory: () => new F3H3Adapter() },
  { pattern: onHost("sumoh3.gotothehash.net"), name: "SumoH3Adapter", factory: () => new SumoH3Adapter() },
  { pattern: onHost("y2h3.net"), name: "YokoYokoH3Adapter", factory: () => new YokoYokoH3Adapter() },
  { pattern: onHost("samuraihash2017.wixsite.com"), name: "SamuraiH3Adapter", factory: () => new SamuraiH3Adapter() },
  { pattern: onHost("newtokyohash.wixsite.com"), name: "NewTokyoKatchAdapter", factory: () => new NewTokyoKatchAdapter() },
  { pattern: onHost("sites.google.com", { path: "/site/hayama4h" }), name: "Hayama4HAdapter", factory: () => new Hayama4HAdapter() },
  { pattern: onHost("sites.google.com", { path: "/view/7h4" }), name: "SevenHillsH3Adapter", factory: () => new SevenHillsH3Adapter() },
  { pattern: onHost("sites.google.com", { path: "/site/dcfmh3" }), name: "DCFMH3Adapter", factory: () => new DCFMH3Adapter() },
  { pattern: onHost("kansascityh3.com"), name: "KCH3Adapter", factory: () => new KCH3Adapter() },
  { pattern: onHost("nwh3.net", { subdomains: "www" }), name: "NorthWiltsHashAdapter", factory: () => new NorthWiltsHashAdapter() },
  { pattern: onHost("big-hump.com"), name: "BigHumpAdapter", factory: () => new BigHumpAdapter() },
  { pattern: onHost("stlh3.com"), name: "StlH3Adapter", factory: () => new StlH3Adapter() },
  { pattern: onHost("brewcityh3.com"), name: "BrewCityH3Adapter", factory: () => new BrewCityH3Adapter() },
  // The old substring regex /eh3\.org/ also matched "boiseh3.org", so the Boise
  // source ran this adapter and emitted Edmonton runs (SOURCE_KENNEL_MISMATCH, May 2026).
  { pattern: onHost("eh3.org"), name: "Eh3EdmontonAdapter", factory: () => new Eh3EdmontonAdapter() },
  { pattern: onHost("truetrailh3.com"), name: "TrueTrailH3Adapter", factory: () => new TrueTrailH3Adapter() },
  { pattern: onHost("docs.google.com", { path: "/document/d/1jGyBUKxOYkxrZg8WVfpBYDP84fbacanoX_TJuyCmtAI" }), name: "Oh3OttawaAdapter", factory: () => new Oh3OttawaAdapter() },
  { pattern: onHost("home.onon.org"), name: "CalgaryH3HomeAdapter", factory: () => new CalgaryH3HomeAdapter() },
  { pattern: onHost("scribe.onon.org"), name: "CalgaryH3ScribeAdapter", factory: () => new CalgaryH3ScribeAdapter() },
  { pattern: onHost("bfh3.com"), name: "Bfh3Adapter", factory: () => new Bfh3Adapter() },
  { pattern: onHost("indyhhh.com"), name: "IndyH3Adapter", factory: () => new IndyH3Adapter() },
  { pattern: onHost("choochooh3.com"), name: "ChooChooH3Adapter", factory: () => new ChooChooH3Adapter() },
  { pattern: onHost("lioncityhhh.com"), name: "LionCityH3Adapter", factory: () => new LionCityH3Adapter() },
  { pattern: onHost("kampong.hash.org.sg"), name: "KampongH3Adapter", factory: () => new KampongH3Adapter() },
  { pattern: onHost("hashhousehorrors.com"), name: "HashHorrorsAdapter", factory: () => new HashHorrorsAdapter() },
  { pattern: onHost("sh3app.hash.org.sg"), name: "SeletarH3Adapter", factory: () => new SeletarH3Adapter() },
  { pattern: onHost("hhhs.org.sg"), name: "HHHSAdapter", factory: () => new HHHSAdapter() },
  // ── Malaysia (Phase 1: KL + Penang founder pack) ──
  // Mother Hash left Google Sites for goHash.app (Nov 2026) — same
  // window.__INITIAL_STATE__ /hareline/upcoming shape as KL Full Moon / Penang.
  { pattern: onHost("motherhash.org"), name: "GoHashAdapter", factory: () => new GoHashAdapter() },
  { pattern: onHost("ph3.org"), name: "YiiHarelineAdapter", factory: () => new YiiHarelineAdapter() },
  // KL Full Moon migrated off Yii to the goHash.app platform (#2241) — the old
  // /index.php?r=site/hareline route now 404s. The relaunched site SSRs
  // window.__INITIAL_STATE__ at /hareline/upcoming, so it shares the GoHash
  // adapter with Penang H3 / Harriets Penang. (Petaling H3 stays on Yii.)
  { pattern: onHost("klfullmoonhash.com"), name: "GoHashAdapter", factory: () => new GoHashAdapter() },
  { pattern: onHost("kljhhh.org"), name: "KljH3Adapter", factory: () => new KljH3Adapter() },
  { pattern: onHost("penanghash3.org"), name: "GoHashAdapter", factory: () => new GoHashAdapter() },
  { pattern: onHost("hashhouseharrietspenang.com"), name: "GoHashAdapter", factory: () => new GoHashAdapter() },
  { pattern: onHost("khhhkj.blogspot.com"), name: "KjHarimauAdapter", factory: () => new KjHarimauAdapter() },
  // ── Australia (Phase 1b: Sydney + Adelaide + Gold Coast) ──
  { pattern: onHost("sh3.link"), name: "Sh3AuAdapter", factory: () => new Sh3AuAdapter() },
  { pattern: onHost("ah3.com.au"), name: "AdelaideH3Adapter", factory: () => new AdelaideH3Adapter() },
  { pattern: onHost("goldcoasthash.org"), name: "GoldCoastH3Adapter", factory: () => new GoldCoastH3Adapter() },
  { pattern: onHost("sydney.larrikins.org"), name: "LarrikinsAdapter", factory: () => new LarrikinsAdapter() },
  { pattern: onHost("sth3.org"), name: "SydneyThirstyH3Adapter", factory: () => new SydneyThirstyH3Adapter() },
  // ── Hong Kong (Phase 1) ──
  { pattern: onHost(["n2th3.org", "n2th3.wordpress.com"]), name: "N2TH3Adapter", factory: () => new N2TH3Adapter() },
  { pattern: onHost("datadesignfactory.com", { path: "/lsw" }), name: "LswH3Adapter", factory: () => new LswH3Adapter() },
  { pattern: onHost("hkladiesh4.wixsite.com"), name: "LadiesH4HkAdapter", factory: () => new LadiesH4HkAdapter() },
  { pattern: onHost("hkhash.com", { subdomains: "www" }), name: "Hkh3Adapter", factory: () => new Hkh3Adapter() },
  // ── Thailand (Phase 1a) ──
  { pattern: onHost("cah3.net"), name: "Cah3Adapter", factory: () => new Cah3Adapter() },
  { pattern: onHost("chiangraihhh.blogspot.com"), name: "Crh3Adapter", factory: () => new Crh3Adapter() },
  { pattern: onHost("bangkokharriettes.wordpress.com"), name: "BkkHarriettesAdapter", factory: () => new BkkHarriettesAdapter() },
  { pattern: onHost("phuket-hhh.com"), name: "PhuketHHHAdapter", factory: () => new PhuketHHHAdapter() },
  { pattern: onHost("chiangmaihhh.com"), name: "ChiangMaiHHHAdapter", factory: () => new ChiangMaiHHHAdapter() },
  { pattern: onHost("bangkokhash.com"), name: "BangkokHashAdapter", factory: () => new BangkokHashAdapter() },
  { pattern: onHost("pattayah3.com"), name: "PattayaH3Adapter", factory: () => new PattayaH3Adapter() },
  { pattern: onHost("bangkokbikehash.org"), name: "BangkokBikersAdapter", factory: () => new BangkokBikersAdapter() },
  { pattern: onHost("bangkokhhh.org"), name: "BangkokH3Adapter", factory: () => new BangkokH3Adapter() },
  { pattern: onHost("bangkokmondayhhh.com"), name: "BangkokMondayHashAdapter", factory: () => new BangkokMondayHashAdapter() },
  // ── Taiwan ──
  // Taipei H3 is pinned to the apex and www.: New Taipei's Nov-2026 rebuild lives
  // on the nth3. subdomain of the same domain, so the default any-subdomain match
  // would shadow it.
  { pattern: onHost("taipeihash.com.tw", { subdomains: "www" }), name: "TaipeiHashAdapter", factory: () => new TaipeiHashAdapter() },
  { pattern: onHost("nth3.taipeihash.com.tw", { subdomains: "none" }), name: "NewTaipeiHashAdapter", factory: () => new NewTaipeiHashAdapter() },
  // Legacy host (301s to nth3.taipeihash.com.tw) — kept so an unmigrated row still routes.
  { pattern: onHost("newtaipeihash.com"), name: "NewTaipeiHashAdapter", factory: () => new NewTaipeiHashAdapter() },
  { pattern: onHost("kaohsiunghash.com"), name: "KaohsiungHashAdapter", factory: () => new KaohsiungHashAdapter() },
  { pattern: onHost("tymh3.com"), name: "BoomCalendarAdapter", factory: () => new BoomCalendarAdapter() },
  // ── Jamaica ──
  { pattern: onHost("jah3.com"), name: "JamaicaHashAdapter", factory: () => new JamaicaHashAdapter() },
  // ── Grenada ──
  { pattern: onHost("grenadahash.com"), name: "GrenadaHashAdapter", factory: () => new GrenadaHashAdapter() },
  // ── Cambodia ──
  { pattern: onHost("p2h3.com"), name: "PhnomPenhH3Adapter", factory: () => new PhnomPenhH3Adapter() },
  // ── Laos ──
  { pattern: onHost("hashlaos.com"), name: "LaosHashAdapter", factory: () => new LaosHashAdapter() },
  // ── Nepal ──
  { pattern: onHost("himalayanhash.run"), name: "HimalayanHashAdapter", factory: () => new HimalayanHashAdapter() },
  // ── India ──
  { pattern: onHost("bombayhash.org"), name: "BombayHashAdapter", factory: () => new BombayHashAdapter() },
  // ── Vietnam ──
  { pattern: onHost("saigonhashers.com"), name: "SaigonH3Adapter", factory: () => new SaigonH3Adapter() },
  { pattern: onHost("hanoih3.com"), name: "HanoiH3Adapter", factory: () => new HanoiH3Adapter() },
  // ── Oman ──
  { pattern: onHost("muscateersh3.com"), name: "MuscateersHashAdapter", factory: () => new MuscateersHashAdapter() },
  // ── Romania ──
  { pattern: onHost("docs.google.com", { path: "/spreadsheets/d/17NUJ3M9Th9fPi9oYkK8cLGhydW7nNq6yFMyD0x34fkQ", subdomains: "none" }), name: "BucharestHashAdapter", factory: () => new BucharestHashAdapter() },
  // ── Germany ──
  { pattern: onHost("nuremberg-h3.de"), name: "NurembergHashAdapter", factory: () => new NurembergHashAdapter() },
  // ── Cyprus ──
  { pattern: onHost("sites.google.com", { path: "/view/larnaca-hash-house-harriers", subdomains: "none" }), name: "LarnacaHashAdapter", factory: () => new LarnacaHashAdapter() },
  { pattern: onHost("dhekelia-h3.com"), name: "DhekeliaHashAdapter", factory: () => new DhekeliaHashAdapter() },
  { pattern: onHost("nh4.com.cy"), name: "NicosiaHashAdapter", factory: () => new NicosiaHashAdapter() },
  // ── Austria ──
  { pattern: onHost("viennahash.org"), name: "VindobonaH3Adapter", factory: () => new VindobonaH3Adapter() },
  // ── Nevada ──
  { pattern: onHost("lvh3.org"), name: "LVH3Adapter", factory: () => new LVH3Adapter() },
  // ── Idaho ──
  { pattern: onHost("boiseh3.org"), name: "BoiseH3Adapter", factory: () => new BoiseH3Adapter() },
  // ── Montana ──
  // Hellgate H3 (Missoula) — WordPress REST posts, one per run, labeled body
  // (When/Date/bare date line drift across 2013→now); no run numbers.
  { pattern: onHost("missoulahash.org"), name: "HellgateHashAdapter", factory: () => new HellgateHashAdapter() },
  { pattern: onHost("nswhhh.info"), name: "NSWHHHAdapter", factory: () => new NSWHHHAdapter() },
  // ── Philippines ──
  { pattern: onHost("cebuhash.wordpress.com", { subdomains: "none" }), name: "CebuHashAdapter", factory: () => new CebuHashAdapter() },
  { pattern: onHost("subicbayhash.blogspot.com", { subdomains: "none" }), name: "SubicBayHashAdapter", factory: () => new SubicBayHashAdapter() },
  { pattern: onHost("pgh3.org"), name: "PuertoGaleraHashAdapter", factory: () => new PuertoGaleraHashAdapter() },
  // Manila H3 (Monday men's, "since 1972") — Google Sites SSR home page; a single
  // current "next run" block keyed on the bilingual labels ano/kailan/sino/saan.
  { pattern: onHost("sites.google.com", { path: "/site/manilah3" }), name: "ManilaH3Adapter", factory: () => new ManilaH3Adapter() },
  // Warsaw H3 (HashTracks' first Poland kennel, est. 1983) — warsawh3.com static
  // Mobirise home page: a single <p> SSRs the next run (full detail) + an
  // upcoming-runs list, merged by run number.
  { pattern: onHost("warsawh3.com"), name: "WarsawH3Adapter", factory: () => new WarsawH3Adapter() },
  // Seoul H3 ("Korea's Mother Hash", men-only, since 1972) — seoulhash.com PHP
  // SSR; index.php renders a single current run in semantically-classed divs.
  { pattern: onHost("seoulhash.com"), name: "SeoulH3Adapter", factory: () => new SeoulH3Adapter() },
  // Colombo Harriettes (HashTracks' first Sri Lanka kennel, est. 1984) —
  // hashcolombo.com custom Next.js SSR; a single "Next run" block holds either a
  // placeholder ("We will announce soon") or the current Saturday run.
  { pattern: onHost("hashcolombo.com"), name: "ColomboHarriettesAdapter", factory: () => new ColomboHarriettesAdapter() },
  // ── Colorado ──
  { pattern: onHost("boulderh3.com"), name: "BoulderH3Adapter", factory: () => new BoulderH3Adapter() },
  // ── Denmark ──
  { pattern: onHost("ch4.dk"), name: "Ch4DkAdapter", factory: () => new Ch4DkAdapter() },
  // ── New Zealand (Phase 1) ──
  // CHH3 deliberately not registered yet — see prisma/seed-data/sources.ts
  // for the rationale (special events live on /events/, needs a separate
  // parser planned for Phase 2). The Miteri adapter only covers the
  // gardencityhash.co.nz homepage hareline today.
  { pattern: onHost("gardencityhash.co.nz"), name: "MiteriHarelineAdapter", factory: () => new MiteriHarelineAdapter() },
  { pattern: onHost("aucklandhussies.co.nz"), name: "AucklandHussiesAdapter", factory: () => new AucklandHussiesAdapter() },
  // sporty.co.nz CMS subsites — Cloudflare Bot Fight Mode is cleared
  // transparently by the stealth-upgraded NAS browser-render service
  // (see infra/browser-render/server.js + docs/browser-render-spec.md).
  { pattern: onHost("sporty.co.nz", { path: "/capitalh3" }), name: "CapitalH3Adapter", factory: () => new CapitalH3Adapter() },
  { pattern: onHost("sporty.co.nz", { path: "/mooloohhh" }), name: "MoolooHhhAdapter", factory: () => new MoolooHhhAdapter() },
  { pattern: onHost("sporty.co.nz", { path: "/geriatrixhhh" }), name: "GeriatrixH3Adapter", factory: () => new GeriatrixH3Adapter() },
  // ── Canada (Toronto) ──
  // Hogtown H3 (#1331) — Google Sites SPA, browser-rendered. Three sub-series
  // (HOGTOWN / TWAT / HOGANS) share one kennel; the series prefix lives in
  // the title since the schema has no sub-series field.
  { pattern: onHost("hogtownh3.com"), name: "HogtownAdapter", factory: () => new HogtownAdapter() },
  // ── Canada (Montreal) ──
  // MH3 Montreal (#1660) — hand-edited static HTML keyed on <!--RunNumber-->
  // / <!--DateTimeCost--> / <!--HaresList--> / <!--Location--> comment anchors.
  // Wins on Meetup when both fire (trustLevel 9 vs Meetup's 7) — see PR for
  // the four bundled issues including a description-leak fix in the Meetup
  // adapter (#1659) that gated this PR.
  { pattern: onHost("mhhh.ca"), name: "MhhhCaAdapter", factory: () => new MhhhCaAdapter() },
  // ── Canada (Victoria, BC) ──
  // Victoria H3 (#1980) — one Gamma-platform SSR page hosting three kennels
  // (VH3 / Dark Side of the Moon H3 / Victoria K9 H3). Backbone = the per-kennel
  // schedule lists; the "Up Cumming" cards + prose write-ups enrich by run #.
  { pattern: onHost("vh3.ca"), name: "VictoriaH3Adapter", factory: () => new VictoriaH3Adapter() },
  // ── Sacramento, CA ──
  // SACH3 — Squarespace events collection (?format=json). The shared
  // SquarespaceEventsAdapter parses any Squarespace-hosted Events tenant;
  // additional kennels just add a URL pattern + a Source row with
  // `kennelTag` in config.
  { pattern: onHost("sach3.beer"), name: "SquarespaceEventsAdapter", factory: () => new SquarespaceEventsAdapter() },
  // ── Von Tramp H3 (Burlington, VT) ──
  // VTH3 — same shared SquarespaceEventsAdapter. The kennel's own hareline
  // lives at the `/hareline` collection (config.collectionPath), not the
  // default `/events`. Seeded as the rich primary source while the FB Hosted
  // Events source is blocked (#1939) and the Meetup source is dead (#1144/#1459).
  { pattern: onHost("vontramph3.com"), name: "SquarespaceEventsAdapter", factory: () => new SquarespaceEventsAdapter() },
  // ── Upstate H3 (Greenville, SC) ──
  // UH3 — same shared SquarespaceEventsAdapter against the `/new-events-1`
  // events collection (config.collectionPath). Carries the kennel's themed
  // special events (multi-day campouts, dress runs); the recurring cadence
  // stays on the STATIC_SCHEDULE source. The static `/receding-hareline`
  // archive (#122–#334, 2008–2016) is a one-shot, not a scrape target (#2420).
  { pattern: onHost("upstatehashers.com"), name: "SquarespaceEventsAdapter", factory: () => new SquarespaceEventsAdapter() },
  // HashStats — multi-kennel historical stats archive served as JSON over
  // POST {host}/{SLUG}/listhashes2 (DataTables shape). JSON-over-HTML_SCRAPER,
  // like SHITH3/Seletar. Kennel slugs come from config.kennelSlugMap, so one
  // Source row can drive many kennels. Only public hashingstats.com hosts
  // serve logged-out JSON; *.hashstats.org subdomains redirect to /auth. (#1771)
  { pattern: onHost("hashingstats.com"), name: "HashStatsAdapter", factory: () => new HashStatsAdapter() },
];

/** URL-based routing for HTML_SCRAPER — derived from htmlScraperEntries (single source of truth). */
const htmlScrapersByUrl: [HostMatcher, () => SourceAdapter][] =
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

/**
 * Every URL-routed HTML scraper whose route matches `url`, in registry order (the
 * first one is what `getAdapter` picks). More than one name means the routes
 * overlap; `registry-routing.test.ts` allows that only for declared pairs.
 */
export function matchingHtmlAdapters(url: string): string[] {
  return htmlScraperEntries.filter(({ pattern }) => pattern.test(url)).map(({ name }) => name);
}

/** Factory function: returns the appropriate SourceAdapter for a given source type, URL, and optional config. URL-based routing applies for HTML_SCRAPER types; generic config routing falls back when no named adapter matches. */
export function getAdapter(
  sourceType: SourceType,
  sourceUrl?: string,
  sourceConfig?: Record<string, unknown> | null,
): SourceAdapter {
  // Config-routed Tribe ("The Events Calendar") sources take priority over URL
  // routing: the shared TribeEventsAdapter is dispatched by config so it can
  // coexist with a URL-routed adapter on the same host (Sydney Larrikins has a
  // weekly HTML scraper AND a Tribe specials feed on sydney.larrikins.org). (#2391)
  if (sourceType === "HTML_SCRAPER" && isTribeEventsConfig(sourceConfig)) {
    return new TribeEventsAdapter();
  }

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
