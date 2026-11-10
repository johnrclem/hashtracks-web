import { describe, it, expect } from "vitest";
import { SOURCES } from "../../prisma/seed-data/sources";
import { getAdapter, matchingHtmlAdapters } from "./registry";
import { isGenericHtmlConfig } from "./html-scraper/generic";
import { isTribeEventsConfig } from "./html-scraper/tribe-events-adapter";

/**
 * Routing guard for URL-routed HTML scrapers.
 *
 * `getAdapter()` gives an HTML_SCRAPER source the first registry route whose
 * host matches its URL. Substring routes sent two sources to another kennel's
 * adapter (Asunción ran Nairobi ONH3; Boise ran Edmonton EH3), and the only
 * symptom was a SOURCE_KENNEL_MISMATCH alert or zero events. These tests check
 * every seeded HTML_SCRAPER source, so a new source or route that collides with
 * an existing one fails here instead of in prod.
 */

interface SeedSource {
  name: string;
  url: string;
  type: string;
  enabled?: boolean;
  config?: unknown;
}

const htmlSources = (SOURCES as unknown as readonly SeedSource[]).filter((s) => s.type === "HTML_SCRAPER");
const enabledHtmlSources = htmlSources.filter((s) => s.enabled !== false);

function resolvedAdapter(s: SeedSource): string {
  return getAdapter("HTML_SCRAPER", s.url, (s.config ?? null) as Record<string, unknown> | null).constructor.name;
}

/**
 * Overlapping routes that are intentional: a path-scoped route on a shared host,
 * listed in the registry before that host's catch-all route. Each pair is
 * [specific, catch-all]; a URL may match both only in this order.
 */
const DECLARED_OVERLAPS: ReadonlyArray<readonly [string, string]> = [
  ["BfmSpecialEventsAdapter", "BFMAdapter"], // benfranklinmob.com/bfm-special-events (#765)
  ["SlashHashAdapter", "LondonHashAdapter"], // londonhash.org/slah3
];

/**
 * GenericHtml-config sources that a named route deliberately overrides (a named
 * route always beats a generic config). Anything else is a route claiming a
 * config-driven source by accident.
 */
const NAMED_ROUTE_OVER_GENERIC_CONFIG: Readonly<Record<string, string>> = {
  // The custom GlasgowH3Adapter (8faf27fa) replaced the original GenericHtml
  // config; the leftover selectors in the seed row are ignored.
  "Glasgow H3 Hareline": "GlasgowH3Adapter",
};

/**
 * The seeded sources each URL-routed adapter serves, keyed by adapter and sorted.
 * Every enabled HTML_SCRAPER source that resolves through a named route must be
 * listed under that route's adapter. When you seed one, list it under the adapter
 * you built for it, not whatever the failure message says it resolves to now. A
 * source may stay listed after it is disabled.
 *
 * A source routed by a Tribe or GenericHtml config needs no entry: its expected
 * adapter comes from the config (see expectedAdapter).
 */
const EXPECTED_SOURCES_BY_ADAPTER: Readonly<Record<string, readonly string[]>> = {
  AH3Adapter: ["Amsterdam H3 Website"],
  AdelaideH3Adapter: ["Adelaide H3 admin-ajax"],
  AsuncionH3Adapter: ["Asunción H3 WordPress Run Posts"],
  AtlantaHashBoardAdapter: ["Atlanta Hash Board"],
  AucklandHashAdapter: ["Auckland H3 Website"],
  AucklandHussiesAdapter: ["Auckland Hussies Run List"],
  BFMAdapter: ["BFM Website"],
  BaliHash2Adapter: ["Bali Hash 2 Website"],
  BangkokHashAdapter: ["Bangkok Full Moon Hash", "Bangkok Thursday Hash", "Siam Sunday Hash"],
  BangkokMondayHashAdapter: ["Bangkok Monday H3 Hareline"],
  BarnesHashAdapter: ["Barnes Hash Hare Line"],
  Bfh3Adapter: ["Blooming Fools H3 Website"],
  BfmSpecialEventsAdapter: ["BFM Special Events"],
  BigHumpAdapter: ["Big Hump H3 Hareline"],
  BkkHarriettesAdapter: ["Bangkok Harriettes Blog"],
  BoiseH3Adapter: ["BoiseH3 Website"],
  BombayHashAdapter: ["Bombay H3 Website"],
  BoomCalendarAdapter: ["Taoyuan Metro H3 Website"],
  BoulderH3Adapter: ["Boulder H3 Website"],
  BrasiliaH3Adapter: ["Brasilia H3 Blogspot Trail Posts"],
  BrassMonkeyAdapter: ["Brass Monkey H3 Blog"],
  BrewCityH3Adapter: ["Brew City H3 Website"],
  BruH3Adapter: ["BruH3 Website"],
  BucharestHashAdapter: ["Bucharest H3 Hareline Sheet"],
  BullMoonAdapter: ["Bull Moon Upcoming Runs"],
  Cah3Adapter: ["Cha-Am H3 Website"],
  CalgaryH3HomeAdapter: ["Calgary H3 Upcoming Runs"],
  CalgaryH3ScribeAdapter: ["Calgary H3 Scribe"],
  CambridgeHashAdapter: ["Cambridge H3 Website"],
  CapeFearH3Adapter: ["Cape Fear H3 Website"],
  CapitalH3Adapter: ["Capital H3 Website"],
  CebuHashAdapter: ["Cebu H3 Upcoming Events Widget"],
  Ch4DkAdapter: ["Copenhagen Howling H3 Runsheet"],
  ChiangMaiHHHAdapter: [
    "Chiang Mai CBH3 Hareline",
    "Chiang Mai CGH3 Hareline",
    "Chiang Mai CH3 Hareline",
    "Chiang Mai CH4 Hareline",
    "Chiang Mai CSH3 Hareline",
  ],
  ChicagoHashAdapter: ["Chicago Hash Website"],
  ChicagoTH3Adapter: ["Thirstday Hash Website"],
  CityHashAdapter: ["City Hash Makesweat"],
  CityOfExeterH3Adapter: ["City of Exeter H3 Blogspot Recaps"],
  ColomboHarriettesAdapter: ["Colombo Harriettes Website"],
  CreekHashAdapter: ["Creek H3 Website"],
  Crh3Adapter: ["Chiang Rai H3 Blog"],
  DCFMH3Adapter: ["DCFMH3 Google Sites Calendar"],
  DCH4Adapter: ["DCH4 WordPress Trail Posts"],
  DFWHashAdapter: ["DFW Hash Calendar"],
  DesertHashAdapter: ["Desert H3 Website"],
  DevonportH3Adapter: ["Devonport H3 Blogger Feed"],
  DhekeliaHashAdapter: ["Dhekelia H3 Website Next Run"],
  DonningtonHashAdapter: ["Donnington H3 Website"],
  DublinHashAdapter: ["Dublin H3 Website Hareline"],
  EWH3Adapter: ["EWH3 WordPress Trail News"],
  EdinburghH3Adapter: ["Edinburgh H3 Hareline"],
  Eh3EdmontonAdapter: ["EH3 Edmonton Area Harelines"],
  EnfieldHashAdapter: ["Enfield Hash Blog"],
  EssexHashAdapter: ["Essex H3 Website Hareline"],
  F3H3Adapter: ["F3H3 Website"],
  FrankfurtHashAdapter: ["FFMH3 Hareline", "Frankfurt H3 Hareline"],
  FukFullMoonH3Adapter: ["F.U.K Full Moon H3 Hareline"],
  GATRH3Adapter: ["GATR H3 WordPress Trail Posts"],
  GeriatrixH3Adapter: ["Geriatrix H3 Receding Hareline"],
  GlasgowH3Adapter: ["Glasgow H3 Hareline"],
  GoHashAdapter: [
    "Hash House Harriets Penang Hareline",
    "KL Full Moon H3 Hareline",
    "Mother Hash (KL H3) Website",
    "Penang H3 Hareline",
  ],
  GoldCoastH3Adapter: ["Gold Coast H3 Hareline"],
  GrenadaHashAdapter: ["Grenada H3 Hash Schedule"],
  H5HareHoundsAdapter: ["H5 Hare & Hounds Website Hareline"],
  HHHSAdapter: ["HHHS Hareline"],
  HagueH3Adapter: ["The Hague H3 Website"],
  HalveMeinAdapter: ["Halve Mein Website"],
  HangoverAdapter: ["Hangover H3 DigitalPress Blog"],
  HanoiH3Adapter: ["Hanoi H3 Website"],
  HashHorrorsAdapter: ["Hash House Horrors Hareline"],
  HashPhillyAdapter: ["Philly H3 Website"],
  HashStatsAdapter: ["LVH3 HashStats", "QCH4 HashStats", "SCH4 HashStats", "SCH4BASH HashStats", "SWOT HashStats"],
  Hayama4HAdapter: ["Hayama 4H Website"],
  HertsHashAdapter: ["Herts H3 Website Hareline"],
  HighWycombeHashAdapter: ["High Wycombe H3 Website"],
  HimalayanHashAdapter: ["Himalayan H3 Website"],
  Hkh3Adapter: ["HK H3 Homepage"],
  HockessinAdapter: ["Hockessin H3 Website"],
  HogtownAdapter: ["Hogtown H3 Website"],
  IndyH3Adapter: ["IndyScent H3 Upcumming Hashes"],
  IthacaH3Adapter: ["IH3 Website Hareline"],
  JamaicaHashAdapter: ["Jamaica H3 Website Hareline"],
  KCH3Adapter: ["Kansas City H3 Website"],
  KampongH3Adapter: ["Kampong H3 Website"],
  KaohsiungHashAdapter: ["Kaohsiung H3 Run Information"],
  KjHarimauAdapter: ["KJ Harimau H3 Blog"],
  KljH3Adapter: ["KL Junior H3 Website"],
  LVH3Adapter: ["Las Vegas H3 Events"],
  LadiesH4HkAdapter: ["Ladies H4 Hareline"],
  LaosHashAdapter: ["Laos HHH Website (hashlaos.com)"],
  LarnacaHashAdapter: ["Larnaca H3 Website (Next Run + Future Hares)"],
  LarrikinsAdapter: ["Sydney Larrikins Upcoming Runs"],
  LionCityH3Adapter: ["Lion City H3 Website"],
  LondonHashAdapter: ["London Hash Run List"],
  LswH3Adapter: ["LSW Hareline"],
  MaconHashAdapter: ["MGH4 & W3H3 Next Hash"],
  MadridHashAdapter: ["Madrid HHH WordPress Trail Directions"],
  ManilaH3Adapter: ["Manila H3 Website"],
  MerseyThirstdaysAdapter: ["Mersey Thirstdays Website"],
  MhhhCaAdapter: ["MH3 Montreal Website Hareline"],
  MijasHashAdapter: ["Mijas H3 Hareline"],
  MiteriHarelineAdapter: ["Garden City H3 Website"],
  MkH3Adapter: ["MKH3 Website"],
  MoolooHhhAdapter: ["Mooloo HHH UpCumming Runs"],
  MuscateersHashAdapter: ["Muscateers H3 Website Hareline"],
  N2TH3Adapter: ["N2TH3 WordPress Blog"],
  NCH3Adapter: ["NCH3 Official Microsite"],
  NewCotswoldH3Adapter: ["N.E.W. Cotswold H3 Website"],
  NewTaipeiHashAdapter: ["New Taipei Hash Run List"],
  NewTokyoKatchAdapter: ["New Tokyo Katch Website"],
  NicosiaHashAdapter: ["Nicosia H4 Upcoming Hares"],
  NorfolkH3Adapter: ["Norfolk H3 Trails Page"],
  NorthWiltsHashAdapter: ["North Wilts H3 Run Sheet", "North Wilts Moonrakers Run Sheet"],
  NorthboroHashAdapter: ["Northboro H3 Website"],
  NurembergHashAdapter: ["Nuremberg H3 Run Info"],
  OCH3Adapter: ["Old Coulsdon Hash Run List"],
  OFH3Adapter: ["OFH3 Blogspot Trail Posts"],
  ONH3Adapter: ["ONH3 WordPress Trail Posts"],
  Oh3OttawaAdapter: ["OH3 Ottawa Receding Hare Line"],
  OxfordH3Adapter: ["Oxford H3 Website"],
  PattayaH3Adapter: ["Pattaya H3 Hareline"],
  PhnomPenhH3Adapter: ["Phnom Penh H3 Website"],
  PhoenixHHHAdapter: ["Phoenix H3 Big Ass Calendar"],
  PhuketHHHAdapter: ["Phuket HHH Hareline"],
  PuertoGaleraHashAdapter: ["Puerto Galera H3 Upcoming Runs"],
  QuornH3Adapter: ["Quorn H3 Runlog XML"],
  RIH3Adapter: ["RIH3 Website Hareline"],
  RenegadeH3Adapter: ["Renegade H3 Website"],
  RiyadhH3Adapter: ["Riyadh H3 Supabase API"],
  SDH3Adapter: ["SDH3 Hareline"],
  SFH3Adapter: ["SFH3 MultiHash HTML Hareline"],
  SHITH3Adapter: ["SHITH3 Website"],
  SOH4Adapter: ["SOH4 Website"],
  SWH3Adapter: ["SWH3 Trail Announcements"],
  SaigonH3Adapter: ["Saigon H3 Website"],
  SamuraiH3Adapter: ["Samurai H3 Website"],
  SeletarH3Adapter: ["Seletar H3 PWA"],
  SeoulH3Adapter: ["Seoul H3 Website"],
  SevenHillsH3Adapter: ["Seven Hills H3 Google Sites"],
  Sh3AuAdapter: ["Sydney H3 Hareline"],
  SlashHashAdapter: ["SLASH Run List"],
  SouthHamsH4Adapter: ["South Hams H3 (SH4) Website Hash Diary"],
  SquarespaceEventsAdapter: ["Sacramento H3 Squarespace Events", "Von Tramp H3 Squarespace Events"],
  StlH3Adapter: ["STL H3 Substack"],
  SubicBayHashAdapter: ["Subic Bay H3 Blogger Hareline"],
  SumoH3Adapter: ["Sumo H3 Website"],
  SurreyHashAdapter: ["Surrey H3 Website Hareline"],
  SydneyThirstyH3Adapter: ["Sydney Thirsty H3 Upcoming Runs"],
  TaipeiHashAdapter: ["Taipei Hash Run List"],
  TamarValleyH3Adapter: ["Tamar Valley H3 Website"],
  TeignValleyH3Adapter: ["Teign Valley H3 Blogger Feed"],
  TidewaterH3Adapter: ["Tidewater H3 Website Calendar"],
  TrueTrailH3Adapter: ["True Trail H3 Hareline"],
  VictoriaH3Adapter: ["Victoria H3 Gamma Site"],
  VindobonaH3Adapter: ["Vindobona H3 Hareline"],
  WarsawH3Adapter: ["Warsaw H3 Website"],
  WarwickHashAdapter: ["Warwick H3 Website"],
  WestLondonHashAdapter: ["West London Hash Website"],
  WyreForestHashAdapter: ["Wyre Forest HHH Website"],
  YiiHarelineAdapter: ["Petaling H3 Hareline"],
  YokoYokoH3Adapter: ["Yoko Yoko H3 Website"],
};

/** Source name → expected adapter, inverted from EXPECTED_SOURCES_BY_ADAPTER. */
const expectedAdapterBySource = new Map<string, string>();
const listedTwice: string[] = [];
for (const [adapter, names] of Object.entries(EXPECTED_SOURCES_BY_ADAPTER)) {
  for (const name of names) {
    if (expectedAdapterBySource.has(name)) listedTwice.push(name);
    expectedAdapterBySource.set(name, adapter);
  }
}

/** A source's table entry, else the adapter its config selects, else undefined. */
function expectedAdapter(s: SeedSource): string | undefined {
  const listed = expectedAdapterBySource.get(s.name);
  if (listed !== undefined) return listed;
  if (isTribeEventsConfig(s.config)) return "TribeEventsAdapter";
  if (isGenericHtmlConfig(s.config)) return "GenericHtmlAdapter";
  return undefined;
}

describe("HTML_SCRAPER registry routing (seeded sources)", () => {
  it("has seeded HTML_SCRAPER sources to check", () => {
    expect(enabledHtmlSources.length).toBeGreaterThan(100);
  });

  it("no seeded source URL is claimed by two routes, except declared [specific, catch-all] pairs", () => {
    const problems: string[] = [];
    for (const s of htmlSources) {
      const matches = matchingHtmlAdapters(s.url);
      if (matches.length < 2) continue;
      const declared = DECLARED_OVERLAPS.some(
        ([specific, catchAll]) => matches.length === 2 && matches[0] === specific && matches[1] === catchAll,
      );
      if (!declared) problems.push(`${s.name} (${s.url}) matches ${matches.join(" > ")}`);
    }
    expect(problems).toEqual([]);
  });

  it("every enabled source is routed: a named route, a GenericHtml config or a Tribe config", () => {
    // Otherwise getAdapter falls through to the retired HashNYC HTML default.
    const unrouted = enabledHtmlSources
      .filter((s) => matchingHtmlAdapters(s.url).length === 0)
      .filter((s) => !isGenericHtmlConfig(s.config) && !isTribeEventsConfig(s.config))
      .map((s) => `${s.name} (${s.url})`);
    expect(unrouted).toEqual([]);
  });

  it("no named route claims a GenericHtml-config source unless declared", () => {
    const hijacked: string[] = [];
    for (const s of htmlSources) {
      if (!isGenericHtmlConfig(s.config) || isTribeEventsConfig(s.config)) continue;
      const [first] = matchingHtmlAdapters(s.url);
      if (first && NAMED_ROUTE_OVER_GENERIC_CONFIG[s.name] !== first) {
        hijacked.push(`${s.name} (${s.url}) is claimed by ${first} instead of GenericHtmlAdapter`);
      }
    }
    expect(hijacked).toEqual([]);
  });

  it("every enabled source (and any listed disabled one) resolves to its expected adapter", () => {
    const wrong: string[] = [];
    for (const s of htmlSources) {
      if (s.enabled === false && !expectedAdapterBySource.has(s.name)) continue;
      const expected = expectedAdapter(s);
      const actual = resolvedAdapter(s);
      if (expected === undefined) {
        wrong.push(
          `${s.name} (${s.url}) is not in EXPECTED_SOURCES_BY_ADAPTER and has no valid Tribe or GenericHtml config; it resolves to ${actual}`,
        );
      } else if (actual !== expected) {
        wrong.push(`${s.name} (${s.url}): expected ${expected}, got ${actual}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("EXPECTED_SOURCES_BY_ADAPTER lists each source once and only seeded sources", () => {
    const seededNames = new Set(htmlSources.map((s) => s.name));
    const stale = [...expectedAdapterBySource.keys()].filter((name) => !seededNames.has(name));
    expect(stale).toEqual([]);
    expect(listedTwice).toEqual([]);
  });

  it("declared overlaps and overrides still refer to real seeded sources", () => {
    for (const [specific, catchAll] of DECLARED_OVERLAPS) {
      const both = htmlSources.filter((s) => {
        const m = matchingHtmlAdapters(s.url);
        return m[0] === specific && m[1] === catchAll;
      });
      expect(both.length, `${specific} > ${catchAll}`).toBeGreaterThan(0);
    }
    for (const [name, adapter] of Object.entries(NAMED_ROUTE_OVER_GENERIC_CONFIG)) {
      const s = htmlSources.find((src) => src.name === name);
      expect(s && isGenericHtmlConfig(s.config) && matchingHtmlAdapters(s.url)[0], name).toBe(adapter);
    }
  });
});
