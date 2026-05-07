// ── SHARED SFH3 CONFIG (used by both iCal and HTML sources) ──

const sfh3KennelPatterns: Array<[string, string]> = [
    ["^SFH3", "sfh3"],
    ["^GPH3", "gph3"],
    ["^EBH3", "ebh3"],
    ["^SVH3", "svh3"],
    ["^FHAgnews", "fhac-u"],
    ["^FHAC-U", "fhac-u"],
    ["^Agnews", "agnews"],
    ["^Marin H3", "marinh3"],
    ["^FCH3", "fch3"],
    ["^FMH3", "sffmh3"],
    ["^BARH3", "barh3"],
    ["^VMH3", "vmh3"],
    ["^MWH3", "mwh3"],
    ["^26\\.2H3", "262h3"],
];

const sfh3Config = {
  kennelPatterns: sfh3KennelPatterns,
  defaultKennelTag: "sfh3",
  skipPatterns: ["^Hand Pump", "^Workday"],
};

// The iCal feed omits "Run" from SUMMARY and has no Comment field. Fetch
// /runs/{id} detail pages so the iCal RawEvents land in the merge pipeline
// with the same enriched title + Comment as the HTML_SCRAPER RawEvents
// (the HTML adapter enriches unconditionally).
const sfh3IcalConfig = {
  ...sfh3Config,
  enrichSFH3Details: true,
};

const sfh3KennelCodes = [
  "sfh3", "gph3", "ebh3", "svh3", "fhac-u", "agnews",
  "barh3", "marinh3", "fch3", "sffmh3", "vmh3", "mwh3", "262h3",
];

// ── SHARED BRISTOL CONFIG (bristolhash.org.uk hosts three kennels) ──
//
// Same UK locale, same postcode-truncated location parsing across all three;
// the per-source overrides are only the rowSelector, columns, and
// defaultKennelTag. Keeping the base separate avoids per-source duplication
// (and stays under SonarCloud's new-line dup-density gate).

const bristolBase = {
  type: "HTML_SCRAPER" as const,
  trustLevel: 7,
  scrapeFreq: "daily",
  scrapeDays: 90,
};

const bristolConfigBase = {
  containerSelector: "table",
  dateLocale: "en-GB",
  locationTruncateAfter: "uk-postcode",
};

// Shared placeholder/CTA strings the Bristol pages emit when no venue is set
// — drop these so the UI shows a true "venue TBD" state instead of leaking
// editorial copy into the location field.
const BRISTOL_LOCATION_OMIT = [
  String.raw`^contact\s+\S.*\s+to\s+set\s+this\s+run\.?$`,
  String.raw`^t\.?b\.?[ad]\.?$`,
  String.raw`^hare\s+(?:wanted|needed)\.?!?$`,
  String.raw`^sign\s+up\s+to\s+hare!?$`,
  String.raw`^hare\s+needed!\s*contact\s+\S.*\.?$`,
];

// Choo-Choo H3 iCal source uses these base fields; spreading them keeps the
// new entry from structurally duplicating other ICAL_FEED rows.
const icalBaseChooChoo = {
  type: "ICAL_FEED" as const,
  trustLevel: 7,
  scrapeFreq: "daily",
  scrapeDays: 365,
};

// ── SHARED SOURCE BUILDERS ──

/**
 * Build a STATIC_SCHEDULE source row from the recurring-slot params. Reduces
 * boilerplate for the dozens of FB-coordinated kennels where the only
 * source is a known weekly/monthly cadence + a Facebook page link.
 *
 * Defaults: trustLevel=3 (FB-only), weekly scrape, 90-day window. Override
 * any of these by passing them in `extra`.
 */
function staticScheduleSource(params: {
  name: string;
  url: string;
  kennelTag: string;
  rrule: string;
  /** Optional anchor for INTERVAL>1 RRULEs (e.g. biweekly) so the
   *  expansion picks the correct week-of. Format: "YYYY-MM-DD". */
  anchorDate?: string;
  startTime?: string;
  defaultTitle: string;
  defaultLocation: string;
  defaultDescription: string;
  extra?: Partial<{ trustLevel: number; scrapeFreq: string; scrapeDays: number }>;
}) {
  const { name, url, kennelTag, rrule, anchorDate, startTime, defaultTitle, defaultLocation, defaultDescription, extra } = params;
  return {
    name,
    url,
    type: "STATIC_SCHEDULE" as const,
    trustLevel: extra?.trustLevel ?? 3,
    scrapeFreq: extra?.scrapeFreq ?? "weekly",
    scrapeDays: extra?.scrapeDays ?? 90,
    config: {
      kennelTag,
      rrule,
      ...(anchorDate ? { anchorDate } : {}),
      ...(startTime ? { startTime } : {}),
      defaultTitle,
      defaultLocation,
      defaultDescription,
    },
    kennelCodes: [kennelTag],
  };
}

// ── SOURCE DATA (PRD Section 8) ──

export const SOURCES = [
    {
      name: "HashNYC Website",
      url: "https://hashnyc.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["nych3", "brh3", "nah3", "knick", "lil", "qbk", "si", "columbia", "harriettes-nyc", "ggfm", "nawwh3"],
    },
    {
      name: "Boston Hash Calendar",
      url: "bostonhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      // Shared Boston-area calendar — order matters, first match wins.
      // NB: no defaultKennelTag — unmatched titles surface as UNMATCHED_TAGS alerts
      // instead of silently contaminating boh3 (issue #789).
      config: {
        kennelPatterns: [
          ["Boston Ball\\s*Buster|\\bBall\\s*Buster\\b|BoBBH3|B3H4|BBH3", "bobbh3"],
          ["Beantown", "beantown"],
          ["Pink Taco|PT2H3|\\bTaco\\b", "pink-taco"],
          ["\\bZigZag\\b|Zig Zag|ZZH3", "zigzag"],
          ["\\bE4B\\b|Eager\\s*4\\s*Beaver", "e4b"],
          ["Boston Moo[mn]|Full Moon|\\bMoo[mn]\\b", "bos-moon"],
          ["Boston H3|Boston Hash|BoH3|BH3", "boh3"],
        ],
      },
      kennelCodes: ["boh3", "bobbh3", "beantown", "bos-moon", "pink-taco", "zigzag", "e4b"],
    },
    {
      name: "Summit H3 Spreadsheet",
      url: "https://docs.google.com/spreadsheets/d/1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 9999,
      config: {
        sheetId: "1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk",
        columns: { runNumber: 0, specialRun: 1, date: 2, hares: 3, location: 4, description: 9 },
        defaultTitle: "Summit",
        kennelTagRules: { default: "summit", specialRunMap: { "ASSSH3": "asssh3" }, numericSpecialTag: "sfm" },
        startTimeRules: { byDayOfWeek: { "Mon": "19:00", "Sat": "15:00", "Fri": "19:00" }, default: "15:00" },
      },
      kennelCodes: ["summit", "sfm", "asssh3"],
    },
    {
      name: "Rumson H3 Static Schedule",
      url: "https://www.facebook.com/p/Rumson-H3-100063637060523/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "rumson",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        anchorDate: "2026-01-03",
        startTime: "10:17",
        defaultTitle: "Rumson H3 Weekly Run",
        defaultLocation: "Rumson, NJ",
        defaultDescription: "Weekly Saturday morning trail. Check Facebook for start location and hare details.",
      },
      kennelCodes: ["rumson"],
    },
    {
      name: "NOSE Hash Static Schedule (Summer Thursdays)",
      url: "https://www.facebook.com/groups/NOSEHash",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "nose-h3",
        rrule: "FREQ=WEEKLY;BYDAY=TH;BYMONTH=5,6,7,8,9,10",
        startTime: "19:00",
        defaultTitle: "NOSE H3 Weekly Run",
        defaultLocation: "North NJ",
        defaultDescription: "Summer schedule: Thursdays 7pm in North NJ. Check the Facebook group at https://www.facebook.com/groups/NOSEHash for start location.",
      },
      kennelCodes: ["nose-h3"],
    },
    {
      name: "NOSE Hash Static Schedule (Winter Wednesdays)",
      url: "https://www.facebook.com/groups/NOSEHash#winter-wed",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "nose-h3",
        rrule: "FREQ=WEEKLY;BYDAY=WE;BYMONTH=1,2,3,4,11,12",
        startTime: "19:00",
        defaultTitle: "NOSE H3 Weekly Run",
        defaultLocation: "North NJ",
        defaultDescription: "Winter schedule: Wednesdays 7pm in North NJ. Check the Facebook group at https://www.facebook.com/groups/NOSEHash for start location.",
      },
      kennelCodes: ["nose-h3"],
    },
    {
      name: "Princeton NJ Hash Calendar",
      url: "ciqlrdt0v691q1hhp79lidoh24@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        // Shared NJ calendar also has Summit + Rumson placeholder events
        // that don't get updated — only match Princeton's actual runs.
        kennelPatterns: [["^Regular Hash", "princeton-h3"], ["^MDL Hash", "princeton-h3"]],
        // null default so Summit/Rumson/other placeholders are skipped
        defaultKennelTag: null,
      },
      kennelCodes: ["princeton-h3"],
    },
    {
      name: "BFM Google Calendar",
      url: "bfmhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["BFM|Ben Franklin|BFMH3", "bfm"],
        ],
        defaultKennelTag: "bfm",
        // Philly H3 Saturday events bleed into BFM's calendar as organizer-level
        // pollution; filter them so BFM's hareline isn't swamped with non-BFM trails.
        skipPatterns: [String.raw`^Philly Hash\b`, String.raw`^Philly H3\b`],
      },
      kennelCodes: ["bfm"],
    },
    {
      name: "Philly H3 Google Calendar",
      url: "36ed6654c946ca632f71f400c1236c45d1bdd4e38c88c7c4da57619a72bfd7f8@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["Philly Hash|hashphilly|Philly H3", "philly-h3"],
        ],
        defaultKennelTag: "philly-h3",
        // Drop BFM-only events that leak into this shared calendar. BFM has
        // its own BFM Google Calendar + BFM Website sources (trust 8), so
        // skipping rather than re-routing avoids cross-kennel duplicates on
        // the Philly hareline. Anchored to start-of-title so a hypothetical
        // joint trail like "Philly H3 & BFM co-host" is still kept here.
        // Closes #582.
        skipPatterns: ["^Ben Franklin Mob H3\\b", "^BFM\\b"],
      },
      kennelCodes: ["philly-h3"],
    },
    {
      name: "BFM Website",
      url: "https://benfranklinmob.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["bfm"],
    },
    {
      name: "Philly H3 Website",
      url: "https://hashphilly.com/nexthash/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["philly-h3"],
    },
    {
      name: "Chicagoland Hash Calendar",
      url: "30c33n8c8s46icrd334mm5p3vc@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          // C2B3H4 must come before generic CH3 so it doesn't accidentally
          // match. Chicago Ballbusters H3 — sister to Boston B3H4 (#938).
          ["C2B3H4|C2B3", "c2b3h4"],
          ["CH3|Chicago Hash|Chicago H3", "ch3"],
          ["TH3|Thirstday|Thursday Hash", "th3"],
          ["CFMH3|Chicago Full Moon|Full Moon Hash|Full Moon H3|Moon Hash", "cfmh3"],
          ["FCMH3|First Crack", "fcmh3"],
          ["BDH3|Big Dogs", "bdh3"],
          ["BMH3|Bushman", "bmh3"],
          ["2CH3|Second City", "2ch3"],
          ["WWH3|Whiskey Wednesday", "wwh3"],
          ["4X2|4x2", "4x2h4"],
          ["RTH3|Ragtime", "rth3"],
          ["DLH3|Duneland|South Shore", "dlh3"],
        ],
        // Default unmatched events to chicago-h3 — calendar-wide social/special
        // events ("Hash Ball 2026", "Chitown Drinking Practice") are CH3-hosted.
        // The C2B3H4 leak (#938) is fixed by the explicit kennelPattern above,
        // not by strict routing.
        defaultKennelTag: "ch3",
        // Per-kennel `What: <kennel> No. N` run-number patterns. Each entry is
        // narrow enough that sibling Chicagoland kennels can't accidentally match.
        // - 4X2H4: "What: 4x2 H4 No. 124"
        // - BDH3 (#861): "What: Big Dogs HHH No. 258" (HHH suffix optional)
        runNumberPatterns: [
          String.raw`What:\s*4x2\s*H4\s*No\.?\s*(\d+)`,
          String.raw`What:\s*Big\s+Dogs(?:\s+HHH)?\s*No\.?\s*(\d+)`,
          // #1009 Bushman H3: "<b>What:</b> Bushman HHH No. 251<br>"
          String.raw`What:\s*Bushman(?:\s+HHH)?\s*No\.?\s*(\d+)`,
        ],
        // Only the soonest-upcoming 4X2H4 event has a populated description; it
        // carries an inline hareline block listing future dates → hares.
        // Back-fill matching events at scrape-post-pass time so each event
        // ends up with its own hare name.
        inlineHarelinePattern: { kennelTag: "4x2h4", blockHeader: "4x2 H4 Hareline:" },
      },
      kennelCodes: ["ch3", "th3", "cfmh3", "fcmh3", "bdh3", "bmh3", "2ch3", "wwh3", "4x2h4", "rth3", "dlh3", "c2b3h4"],
    },
    {
      name: "Chicago Hash Website",
      url: "https://chicagohash.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["ch3"],
    },
    {
      name: "Thirstday Hash Website",
      url: "https://chicagoth3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["th3"],
    },
    {
      name: "EWH3 Google Calendar",
      url: "ewh3harerazor@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "ewh3",
        includeAllDayEvents: true,
        defaultTitle: "EWH3 Trail",
        defaultStartTime: "18:45",
      },
      kennelCodes: ["ewh3"],
    },
    {
      name: "SHITH3 Google Calendar",
      url: "jackschitt.shit@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "shith3",
      },
      kennelCodes: ["shith3"],
    },
    {
      name: "SHITH3 Website",
      url: "https://shith3.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["shith3"],
    },
    {
      name: "W3H3 Hareline Spreadsheet",
      url: "https://docs.google.com/spreadsheets/d/19mNka1u64ZNOHS7z_EoqRIrAOdqg5HkY9Uk8u6LwAsI",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 9999,
      config: {
        sheetId: "19mNka1u64ZNOHS7z_EoqRIrAOdqg5HkY9Uk8u6LwAsI",
        tabs: ["W3H3 Hareline"],
        columns: { runNumber: 0, date: 1, hares: 2, location: 3, title: 4 },
        kennelTagRules: { default: "w3h3" },
        startTimeRules: { byDayOfWeek: { "Wed": "18:09" }, default: "18:09" },
        defaultTitle: "Wild & Wonderful Wednesday Trail",
      },
      kennelCodes: ["w3h3"],
    },
    // London, UK
    {
      name: "City Hash Makesweat",
      url: "https://makesweat.com/cityhash#hashes",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["cityh3"],
    },
    {
      name: "West London Hash Website",
      url: "https://westlondonhash.com/runs/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { upcomingOnly: true },
      kennelCodes: ["wlh3"],
    },
    {
      name: "London Hash Run List",
      url: "https://www.londonhash.org/runlist.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { upcomingOnly: true },
      kennelCodes: ["lh3"],
    },
    {
      name: "Barnes Hash Hare Line",
      url: "https://www.barnesh3.com/HareLine.htm",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["barnesh3"],
    },
    {
      name: "Old Coulsdon Hash Run List",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { upcomingOnly: true },
      kennelCodes: ["och3"],
    },
    {
      name: "SLASH Run List",
      url: "https://www.londonhash.org/slah3/runlist/slash3list.html",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["slh3"],
    },
    {
      name: "Enfield Hash Blog",
      url: "https://enfieldhash.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["eh3"],
    },
    // Ireland
    {
      name: "Dublin H3 Website Hareline",
      url: "https://dublinhhh.com/archive",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["dh3"],
    },
    // ===== UK — SCOTLAND =====
    {
      name: "Glasgow H3 Hareline",
      url: "https://glasgowh3.co.uk/hareline.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        containerSelector: "table",
        rowSelector: "tr",
        columns: {
          runNumber: "td:nth-child(1)",
          date: "td:nth-child(2)",
          location: "td:nth-child(3)",
          hares: "td:nth-child(4)",
        },
        defaultKennelTag: "glasgowh3",
        dateLocale: "en-GB",
        upcomingOnly: true,
      },
      kennelCodes: ["glasgowh3"],
    },
    {
      name: "Edinburgh H3 Hareline",
      url: "https://www.edinburghh3.com/eh3-hareline.html",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { upcomingOnly: true },
      kennelCodes: ["edinburghh3"],
    },
    // ===== UK — NORFOLK =====
    {
      name: "Norfolk H3 Trails Page",
      url: "https://norfolkh3.co.uk/trails/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { upcomingOnly: true },
      kennelCodes: ["norfolkh3"],
    },
    // ===== UK — LIVERPOOL =====
    {
      name: "Mersey Thirstdays Website",
      url: "https://www.merseythirstdayshash.com/next-run-s/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 7300,
      config: {
        pastRunsUrl: "https://www.merseythirstdayshash.com/past-runs/",
      },
      kennelCodes: ["mth3"],
    },
    // ===== UK — BIRMINGHAM =====
    {
      name: "Bull Moon Upcoming Runs",
      url: "https://www.bullmoonh3.co.uk/upcoming-runs",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 3650,
      config: {
        browserRender: true,
        recedingHarelineUrl: "https://www.bullmoonh3.co.uk/receding-hareline",
        upcomingCompId: "comp-ksnfhbg7",
        recedingCompId: "comp-kuzuw71n5",
      },
      kennelCodes: ["bullmoon"],
    },
    // ===== UK — BRISTOL =====
    {
      ...bristolBase,
      name: "West of England Hash Run List",
      url: "https://bristolhash.org.uk/allprint.php",
      config: {
        ...bristolConfigBase,
        rowSelector: "tr",
        columns: {
          kennelTag: "td:nth-child(1)",
          date: "td:nth-child(2)",
          location: "td:nth-child(3)",
          hares: "td:nth-child(5)",
        },
        defaultKennelTag: "bristolh3",
        // Page legend declares per-kennel default times since the table has no
        // time column: "BRIS=Sundays 11:00am, GREY=Mondays 7:00pm, BOGS=Wednesday
        // 7:15pm". Keys are the source-page codes (column 1, "BRIS"/"GREY"/"BOGS"),
        // not kennelCodes — the adapter looks them up pre-resolution.
        defaultStartTimeByKennel: {
          BRIS: "11:00",
          GREY: "19:00",
          BOGS: "19:15",
        },
        locationOmitIfMatches: BRISTOL_LOCATION_OMIT,
      },
      // Issue #1004: bogs-h3 split off into its own bogsruns.php source below
      // so we capture run numbers + start times allprint.php drops.
      kennelCodes: ["bristolh3", "bristol-grey"],
    },
    {
      ...bristolBase,
      // Issue #1004 — BOGS-only source pointing at the kennel-specific page.
      // bogsruns.php columns (verified live 2026-04-26):
      //   col 1: run number, col 2: date "DD/MM/YY",
      //   col 3: location + theme, col 4: OS-map link (skipped),
      //   col 5: hare(s).
      // Page header asserts "Runs start on Wednesdays at 7:15pm sharp" —
      // bogsruns.php has no per-event time column, so apply 19:15 as the
      // source-wide default (single-kennel page, so unambiguous unlike
      // allprint.php). Data rows nest inside an outer wrapper table, so we
      // filter by bgcolor="#FFFFAA" (the run-row highlight) to skip page
      // chrome and status banners. Verified live: 9 clean events.
      name: "BOGS H3 Run List",
      url: "https://bristolhash.org.uk/bogsruns.php",
      config: {
        ...bristolConfigBase,
        rowSelector: "tr[bgcolor=\"#FFFFAA\"]",
        columns: {
          runNumber: "td:nth-child(1)",
          date: "td:nth-child(2)",
          location: "td:nth-child(3)",
          hares: "td:nth-child(5)",
        },
        defaultKennelTag: "bogs-h3",
        defaultStartTime: "19:15",
        locationOmitIfMatches: BRISTOL_LOCATION_OMIT,
      },
      kennelCodes: ["bogs-h3"],
    },
    // ===== GERMANY =====
    // Berlin (iCal Feed — 2 kennels, rolling window)
    {
      name: "Berlin H3 iCal Feed",
      url: "https://www.berlin-h3.eu/events.ics",
      type: "ICAL_FEED" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      // #837: Neuglobsow and other annual specials land ~5mo out, past the
      // 90-day window. Bump to a full year to cover them.
      scrapeDays: 365,
      config: {
        kennelPatterns: [["Full Moon Run", "bh3fm"]],
        defaultKennelTag: "berlinh3",
        enrichBerlinH3Details: true,
        // #838: Berlin H3 descriptions use a "Who: Trail laid by <hares>" row
        // inside a multi-line "Location/When/Who/What to bring" block. The
        // default HARE_PATTERNS miss this phrasing.
        harePatterns: [String.raw`(?:^|\n)\s*Who:\s*Trail\s+laid\s+by\s+([^,\n]+)`],
      },
      kennelCodes: ["berlinh3", "bh3fm"],
    },
    // Stuttgart (Google Calendar — 4 sub-kennels)
    {
      name: "Stuttgart H3 Google Calendar",
      url: "1op2o8a7q9k5gif7m7b4n2ft7g@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["^DST\\b", "dst-h3"],
          ["^FM\\b|Full Moon", "fm-stgt"],
          ["^SUPER\\b", "super-h3"],
        ],
        defaultKennelTag: "sh3-de",
        // SH3 titles embed hare + (optional) neighborhood: "SH3 #880 Hare:
        // Kiss Me- Degerloch" or "SH3 # 874 Hare: Kiss Me". Capture the hare
        // name after "Hare:" up to the neighborhood delimiter or end of
        // string. Middle-match: the full `Hare: X-` span is stripped from
        // the title so it reads "SH3 #880 - Degerloch". #807.
        // DST sub-kennel uses a different title shape: "DST # - Lucky
        // Testigel" (placeholder) or "DST #814 - Full of Spunk" (assigned).
        // The hare follows the dash with no `Hare:` label (#1208).
        titleHarePattern: [
          String.raw`Hare:?\s+(.+?)(?:(?=[-\u2013\u2014]\s*\S)|\s*$)`,
          String.raw`^DST\s*#?\s*\d*\s*-\s*(.+)$`,
        ],
      },
      kennelCodes: ["sh3-de", "dst-h3", "fm-stgt", "super-h3"],
    },
    // Backstop for the Stuttgart H3 GCal source: the CTA filter in
    // google-calendar/adapter.ts strips "DST # - Hare Needed" placeholder rows,
    // leaving only weeks where a hare is named. This static source fills the
    // resulting Tuesday gaps. trustLevel 2 < GCal's 7 so real-titled GCal rows
    // still win the canonical event for any Tuesday they cover.
    {
      name: "DST H3 Static Schedule",
      url: "https://calendar.google.com/calendar/u/0/embed?src=1op2o8a7q9k5gif7m7b4n2ft7g@group.calendar.google.com",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 2,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "dst-h3",
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        startTime: "18:30",
        titleTemplate: "DST — {date} Hash (hare TBD)",
        defaultLocation: "Stuttgart, Germany",
        defaultDescription: "Stuttgart's weekly DST Tuesday-evening hash. Hare often listed on the Stuttgart H3 calendar — placeholder until a specific hare is named.",
      },
      kennelCodes: ["dst-h3"],
    },
    // Bay Area iCal feed (sfh3.com aggregator — ~11 kennels)
    {
      name: "SFH3 MultiHash iCal Feed",
      url: "https://www.sfh3.com/calendar.ics?kennels=all",
      type: "ICAL_FEED" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: sfh3IcalConfig,
      kennelCodes: sfh3KennelCodes,
    },
    // Bay Area HTML scraper (sfh3.com hareline — enrichment/fallback)
    {
      name: "SFH3 MultiHash HTML Hareline",
      url: "https://www.sfh3.com/runs?kennels=all",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: sfh3Config,
      kennelCodes: sfh3KennelCodes,
    },
    // East Bay H3 dedicated subsite (#1031): the kennels=all aggregator strips
    // trail names from SUMMARY ("EBH3 #1163"), but the kennel-owned ebh3.com
    // subsite ICS keeps them ("EBH3 #1163: Feast of Our Lady of Good Council").
    // Higher trust than the multihash feed so its richer title wins on merge.
    {
      name: "East Bay H3 iCal Feed",
      url: "https://www.ebh3.com/calendar.ics",
      type: "ICAL_FEED" as const,
      trustLevel: 9,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelPatterns: [["^EBH3", "ebh3"]],
        defaultKennelTag: "ebh3",
      },
      kennelCodes: ["ebh3"],
    },
    // SF Full Moon Hash — lunar STATIC_SCHEDULE.
    // Lunar dates are deterministic so scrapeDays:365 costs nothing.
    // The SFH3 multihash feed maps `^FMH3` → sffmh3 but doesn't publish FMH3
    // events on its calendar; this is the primary coverage path for sffmh3.
    {
      name: "SFFMH3 Static Schedule (Lunar)",
      url: "https://www.facebook.com/sffmh",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      config: {
        kennelTag: "sffmh3",
        lunar: {
          phase: "full",
          timezone: "America/Los_Angeles",
        },
        startTime: "18:30",
        defaultTitle: "SFFMH3 Full Moon Run",
        defaultLocation: "San Francisco, CA",
        defaultDescription: "Monthly full-moon hash. Check Facebook for start location and hare details.",
      },
      kennelCodes: ["sffmh3"],
    },
    // DC / DMV area — iCal feeds (ai1ec WordPress plugin)
    {
      name: "Charm City H3 iCal Feed",
      url: "https://charmcityh3.com/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelPatterns: [
          ["^CCH3", "cch3"],
          ["^Trail\\s*#", "cch3"],
        ],
        defaultKennelTag: "cch3",
        titleHarePattern: "~\\s*(.+)$",
      },
      kennelCodes: ["cch3"],
    },
    // BAH3 iCal Feed — REMOVED: all-in-one-event-calendar plugin gone, endpoint returns HTML. Never successfully scraped.
    // DC / DMV area — HTML scraper sources
    {
      name: "EWH3 WordPress Trail News",
      url: "https://www.ewh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["ewh3"],
    },
    {
      name: "DCH4 WordPress Trail Posts",
      url: "https://dch4.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["dch4"],
    },
    {
      name: "OFH3 Blogspot Trail Posts",
      url: "https://www.ofh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["ofh3"],
    },
    {
      name: "Hangover H3 DigitalPress Blog",
      url: "https://hangoverhash.digitalpress.blog/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["h4"],
    },
    // DC Full Moon Hash — anchor-mode lunar STATIC_SCHEDULE.
    // DCFMH3 runs Friday/Saturday "near the full moon" rather than on the
    // exact phase. `nearest` snaps each phase to the closest Saturday
    // (forward on tie). Hash Rego covers individual registrations; this
    // source provides forward-looking projections for Travel Mode + calendar.
    {
      name: "DCFMH3 Static Schedule (Lunar Anchor)",
      url: "https://sites.google.com/site/dcfmh3/home",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      config: {
        kennelTag: "dcfmh3",
        lunar: {
          phase: "full",
          timezone: "America/New_York",
          anchorWeekday: "SA",
          anchorRule: "nearest",
        },
        startTime: "18:30",
        defaultTitle: "DCFMH3 Full Moon Run",
        defaultLocation: "Washington, DC",
        defaultDescription: "Monthly full-moon hash, run on the Saturday nearest the full moon. Check Hash Rego or the kennel website for hare and start details.",
      },
      kennelCodes: ["dcfmh3"],
    },
    // Hash Rego (hashrego.com — multi-kennel registration platform)
    {
      name: "Hash Rego",
      url: "https://hashrego.com/events",
      type: "HASHREGO" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["bfm", "ewh3", "wh4", "gfh3", "ch3", "dch4", "dcfmh3", "fch3", "oh3", "wsh3", "mrh3", "bfh3"],
      kennelSlugMap: {
        bfm: "BFMH3", ewh3: "EWH3", wh4: "WH4", gfh3: "GFH3",
        ch3: "CH3", dch4: "DCH4", dcfmh3: "DCFMH3", fch3: "FCH3", oh3: "OregonH3",
        wsh3: "WSH3", mrh3: "MRH3", bfh3: "BFH3",
      },
    },
    // ===== TEXAS =====
    // --- Austin (2 Google Calendars) ---
    {
      name: "Austin H3 Calendar",
      url: "austin.ah3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "ah3",
        // Title format: "{Hare1 and Hare2} - AH3 #N". Requiring an explicit
        // " - " separator keeps the dash out of the capture group (#1210 —
        // lazy match `(.+?)\s+AH3\s+#` left a trailing " -" on every event)
        // and avoids matching titles where the slot before AH3 isn't a hare
        // (e.g. titles whose author wrote a trail-type name in the hare slot).
        titleHarePattern: String.raw`^(.+?)\s+-\s+AH3\s+#`,
      },
      kennelCodes: ["ah3"],
    },
    {
      name: "Keep Austin Weird H3 Calendar",
      url: "o2v8lpb3bs3kpohpi6hd0g426k@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "kawh3",
      },
      kennelCodes: ["kawh3"],
    },
    // --- Houston (1 Google Calendar + 1 Blogger + 2 Static Schedules) ---
    {
      name: "Houston Hash Calendar",
      url: "hashvoice@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["Brass Monkey H3|Brass Monkey", "bmh3-tx"],
          ["GALVESTON H3|Galveston H3|GH3\\s*#|#\\d+\\s*Galveston", "galh3"],
          ["Space City H3|Space City Hash|SCH3", "space-city-h3"],
          ["Moooouston H3|Moooo?uston", "moooouston-h3"],
          ["Mosquito H3|Mosquito", "mosquito-h3"],
        ],
        defaultKennelTag: "h4-tx",
        skipPatterns: ["^VOICE:", "^Platterpuss"],
        defaultTitles: {
          "moooouston-h3": "Moooouston H3 Trail",
          // #1060: GCal SUMMARY is the trailing-colon placeholder
          // "Space City Hash:" — adapter strips the trailing ":" then we
          // surface the friendly default title across all 24 events.
          "space-city-h3": "Space City H3 Trail",
        },
        staleTitleAliases: {
          // #1060: "Space City Hash" doesn't normalize to "space-city-h3"
          // (different suffix words) so titleMatchesKennelTag misses. Opt in
          // explicitly so the colon-stripped title triggers defaultTitles.
          "space-city-h3": ["Space City Hash"],
        },
      },
      kennelCodes: ["h4-tx", "bmh3-tx", "mosquito-h3", "moooouston-h3", "space-city-h3", "galh3"],
    },
    {
      name: "Brass Monkey H3 Blog",
      url: "https://teambrassmonkey.blogspot.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      kennelCodes: ["bmh3-tx"],
    },
    {
      name: "Mosquito H3 Static Schedule (1st Wed)",
      url: "https://www.facebook.com/groups/MosquitoH3/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "mosquito-h3",
        rrule: "FREQ=MONTHLY;BYDAY=1WE",
        startTime: "18:30",
        defaultTitle: "Mosquito H3 Bimonthly Run",
        defaultLocation: "Houston, TX",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/MosquitoH3/ for updates on locations.",
      },
      kennelCodes: ["mosquito-h3"],
    },
    {
      name: "Mosquito H3 Static Schedule (3rd Wed)",
      url: "https://www.facebook.com/groups/MosquitoH3/#3rd-wed",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "mosquito-h3",
        rrule: "FREQ=MONTHLY;BYDAY=3WE",
        startTime: "18:30",
        defaultTitle: "Mosquito H3 Bimonthly Run",
        defaultLocation: "Houston, TX",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/MosquitoH3/ for updates on locations.",
      },
      kennelCodes: ["mosquito-h3"],
    },
    // --- DFW (1 HTML scraper — PHP calendar covering 5 kennels) ---
    {
      name: "DFW Hash Calendar",
      url: "http://www.dfwhhh.org/calendar/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["dh3-tx", "duhhh", "noduhhh", "fwh3", "yakh3"],
    },
    // --- El Paso (1 Google Calendar) ---
    {
      name: "BJH3 Google Calendar",
      url: "borderjumpersh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "bjh3",
        // BJH3's calendar imports US federal holidays as if they were trail events.
        // The adapter's organizer-email filter handles Google's imported holiday
        // calendars; this title list is a stopgap for holidays copied directly
        // into the BJH3 calendar (no holiday-calendar organizer to detect).
        skipPatterns: [
          String.raw`^Thanksgiving\b`,
          String.raw`^Veterans\s+Day\b`,
          String.raw`^Halloween\b`,
          String.raw`^Indigenous\s+Peoples?'?s?\s+Day\b`,
          String.raw`Daylight\s+Saving`,
          String.raw`^Independence\s+Day\b`,
          String.raw`^Memorial\s+Day\b`,
          String.raw`^Labor\s+Day\b`,
          String.raw`^Christmas\b`,
          String.raw`^New\s+Year`,
          String.raw`^Martin\s+Luther\s+King`,
          String.raw`^Columbus\s+Day\b`,
          String.raw`^Presidents?'?s?\s+Day\b`,
          String.raw`^Easter\b`,
          String.raw`^Juneteenth\b`,
        ],
      },
      kennelCodes: ["bjh3"],
    },
    // --- Corpus Christi (1 Google Calendar) ---
    {
      name: "Corpus Christi H3 Calendar",
      url: "c2h3hash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "c2h3",
      },
      kennelCodes: ["c2h3"],
    },
    // ===== UPSTATE NEW YORK =====
    // --- Rochester (Google Calendar) ---
    {
      name: "Flour City H3 Google Calendar",
      url: "flourcitymismanagement@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "flour-city",
      },
      kennelCodes: ["flour-city"],
    },
    // --- Syracuse (HTML scraper) ---
    {
      name: "SOH4 Website",
      url: "https://www.soh4.com/trails/feed/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { defaultKennelTag: "soh4" },
      kennelCodes: ["soh4"],
    },
    // --- Capital District (HTML scraper) ---
    {
      name: "Halve Mein Website",
      url: "https://www.hmhhh.com/index.php?log=upcoming.con",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { defaultKennelTag: "halvemein" },
      kennelCodes: ["halvemein"],
    },
    // --- Ithaca (HTML scraper) ---
    {
      name: "IH3 Website Hareline",
      url: "http://ithacah3.org/hare-line/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { defaultKennelTag: "ih3", upcomingOnly: true },
      kennelCodes: ["ih3"],
    },
    // --- Buffalo (Google Calendar) ---
    {
      name: "Buffalo H3 Google Calendar",
      url: "hashinthebuff@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "bh3",
      },
      kennelCodes: ["bh3"],
    },
    // --- Hudson Valley (Meetup) ---
    {
      name: "Hudson Valley H3 Meetup",
      url: "https://www.meetup.com/Hudson-Valley-Hash-House-Harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "Hudson-Valley-Hash-House-Harriers",
        kennelTag: "hvh3-ny",
      },
      kennelCodes: ["hvh3-ny"],
    },
    // ===== PENNSYLVANIA (outside Philly) =====
    // --- Pittsburgh (Google Calendar aggregator) ---
    {
      name: "Pittsburgh Hash Calendar",
      url: "pghhashcalendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "pgh-h3",
      },
      kennelCodes: ["pgh-h3"],
    },
    // --- Pittsburgh (Iron City iCal feed) ---
    {
      name: "Iron City H3 iCal Feed",
      url: "https://ironcityh3.com/?post_type=tribe_events&ical=1&eventDisplay=list",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "ich3",
      },
      kennelCodes: ["ich3"],
    },
    // --- State College (Nittany Valley Google Calendar) ---
    {
      name: "Nittany Valley H3 Calendar",
      url: "55k6rnam11akkav5vljqlsc6lo@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "nvhhh",
      },
      kennelCodes: ["nvhhh"],
    },
    // LVH3 Hareline Calendar — REMOVED: calendar ID returns 404, has never successfully scraped. FB is primary for LVH3.
    // --- Reading (Localendar iCal feed) ---
    {
      name: "Reading H3 Localendar",
      url: "https://localendar.com/public/readinghhh?style=X2",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "rh3",
      },
      kennelCodes: ["rh3"],
    },
    // --- Harrisburg-Hershey (Google Calendar) ---
    {
      name: "H5 Google Calendar",
      url: "harrisburghersheyh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "h5-hash",
      },
      kennelCodes: ["h5-hash"],
    },
    // ===== DELAWARE =====
    // --- Hockessin (HTML scraper) ---
    {
      name: "Hockessin H3 Website",
      url: "https://www.hockessinhash.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { defaultKennelTag: "hockessin", upcomingOnly: true },
      kennelCodes: ["hockessin"],
    },
    // ===== VIRGINIA (outside DC metro) =====
    // --- Richmond (Calendar + Meetup) ---
    {
      name: "Richmond H3 Google Calendar",
      url: "979d12b454f944e14bd00e8d0d0c30b1109d6e5f37ec4817542ae35f86f90ae8@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: { defaultKennelTag: "rvah3" },
      kennelCodes: ["rvah3"],
    },
    {
      name: "Richmond H3 Meetup",
      url: "https://www.meetup.com/richmond-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "richmond-hash-house-harriers",
        kennelTag: "rvah3",
        // Word-boundary patterns (not anchored) so prefixed Meetup titles like
        // "ANNUAL GENERAL MEEING: Chain Gang ... Trail #40" route correctly.
        // Closes #992. Alt names (Belle Isle, Titanic) included since the same
        // prefix-blindness affects sister kennels.
        kennelPatterns: [
          ["\\b(?:BIBH3|Belle Isle)\\b", "bibh3"],
          ["\\b(?:TMFMH3|Titanic)\\b", "tmfmh3"],
          ["\\bChain Gang\\b", "chain-gang-hhh"],
        ],
      },
      kennelCodes: ["rvah3", "bibh3", "tmfmh3", "chain-gang-hhh"],
    },
    // --- Fort Eustis (Calendar + Meetup) ---
    {
      name: "Fort Eustis H3 Google Calendar",
      url: "ft.eustish3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: { defaultKennelTag: "feh3" },
      kennelCodes: ["feh3"],
    },
    {
      name: "Fort Eustis H3 Meetup",
      url: "https://www.meetup.com/FEH3-Hash/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "FEH3-Hash", kennelTag: "feh3" },
      kennelCodes: ["feh3"],
    },
    // --- BDSM H3 (Meetup) ---
    {
      name: "BDSM H3 Meetup",
      url: "https://www.meetup.com/BDSM-Hash-House-Harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "BDSM-Hash-House-Harriers", kennelTag: "bdsmh3" },
      kennelCodes: ["bdsmh3"],
    },
    // --- cHARLOTtesville (Meetup) ---
    {
      name: "cHARLOTtesville H3 Meetup",
      url: "https://www.meetup.com/meetup-group-xxcniptw/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { groupUrlname: "meetup-group-xxcniptw", kennelTag: "cvilleh3" },
      kennelCodes: ["cvilleh3"],
    },
    // --- Fredericksburg (Static Schedule — kennel already exists, adding source) ---
    {
      name: "FUH3 Static Schedule",
      url: "https://www.facebook.com/groups/fuh3va/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "fuh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-08",
        startTime: "15:00",
        defaultTitle: "FUH3 Biweekly Run",
        defaultLocation: "Fredericksburg, VA",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/fuh3va/ for updates on locations.",
      },
      kennelCodes: ["fuh3"],
    },
    // --- Tidewater (Static Schedule — main Sunday trail only) ---
    {
      name: "Tidewater H3 Static Schedule",
      url: "https://www.facebook.com/groups/SEVAHHH",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "twh3",
        rrule: "FREQ=WEEKLY;BYDAY=SU",
        startTime: "14:00",
        defaultTitle: "Tidewater H3 Weekly Run",
        defaultLocation: "Virginia Beach, VA",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/SEVAHHH for updates on locations and times. Times vary seasonally.",
      },
      kennelCodes: ["twh3"],
    },
    // --- Lynchburg (Static Schedule — Wednesday only) ---
    {
      name: "Seven Hills H3 Static Schedule",
      url: "https://www.facebook.com/groups/41511405734/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "7h4",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        startTime: "18:30",
        defaultTitle: "Seven Hills H3 Weekly Run",
        defaultLocation: "Lynchburg, VA",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/41511405734/ for updates on locations.",
      },
      kennelCodes: ["7h4"],
    },
    // Per-trail enrichment from the kennel's Google Sites homepage. Emits one
    // event per scrape (the current/upcoming trail) with real title, hares,
    // start address, and time — overrides the synthetic static-schedule values.
    {
      name: "Seven Hills H3 Google Sites",
      url: "https://sites.google.com/view/7h4/home",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 30,
      kennelCodes: ["7h4"],
    },
    // ===== NORTH CAROLINA =====
    // --- Raleigh / Triangle ---
    {
      name: "SWH3 Google Calendar",
      url: "sirwaltersh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: { defaultKennelTag: "swh3" },
      kennelCodes: ["swh3"],
    },
    {
      name: "SWH3 Trail Announcements",
      url: "https://swh3.wordpress.com/category/trail-announcements/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      kennelCodes: ["swh3"],
    },
    {
      name: "Carolina Larrikins Google Calendar",
      url: "3p2vupffo2qukm6ee8gg9clo3o@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: { defaultKennelTag: "larrikins" },
      kennelCodes: ["larrikins"],
    },
    // --- Charlotte (Meetup) ---
    {
      name: "Charlotte H3 Meetup",
      url: "https://www.meetup.com/charlotte-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "charlotte-hash-house-harriers", kennelTag: "ch3-nc" },
      kennelCodes: ["ch3-nc"],
    },
    // --- Asheville (Meetup) ---
    {
      name: "Asheville H3 Meetup",
      url: "https://www.meetup.com/AVLH3-On-On/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "AVLH3-On-On", kennelTag: "avlh3" },
      kennelCodes: ["avlh3"],
    },
    // --- Wilmington / Cape Fear (WordPress.com blog API) ---
    {
      name: "Cape Fear H3 Website",
      url: "https://capefearh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { defaultKennelTag: "cfh3", upcomingOnly: true },
      kennelCodes: ["cfh3"],
    },
    // --- Fayetteville (Meetup) ---
    {
      name: "Carolina Trash H3 Meetup",
      url: "https://www.meetup.com/fayetteville-running-training-meetup-group/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { groupUrlname: "fayetteville-running-training-meetup-group", kennelTag: "ctrh3" },
      kennelCodes: ["ctrh3"],
    },
    // ===== FLORIDA =====
    // --- API-based sources ---
    {
      name: "Miami H3 Meetup",
      url: "https://www.meetup.com/miami-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "miami-hash-house-harriers",
        kennelTag: "mia-h3",
      },
      kennelCodes: ["mia-h3"],
    },
    {
      name: "Key West H3 Google Calendar",
      url: "264vvpn7002rqbm1f82489fl8c@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "kwh3",
      },
      kennelCodes: ["kwh3"],
    },
    {
      name: "O2H3 Google Calendar",
      url: "hashcalendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "o2h3",
      },
      kennelCodes: ["o2h3"],
    },
    // --- WCFH Calendar (11 Tampa Bay kennels) ---
    {
      name: "West Central FL Hash Calendar",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["barf-h3", "b2b-h3", "jrh3", "lh3-fl", "sbh3", "lush", "nsah3", "circus-h3", "sph3-fl", "tth3-fl", "tbh3-fl"],
    },
    // --- Static schedule sources ---
    {
      name: "Wildcard H3 Static Schedule",
      url: "https://www.facebook.com/groups/373426549449867/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "wildcard-h3",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        anchorDate: "2026-03-02",
        startTime: "18:30",
        defaultTitle: "Wildcard H3 Weekly Run",
        defaultLocation: "Fort Lauderdale, FL",
        defaultDescription: "Weekly Monday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["wildcard-h3"],
    },
    {
      name: "H6 Static Schedule",
      url: "https://www.facebook.com/HollyweirdH6/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "h6",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
        anchorDate: "2026-03-06",
        startTime: "18:30",
        defaultTitle: "H6 Weekly Run",
        defaultLocation: "Hollywood, FL",
        defaultDescription: "Weekly Friday evening trail. BYOB. Check Facebook for start location.",
      },
      kennelCodes: ["h6"],
    },
    {
      name: "PBH3 Static Schedule",
      url: "https://www.facebook.com/groups/pbhhh/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "pbh3",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        anchorDate: "2026-03-04",
        startTime: "18:30",
        defaultTitle: "Palm Beach H3 Weekly Run",
        defaultLocation: "Wellington, FL",
        defaultDescription: "Weekly Wednesday trail. Check Facebook for start location.",
      },
      kennelCodes: ["pbh3"],
    },
    {
      name: "GATR H3 Static Schedule",
      url: "https://gatrh3.wordpress.com",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "gatr-h3",
        rrule: "FREQ=MONTHLY;BYDAY=3SA",
        anchorDate: "2026-03-21",
        startTime: "14:00",
        defaultTitle: "GATR H3 Monthly Trail",
        defaultLocation: "Gainesville, FL",
        defaultDescription: "Monthly Saturday trail run. Check WordPress blog for start location and details.",
      },
      kennelCodes: ["gatr-h3"],
    },
    // ===== GEORGIA =====
    // --- SavH3 Meetup (already in DB — ensure kennel link + bump trustLevel) ---
    {
      name: "Savannah H3 Meetup",
      url: "https://www.meetup.com/savannah-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "savannah-hash-house-harriers",
        kennelTag: "savh3",
      },
      kennelCodes: ["savh3"],
    },
    // --- Atlanta Hash Board (phpBB Atom feed — 9 kennels) ---
    {
      name: "Atlanta Hash Board",
      url: "https://board.atlantahash.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        forums: {
          "2": { kennelTag: "ah4", hashDay: "Saturday" },
          "4": { kennelTag: "ph3-atl", hashDay: "Saturday" },
          "5": { kennelTag: "bsh3", hashDay: "Sunday" },
          "6": { kennelTag: "sobh3", hashDay: "Sunday" },
          "7": { kennelTag: "whh3", hashDay: "Sunday" },
          "8": { kennelTag: "mlh4", hashDay: "Monday" },
          "9": { kennelTag: "duffh3", hashDay: "Wednesday" },
          "10": { kennelTag: "sluth3", hashDay: "Thursday" },
          "11": { kennelTag: "soco-h3", hashDay: "Friday" },
        },
      },
      kennelCodes: ["ah4", "ph3-atl", "bsh3", "sobh3", "whh3", "mlh4", "duffh3", "sluth3", "soco-h3"],
    },
    // --- Georgia Static Schedule sources ---
    {
      name: "SCH3 Static Schedule",
      url: "https://board.atlantahash.com/viewforum.php?f=3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "sch3-atl",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
        anchorDate: "2026-03-06",
        startTime: "19:00",
        defaultTitle: "SCH3 Biweekly Run",
        defaultLocation: "Atlanta, GA",
        defaultDescription: "Alternate Friday evening trail. Check Atlanta Hash Board for details.",
      },
      kennelCodes: ["sch3-atl"],
    },
    {
      name: "HMH3 Static Schedule",
      url: "https://board.atlantahash.com#hmh3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "hmh3",
        rrule: "FREQ=MONTHLY;BYDAY=1SU",
        anchorDate: "2026-03-01",
        startTime: "13:30",
        defaultTitle: "HMH3 Monthly Run",
        defaultLocation: "North Georgia",
        defaultDescription: "First Sunday monthly trail in the north Georgia foothills.",
      },
      kennelCodes: ["hmh3"],
    },
    {
      name: "CUNT H3 ATL Static Schedule",
      url: "https://board.atlantahash.com#cunth3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "cunth3-atl",
        rrule: "FREQ=MONTHLY;BYDAY=1TU",
        anchorDate: "2026-03-03",
        startTime: "19:00",
        defaultTitle: "CUNT H3 Monthly Run",
        defaultLocation: "Atlanta, GA",
        defaultDescription: "First Tuesday monthly evening trail in Atlanta.",
      },
      kennelCodes: ["cunth3-atl"],
    },
    {
      name: "PFH3 Static Schedule",
      url: "https://www.facebook.com/groups/peachfuzzh3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "pfh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
        anchorDate: "2026-03-04",
        startTime: "18:30",
        defaultTitle: "PFH3 Biweekly Run",
        defaultLocation: "Augusta, GA",
        defaultDescription: "Alternate Wednesday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["pfh3"],
    },
    {
      name: "AUGH3 Static Schedule",
      url: "https://www.facebook.com/augustaundergroundH3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "augh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "14:00",
        defaultTitle: "AUGH3 Biweekly Run",
        defaultLocation: "Augusta, GA",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["augh3"],
    },
    {
      name: "MGH4 Static Schedule",
      url: "https://www.facebook.com/groups/middlegeorgiahash",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "mgh4",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "14:00",
        defaultTitle: "MGH4 Biweekly Run",
        defaultLocation: "Macon, GA",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["mgh4"],
    },
    {
      name: "W3H3 GA Static Schedule",
      url: "https://www.facebook.com/groups/w3h3macon",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "w3h3-ga",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        anchorDate: "2026-03-04",
        startTime: "18:30",
        defaultTitle: "W3H3 Weekly Run",
        defaultLocation: "Macon, GA",
        defaultDescription: "Weekly Wednesday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["w3h3-ga"],
    },
    {
      name: "CVH3 Static Schedule",
      url: "https://www.facebook.com/groups/cvh3columbus",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "cvh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "11:00",
        titleTemplate: "CVH3 — {date} Hash",
        defaultLocation: "Columbus, GA",
        defaultDescription: "Alternate Saturday morning trail. Check Facebook for start location.",
      },
      kennelCodes: ["cvh3"],
    },
    {
      name: "R2H3 Static Schedule",
      url: "https://www.facebook.com/groups/r2h3rome",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "r2h3",
        rrule: "FREQ=MONTHLY;BYDAY=2SA",
        anchorDate: "2026-03-14",
        startTime: "14:30",
        defaultTitle: "R2H3 Monthly Run",
        defaultLocation: "Rome, GA",
        defaultDescription: "Second Saturday monthly trail. Check Facebook for start location.",
      },
      kennelCodes: ["r2h3"],
    },
    // ===== SOUTH CAROLINA =====
    {
      name: "Charleston Heretics Meetup",
      url: "https://www.meetup.com/charlestonheretics/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "charlestonheretics",
        kennelTag: "chh3",
      },
      kennelCodes: ["chh3"],
    },
    {
      name: "Charleston H3 Static Schedule",
      url: "https://www.facebook.com/groups/charlestonhash/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "ch3-sc",
        rrule: "FREQ=WEEKLY;BYDAY=TH",
        anchorDate: "2026-03-05",
        startTime: "18:30",
        defaultTitle: "CH3 Weekly Run",
        defaultLocation: "Charleston, SC",
        defaultDescription: "Weekly Thursday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["ch3-sc"],
    },
    {
      name: "BUDH3 Static Schedule",
      url: "https://www.facebook.com/groups/beaufortuglydog/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "budh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "15:00",
        defaultTitle: "BUDH3 Biweekly Run",
        defaultLocation: "Beaufort, SC",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["budh3"],
    },
    {
      name: "Columbian H3 Static Schedule (1st Sunday)",
      url: "https://www.facebook.com/groups/columbianh3/#1st-sunday",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "colh3",
        rrule: "FREQ=MONTHLY;BYDAY=1SU",
        anchorDate: "2026-03-01",
        startTime: "15:00",
        titleTemplate: "ColH3 — 1st Sunday Hash",
        defaultLocation: "Columbia, SC",
        defaultDescription: "1st & 3rd Sunday trail. Check Facebook for start location.",
      },
      kennelCodes: ["colh3"],
    },
    {
      name: "Columbian H3 Static Schedule (3rd Sunday)",
      url: "https://www.facebook.com/groups/columbianh3/#3rd-sunday",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "colh3",
        rrule: "FREQ=MONTHLY;BYDAY=3SU",
        anchorDate: "2026-03-15",
        startTime: "15:00",
        titleTemplate: "ColH3 — 3rd Sunday Hash",
        defaultLocation: "Columbia, SC",
        defaultDescription: "1st & 3rd Sunday trail. Check Facebook for start location.",
      },
      kennelCodes: ["colh3"],
    },
    {
      name: "Secession H3 Static Schedule",
      url: "https://secessionh3.wordpress.com",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "sech3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-14",
        startTime: "15:00",
        defaultTitle: "SecH3 Biweekly Run",
        defaultLocation: "Columbia, SC",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["sech3"],
    },
    {
      name: "Palmetto H3 Static Schedule",
      url: "https://www.facebook.com/PalmettoH3/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "palh3",
        rrule: "FREQ=MONTHLY;BYDAY=3SA",
        anchorDate: "2026-03-21",
        startTime: "14:00",
        defaultTitle: "PalH3 Monthly Run",
        defaultLocation: "Sumter, SC",
        defaultDescription: "Third Saturday monthly trail. Check Facebook for start location.",
      },
      kennelCodes: ["palh3"],
    },
    {
      name: "Upstate H3 Static Schedule",
      url: "https://www.upstatehashers.com/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "uh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU",
        anchorDate: "2026-03-08",
        startTime: "14:00",
        defaultTitle: "UH3 Biweekly Run",
        defaultLocation: "Greenville, SC",
        defaultDescription: "Alternate Sunday trail. Check website or Facebook for start location.",
      },
      kennelCodes: ["uh3"],
    },
    {
      name: "GOTH3 Static Schedule",
      url: "https://gothh3.com/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "goth3",
        rrule: "FREQ=MONTHLY;BYDAY=3SA",
        anchorDate: "2026-03-21",
        startTime: "14:30",
        defaultTitle: "GOTH3 Monthly Run",
        defaultLocation: "Greenville, SC",
        defaultDescription: "Third Saturday monthly trail. Casual walker/runner mix.",
      },
      kennelCodes: ["goth3"],
    },
    {
      name: "Grand Strand H3 Static Schedule",
      url: "https://www.facebook.com/GrandStrandHashing/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "gsh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "16:00",
        defaultTitle: "GSH3 Biweekly Run",
        defaultLocation: "Myrtle Beach, SC",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["gsh3"],
    },
    // Massachusetts
    {
      name: "Happy Valley H3 Static Schedule",
      url: "https://happyvalleyh3.org/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "hvh3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH",
        startTime: "18:30",
        timezone: "America/New_York",
        defaultTitle: "HVH3 Biweekly Run",
        defaultLocation: "Western Massachusetts",
        defaultDescription: "Biweekly Thursday hash in the Pioneer Valley.",
      },
      kennelCodes: ["hvh3"],
    },
    {
      name: "PooFlingers H3 Static Schedule",
      url: "https://www.facebook.com/groups/pooflingers/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "poofh3",
        rrule: "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3",
        startTime: "14:00",
        timezone: "America/New_York",
        defaultTitle: "PooFH3 Monthly Run",
        defaultLocation: "New England",
        defaultDescription: "Monthly 3rd Saturday hash throughout New England.",
      },
      kennelCodes: ["poofh3"],
    },
    {
      name: "Northboro H3 Website",
      url: "https://www.northboroh3.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["nbh3"],
    },
    // ===== VERMONT =====
    {
      name: "Von Tramp H3 Meetup",
      url: "https://www.meetup.com/vontramph3/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        groupUrlname: "vontramph3",
        kennelTag: "vth3",
      },
      kennelCodes: ["vth3"],
    },
    {
      name: "Burlington H3 Website Hareline",
      url: "https://www.burlingtonh3.com/hareline",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { upcomingOnly: true },
      kennelCodes: ["burlyh3"],
    },
    // ===== RHODE ISLAND =====
    {
      name: "RIH3 Static Schedule",
      url: "https://rih3.com/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        kennelTag: "rih3",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        anchorDate: "2026-03-09",
        startTime: "18:30",
        timezone: "America/New_York",
        defaultTitle: "RIH3 Monday Trail",
        defaultLocation: "Rhode Island",
        defaultDescription: "Weekly Monday evening hash. 6:30 PM sharp.",
      },
      kennelCodes: ["rih3"],
    },
    {
      name: "RIH3 Website Hareline",
      url: "https://rih3.com/hareline.html",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["rih3"],
    },
    // ===== CONNECTICUT =====
    {
      name: "Narwhal H3 Meetup (CTH3)",
      url: "https://www.meetup.com/meetup-group-cwrnpwpc/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        groupUrlname: "meetup-group-cwrnpwpc",
        kennelTag: "narwhal-h3",
      },
      kennelCodes: ["narwhal-h3"],
    },
    // ===== OREGON =====
    // --- Oregon Hashing Calendar aggregator (OH3, TGIF, Cherry City events) ---
    {
      name: "Oregon Hashing Calendar",
      url: "cae3r4u2uhucmmi9rvq5eu6obg@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "cae3r4u2uhucmmi9rvq5eu6obg@group.calendar.google.com",
        // Multi-kennel pattern (#1023 step 4): titles mentioning BOTH Cherry
        // City and OH3 (e.g. "Cherry City H3 #1 / OH3 # 1340" — the inaugural
        // joint trail surfaced in #991) emit both kennels as co-hosts so the
        // event lands on both kennel pages. The array form takes precedence
        // over the single-tag patterns below per spec §2 D15, so single-kennel
        // titles still route correctly.
        kennelPatterns: [
          ["(?:Cherry City.*OH3)|(?:OH3.*Cherry City)", ["cch3-or", "oh3"]],
          ["^OH3\\b|OH3 Full Moon", "oh3"],
          ["TGIF|Friday.*Pubcrawl", "tgif"],
          ["Cherry City|Cherry Cherry City", "cch3-or"],
        ],
        defaultKennelTag: "oh3",
        // Drop N2H3 / NNH3 events that leak into this shared aggregator.
        // N2H3 has its own No Name H3 Calendar source (trust 8), so skipping
        // here avoids cross-kennel duplicates on the Oregon H3 hareline.
        // Anchored so joint co-host titles with the local kennel stay put.
        // Closes #584.
        skipPatterns: ["^NNH3\\b", "^N2H3\\b", "^No Name\\b"],
      },
      kennelCodes: ["oh3", "tgif", "cch3-or"],
    },
    // --- Individual kennel calendars ---
    {
      name: "No Name H3 Calendar",
      url: "63h32shgrk48ci0li17lmoijeg@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "63h32shgrk48ci0li17lmoijeg@group.calendar.google.com",
        defaultKennelTag: "n2h3",
      },
      kennelCodes: ["n2h3"],
    },
    {
      name: "Kahuna H3 Calendar",
      url: "e63ac95062e8cb80b4c470e316701cfba3046903bc6662c456efe87d52250e9e@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "e63ac95062e8cb80b4c470e316701cfba3046903bc6662c456efe87d52250e9e@group.calendar.google.com",
        defaultKennelTag: "okh3",
      },
      kennelCodes: ["okh3"],
    },
    {
      name: "Portland Humpin' Hash Calendar",
      url: "e42428cbbecf52a48618c36aa1654ec0186aa307eb6d608641ef3a9e5c243128@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "e42428cbbecf52a48618c36aa1654ec0186aa307eb6d608641ef3a9e5c243128@group.calendar.google.com",
        defaultKennelTag: "ph4",
      },
      kennelCodes: ["ph4"],
    },
    {
      name: "Stumptown H3 Calendar",
      url: "5e6c1e6bdcb70c74eb924aee3d74f63e13a65c91f86844f50b37f412a768e82c@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "5e6c1e6bdcb70c74eb924aee3d74f63e13a65c91f86844f50b37f412a768e82c@group.calendar.google.com",
        defaultKennelTag: "stumph3",
      },
      kennelCodes: ["stumph3"],
    },
    {
      name: "Dead Whores H3 Calendar",
      url: "e435782c94f98136bde0957e4f791bdd3a0ac0d13970bbfe1ff34f5ddc676990@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "e435782c94f98136bde0957e4f791bdd3a0ac0d13970bbfe1ff34f5ddc676990@group.calendar.google.com",
        defaultKennelTag: "dwh3",
        // #1091 DWH3 (Portland) titles encode the hare(s) inline with the
        // kennel name. Variants:
        //   "Dead Whores H3/Tripod. And I'm Gonna Cum"
        //   "Dead Whores hash-Hare-Log Jammer"
        //   "Dead Whores Hash-Hare-Crack Up"
        //   "Dead Whores hash Hares-Ditch Bitch, Mamma Ditch"
        //   "Dead Whores-Haré-Kerstan"
        //   "Dead Whores H3- CommandHo & Drool Sargent"
        //   "DWH- Jaba the Slut & Stop, Drop, and Puke"
        // Capture hares after the prefix, optional Hare/Hares/Haré label
        // and `/` or `-` separator, stopping before any `- cancelled` suffix.
        titleHarePattern: String.raw`^(?:Dead\s+Whores(?:\s+H3|\s+hash)?|DWH)\s*[-/\s]\s*(?:Har(?:es?|é)\s*[-/]\s*)?(.+?)(?:\s*[-/]\s*cancelled\s*)?$`,
      },
      kennelCodes: ["dwh3"],
    },
    {
      name: "SWH3 Calendar",
      url: "898ddb527b83d7944c788bfbdb4074be5ee3c5ddf380acbdb206abd2861d6dc2@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "898ddb527b83d7944c788bfbdb4074be5ee3c5ddf380acbdb206abd2861d6dc2@group.calendar.google.com",
        defaultKennelTag: "swh3-or",
      },
      kennelCodes: ["swh3-or"],
    },
    {
      name: "Salem H3 Calendar",
      url: "0f125fcba18bfeca585fe7d3592c70159df9c97d620dfd68fd65a73fcd063d8c@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "0f125fcba18bfeca585fe7d3592c70159df9c97d620dfd68fd65a73fcd063d8c@group.calendar.google.com",
        defaultKennelTag: "salemh3",
      },
      kennelCodes: ["salemh3"],
    },
    {
      name: "Cherry City H3 Calendar",
      url: "711a1cfbec0cfbcc26ba28c79d943700e6b7c33c8c11896a86da701fc96291b6@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "711a1cfbec0cfbcc26ba28c79d943700e6b7c33c8c11896a86da701fc96291b6@group.calendar.google.com",
        defaultKennelTag: "cch3-or",
      },
      kennelCodes: ["cch3-or"],
    },
    {
      name: "Eugene H3 Calendar",
      url: "8b593752049f42f9aca8fb04197bfb25d7f4148db8c314991e842bbf6b4ea303@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "8b593752049f42f9aca8fb04197bfb25d7f4148db8c314991e842bbf6b4ea303@group.calendar.google.com",
        defaultKennelTag: "eh3-or",
        // #1188: every Eugene event is all-day; without this they all get dropped.
        includeAllDayEvents: true,
        // #1189: emoji-delimited titles. 🌲 prefix, 👣 = hare delimiter (with
        // optional `-`), 🍺 = time/location tail. Strip 👣 + tail aggressively
        // so cards stay clean when the description carries the authoritative
        // hare and the title-tail is theme prose. Capture is greedy + adapter
        // trims — avoids the lazy + trailing-`\s*$` ReDoS shape.
        titleHarePattern: String.raw`👣[\s:\-–—]*(\S.*)`,
        titleStripPatterns: [
          String.raw`^🌲\s*`,
          String.raw`🍺.*`,
          String.raw`👣.*`,
        ],
      },
      kennelCodes: ["eh3-or"],
    },
    {
      name: "Central Oregon H3 Calendar",
      url: "6ureum96qhgf13kj820i61ovq8@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "6ureum96qhgf13kj820i61ovq8@group.calendar.google.com",
        defaultKennelTag: "coh3",
        // #981: hares are encoded in the summary as `COH3 #NNN with <Hare>` /
        // `COH3 <Theme> with <Hare1> & <Hare2>`. Capture is greedy + adapter
        // trims — avoids the lazy + trailing-`\s*$` ReDoS shape.
        titleHarePattern: String.raw`\bwith\s+(\S.*)`,
      },
      kennelCodes: ["coh3"],
    },
    // ===== WASHINGTON =====
    // --- WA Hash Google Calendar (multi-kennel aggregator) ---
    {
      name: "WA Hash Google Calendar",
      url: "8d65om7lrdq538ksqednh2n648@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["^SH3\\b|Seattle H3", "sh3-wa"],
          ["^PSH3\\b|Puget Sound", "psh3"],
          ["^NBH3\\b|No Balls", "nbh3-wa"],
          ["^RCH3\\b|Rain City", "rch3-wa"],
          ["SeaMon", "seamon-h3"],
          ["^TH3\\b|Tacoma H3|^Tacoma", "th3-wa"],
          ["^SSH3\\b|South Sound", "ssh3-wa"],
          ["CUNTh", "cunth3-wa"],
          ["Taint", "taint-h3"],
          ["Giggity", "giggity-h3"],
          ["South End|^SEH3|^SEH5", "seh3-wa"],
          ["HSWTF", "hswtf-h3"],
          ["Leap Year", "leapyear-h3"],
        ],
        defaultKennelTag: "sh3-wa",
        strictKennelRouting: true,
        // CUNTh stores many of its trail events as all-day RECURRENCE-ID overrides
        // (DTSTART;VALUE=DATE). Without this opt-in, those events are dropped by
        // the all-day filter (#1021). strictKennelRouting bounds the blast radius —
        // anything not matching kennelPatterns is still discarded.
        includeAllDayEvents: true,
      },
      kennelCodes: ["sh3-wa", "psh3", "nbh3-wa", "rch3-wa", "seamon-h3", "th3-wa", "ssh3-wa", "cunth3-wa", "taint-h3", "giggity-h3", "seh3-wa", "hswtf-h3", "leapyear-h3"],
    },
    // --- Per-kennel Google Sheets (secondary enrichment) ---
    {
      name: "Seattle H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1rTa69Z12V4EAdlRGToOiMIIiFiTbqZFN653hs5DwALk",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        // `gid: 0` used to work via /export?format=csv, but the endpoint began returning
        // 400 "Sorry, unable to open the file" on 2026-04-03. The gviz/tq endpoint (used
        // when gid is absent and tabs are named) still works, so we drop gid here.
        sheetId: "1rTa69Z12V4EAdlRGToOiMIIiFiTbqZFN653hs5DwALk",
        skipRows: 0,
        tabs: ["Sheet1"],
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: 4, description: 5 },
        kennelTagRules: { default: "sh3-wa" },
      },
      kennelCodes: ["sh3-wa"],
    },
    {
      name: "Puget Sound H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1XTN-ivc5NClSt4Z1HVYf0ddEzF3aXcnd1ZH0JFpLXm4",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "1XTN-ivc5NClSt4Z1HVYf0ddEzF3aXcnd1ZH0JFpLXm4",
        gid: 237970172,
        skipRows: 2,
        columns: { runNumber: 0, date: 2, hares: 3, title: 4, location: -1 },
        kennelTagRules: { default: "psh3" },
      },
      kennelCodes: ["psh3"],
    },
    // No Balls H3 Hareline Sheet — DISABLED: sheet is private (401), no 2025/2026 data entered.
    // NBH3 events come through via the shared WA Hash Google Calendar instead.
    // Re-enable if sheet owner makes it publicly viewable.
    {
      name: "Rain City H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1UOzHLGytOdlzjet7VE25gXAMcuU4oc8fi8gY-4cQUkA",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "1UOzHLGytOdlzjet7VE25gXAMcuU4oc8fi8gY-4cQUkA",
        gid: 0,
        skipRows: 2,
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: -1 },
        kennelTagRules: { default: "rch3-wa" },
      },
      kennelCodes: ["rch3-wa"],
    },
    {
      name: "SeaMon H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/12Ajped8oyheVayDmHs0d8glLVo23VOg8gRKCe4yQP-g",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "12Ajped8oyheVayDmHs0d8glLVo23VOg8gRKCe4yQP-g",
        gid: 0,
        skipRows: 1,
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: -1 },
        kennelTagRules: { default: "seamon-h3" },
      },
      kennelCodes: ["seamon-h3"],
    },
    {
      name: "Leap Year H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_z30ZkQNOwcAka4qU22bAGYIVjJFc5NyICst9OeUWPvi27lNK8ICkZllzLI0gjLwQDjVvlt3mMlDM/pub",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 800,
      config: {
        sheetId: "anonymous",
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_z30ZkQNOwcAka4qU22bAGYIVjJFc5NyICst9OeUWPvi27lNK8ICkZllzLI0gjLwQDjVvlt3mMlDM/pub?output=csv",
        skipRows: 2,
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: -1 },
        kennelTagRules: { default: "leapyear-h3" },
      },
      kennelCodes: ["leapyear-h3"],
    },
    // ===== COLORADO =====
    // --- Denver H3 (Google Calendar) ---
    {
      name: "Denver H3 Google Calendar",
      url: "denverkennel@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "dh3-co" },
      kennelCodes: ["dh3-co"],
    },
    // --- Mile High Humpin' Hash (Google Calendar) ---
    {
      name: "Mile High Humpin Hash Calendar",
      url: "huhahareraiser@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "mihi-huha" },
      kennelCodes: ["mihi-huha"],
    },
    // --- Colorado H3 Aggregator (Google Calendar — covers Boulder H3 + others) ---
    {
      name: "Colorado H3 Aggregator Calendar",
      url: "v94tqngukqr5cdffg9q7rruvl0@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      // NB: no defaultKennelTag — unmatched titles (CUM/BASH/Steamboat/DP/etc.) surface as
      // UNMATCHED_TAGS alerts for admin triage instead of silently attributing to bh3-co (issue #850).
      config: {
        kennelPatterns: [
          ["Boulder H3|^BH3\\b", "bh3-co"],
          ["MiHiHuHa|MiHiHUHa|Mile High Humpin", "mihi-huha"],
          ["Denver H3|^DH3\\b", "dh3-co"],
        ],
      },
      kennelCodes: ["bh3-co", "mihi-huha", "dh3-co"],
    },
    // --- Boulder H3 Website (Divi/WordPress blog) ---
    // Primary feed for BH3 Boulder. Reads recent + upcoming runs from
    // boulderh3.com/hashes/ (page 1). Historical archive (pages 2–20)
    // is filled by scripts/backfill-bh3-co-history.ts.
    {
      name: "Boulder H3 Website",
      url: "https://boulderh3.com/hashes/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["bh3-co"],
    },
    // --- Fort Collins H3 (Google Calendar) ---
    {
      name: "Fort Collins H3 Google Calendar",
      url: "fc8df0937002479306c3fed0055fb7273cb62a46abe5c7f652e3e318310f9143@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: {
        defaultKennelTag: "fch3-co",
        // #1149: kennel uses occasional all-day entries for non-trail events
        // (Rex Manning Day, anniversaries). Trail events are timed and
        // unaffected.
        includeAllDayEvents: true,
      },
      kennelCodes: ["fch3-co"],
    },
    // --- Colorado Springs H3 (Google Calendar — multi-kennel) ---
    {
      name: "Colorado Springs H3 Calendar",
      url: "cspringsh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["^PPH4|Pikes Peak", "pph4"],
          ["^Kimchi", "kimchi-h3"],
          ["^DIM", "dim-h3"],
        ],
        defaultKennelTag: "pph4",
      },
      kennelCodes: ["pph4", "kimchi-h3", "dim-h3"],
    },
    // ===== MINNESOTA =====
    {
      name: "Minneapolis H3 Calendar",
      url: "minneapolishash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["\\bT3H3\\b|Twin Titties", "t3h3"],
          ["\\bMH3\\b", "mh3-mn"]
        ],
        defaultKennelTag: "mh3-mn",
      },
      kennelCodes: ["mh3-mn", "t3h3"],
    },
    // ===== MICHIGAN =====
    {
      name: "MoA2H3 Google Calendar",
      url: "ea729ba97f0f3cd030c9e8edab00b19b6b9173f3c582cdfcd240dc461b7cc54e@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "moa2h3" },
      kennelCodes: ["moa2h3"],
    },
    {
      name: "DeMon H3 Google Calendar",
      url: "demonhashhouseharriers@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: {
        defaultKennelTag: "demon-h3",
        harePatterns: [String.raw`(?:^|\n)\s*WHO\s*\(?(?:hares?)?\)?\s*:?\s*(.+)`],
      },
      kennelCodes: ["demon-h3"],
    },
    {
      name: "GLH3 Google Calendar",
      url: "fejshhk8grbkhp9cc3s5blub9o@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "glh3" },
      kennelCodes: ["glh3"],
    },
    // ===== ARIZONA =====
    // --- Phoenix (iCal Feed — multi-kennel) ---
    {
      name: "Phoenix H3 Events",
      url: "https://www.phoenixhhh.org/?plugin=events-manager&page=events.ics",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["^LBH\\b|Lost Boobs", "lbh-phx"],
          ["Hump D", "hump-d"],
          ["Wrong Way", "wrong-way"],
          ["Dusk.*Down|FDTDD", "fdtdd"],
        ],
        defaultKennelTag: "wrong-way",
      },
      kennelCodes: ["lbh-phx", "hump-d", "wrong-way", "fdtdd"],
    },
    // --- Phoenix (HTML Scraper — Big Ass Calendar) ---
    {
      name: "Phoenix H3 Big Ass Calendar",
      url: "https://www.phoenixhhh.org/?page_id=21",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["^LBH\\b|Lost Boobs", "lbh-phx"],
          ["Hump D", "hump-d"],
          ["Wrong Way", "wrong-way"],
          ["Dusk.*Down|FDTDD", "fdtdd"],
        ],
        defaultKennelTag: "wrong-way",
      },
      kennelCodes: ["lbh-phx", "hump-d", "wrong-way", "fdtdd"],
    },
    // --- Tucson (Google Calendar — per-kennel) ---
    {
      name: "jHavelina H3 Google Calendar",
      url: "jhavelinahhh@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "jhav-h3" },
      kennelCodes: ["jhav-h3"],
    },
    {
      name: "Mr. Happy's H3 Google Calendar",
      url: "mrhappyshhh@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "mrhappy" },
      kennelCodes: ["mrhappy"],
    },
    {
      name: "Pedal Files Bash Google Calendar",
      url: "tucsonhhh@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "pedalfiles" },
      kennelCodes: ["pedalfiles"],
    },
    // ===== HAWAII =====
    {
      name: "Aloha H3 Google Calendar",
      url: "alohahhh@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          // PHH must come before H5 (kennelPatterns resolve first-match-wins).
          // Match only the kennel tag PHH — not "Pearl Harbor" as a location,
          // since an AH3 run at Pearl Harbor would otherwise be misrouted.
          [String.raw`\bPHH\b`, "phh-hi"],
          ["\\bH5\\b|Honolulu H[45]", "h5-hi"],
        ],
        defaultKennelTag: "ah3-hi",
        // Upcoming AH3 events encode hares in the title as the last
        // dash-separated segment: "AH3 #1833 - Location - Hare Name".
        // The greedy .* before the last ` - ` handles titles with extra
        // dashes (e.g. "AH3 #1828 - **EARLY START** - Location - Hare").
        // Only fires when the description body has no hares yet (upcoming
        // events before the organizer fills in the full description).
        // Closes #575.
        titleHarePattern: "^AH3\\s*#\\d+.*-\\s+(.+)$",
      },
      kennelCodes: ["ah3-hi", "h5-hi", "phh-hi"],
    },
    {
      name: "Honolulu H5 Google Calendar",
      url: "jhhk1bllbl4thqk9in5qtffb68@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: { defaultKennelTag: "h5-hi" },
      kennelCodes: ["h5-hi"],
    },
    // ===== CALIFORNIA =====
    // --- Santa Cruz (Google Calendar) ---
    {
      name: "Surf City H3 Google Calendar",
      url: "SCH3Calendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "sch3-ca" },
      kennelCodes: ["sch3-ca"],
    },
    // --- Los Angeles Area (Google Calendar) ---
    {
      name: "LAH3 Google Calendar",
      url: "hash.org_8er4h3q5qct5apu9nl2v7ic4c0@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "lah3" },
      kennelCodes: ["lah3"],
    },
    {
      name: "LBH3 Google Calendar",
      url: "hash.org_apdt0s7aam1mdl1ckc4n1rcc4k@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "lbh3" },
      kennelCodes: ["lbh3"],
    },
    {
      name: "TDH3 Google Calendar",
      url: "hash.org_efk2ibem9h2lonqgignpcp8uoo@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "tdh3-lb" },
      kennelCodes: ["tdh3-lb"],
    },
    {
      name: "GAL Google Calendar",
      url: "hash.org_vca9alu5cu5q2hkvip31fma6so@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "gal-h3" },
      kennelCodes: ["gal-h3"],
    },
    {
      name: "SUPH3 Google Calendar",
      url: "c_95c7557021b96e1c88a6df5a9132ac59082e1bfc2c2ba3eb4dc7f70b84155caa@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "suph3" },
      kennelCodes: ["suph3"],
    },
    {
      name: "Foothill H3 Google Calendar",
      url: "hash.org_6ocimc04ghdh7652dlvnjs5060@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "fth3" },
      kennelCodes: ["fth3"],
    },
    {
      name: "East LA H3 Google Calendar",
      url: "hash.org_t92ud36ad0jbao70f22d2eptuc@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "elah3" },
      kennelCodes: ["elah3"],
    },
    {
      name: "Signal Hill H3 Google Calendar",
      url: "hash.org_t8of6q45k4cki650d97m0b80dc@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "sgh3" },
      kennelCodes: ["sgh3"],
    },
    // --- Orange County (Google Calendar) ---
    {
      name: "OCHHH Google Calendar",
      url: "hash.org_gr8mpprvpgpiihhkfj0dd0ic4k@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "ochhh" },
      kennelCodes: ["ochhh"],
    },
    {
      name: "OC Hump Google Calendar",
      url: "hash.org_8jis0j5k0hanmgq2c6inrf93ho@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "ochump", defaultTitle: "OC Hump" },
      kennelCodes: ["ochump"],
    },
    // --- Central Coast (Google Calendar) ---
    {
      name: "SLOH3 Google Calendar",
      url: "blj7esp5ns5sbirko1p7amr4ig@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 90,
      config: { defaultKennelTag: "sloh3" },
      kennelCodes: ["sloh3"],
    },
    // --- San Diego (HTML Scraper) ---
    {
      name: "SDH3 Hareline",
      url: "https://sdh3.com/hareline.shtml",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        kennelCodeMap: {
          "SDH3": "sdh3", "CLH3": "clh3-sd", "LJH3": "ljh3",
          "NCH3": "nch3-sd", "IRH3": "irh3-sd", "H4": "humpin-sd",
          "FMH3": "fmh3-sd", "HAH3": "hah3-sd", "MH4": "mh4-sd",
          "DRH3": "drh3-sd",
        },
        kennelNameMap: {
          "San Diego": "sdh3", "Larrikins": "clh3-sd", "La Jolla": "ljh3",
          "North County": "nch3-sd", "Iron Rule": "irh3-sd", "Humpin": "humpin-sd",
          "Full Moon": "fmh3-sd", "Half-Assed": "hah3-sd", "Mission Harriettes": "mh4-sd",
          "Diaper Rash": "drh3-sd",
        },
        includeHistory: true,
      },
      kennelCodes: ["sdh3", "clh3-sd", "ljh3", "nch3-sd", "irh3-sd", "humpin-sd", "fmh3-sd", "hah3-sd", "mh4-sd", "drh3-sd"],
    },
    // ===== OHIO =====
    // --- Cleveland (Meetup) ---
    {
      name: "Cleveland H4 Meetup",
      url: "https://www.meetup.com/cleveland-hash-house-harriers-and-harriettes/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "cleveland-hash-house-harriers-and-harriettes",
        kennelTag: "cleh4",
      },
      kennelCodes: ["cleh4"],
    },
    // --- Akron (Meetup) ---
    {
      name: "Rubber City H3 Meetup",
      url: "https://www.meetup.com/rubber-city-hash-house-harriers-and-harriettes/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "rubber-city-hash-house-harriers-and-harriettes",
        kennelTag: "rch3",
      },
      kennelCodes: ["rch3"],
    },
    // --- Dayton (Google Calendar) ---
    {
      name: "DH4 Google Calendar",
      // Issue #1018: source previously pointed at dh3calendar@gmail.com (the
      // older Dayton H3 men-only kennel), so every DH4 event was actually a
      // DH3 event. Switched to dh4calendar@gmail.com — the calendar embedded
      // by daytonhash.com/daytonhash/schedule, which is DH4's authoritative
      // trail series.
      url: "dh4calendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "dh4calendar@gmail.com",
        defaultKennelTag: "dh4",
        // #800: calendar emits legacy "DH3 #N" titles despite the kennel
        // having been recoded to dh4. Adapter substitutes this fallback when
        // the summary is a bare {kennel-code} #N pattern.
        defaultTitle: "Dayton H4 Trail",
      },
      kennelCodes: ["dh4"],
    },
    {
      name: "MVH3 Google Calendar",
      url: "mvh3calendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "mvh3-day",
      },
      kennelCodes: ["mvh3-day"],
    },
    {
      name: "SWOT Google Calendar",
      url: "swoth3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "swot-h3",
      },
      kennelCodes: ["swot-h3"],
    },
    // --- Cincinnati (Google Calendar) ---
    {
      name: "SCH4 Google Calendar",
      url: "sch4calendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "sch4",
      },
      kennelCodes: ["sch4"],
    },
    {
      name: "QCH4 Google Calendar",
      url: "jjfn26n873ro3qi1ckobikroso@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "qch4",
      },
      kennelCodes: ["qch4"],
    },
    {
      name: "LVH3 Google Calendar",
      url: "lickingvalleyh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "lvh3-cin",
      },
      kennelCodes: ["lvh3-cin"],
    },
    // --- Columbus (Renegade H3 website) ---
    {
      name: "Renegade H3 Website",
      url: "https://www.renegadeh3.com/events",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["renh3"],
    },
    // ===== GERMANY =====
    // Munich (Google Sheets — multi-kennel)
    {
      name: "Munich H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTtbizBGgic04azrTshlhcpRolA73yaiIijIFUSV0Gq7gU7KKchGWl0JRPHeIYspoq1PAx5XlyLTBfr/pub",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "anonymous",
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTtbizBGgic04azrTshlhcpRolA73yaiIijIFUSV0Gq7gU7KKchGWl0JRPHeIYspoq1PAx5XlyLTBfr/pub?output=csv&gid=2100367947",
        // #923: source has 6 cols (#, Date, Group, Start time, Hared by,
        // Location, Notes — col index 0..6). Wire startTime to col 3 so
        // Munich H3 events surface their actual start (15:00 / 17:00 /
        // 19:00 vary per event). Drop the dead `title: 7` mapping.
        columns: { runNumber: 0, date: 1, hares: 4, location: 5, description: 6, startTime: 3 },
        kennelTagRules: { default: "mh3-de" },
      },
      // Group column has MH3/MFMH3/MASS H3 but Sheets adapter can't route by column — all events tagged MH3
      kennelCodes: ["mh3-de"],
    },
    // Frankfurt (HTML Scraper — JEM archive, 1098 events)
    {
      name: "Frankfurt H3 Hareline",
      url: "https://frankfurt-hash.de/index.php/coming-runs/category/3:next-fh3-run",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        archiveUrl: "https://frankfurt-hash.de/index.php/coming-runs/category/3?id=3&task=archive&filter_reset=1&limit=0",
        kennelPatterns: [
          ["SHITS|Shits", "shits-fra"],
          ["^FM |Full Moon|Frankfurt Full Moon", "ffmh3"],
          ["^DOM Run", "dom-fra"],
          ["Bike Hash|Bike Bash", "bikeh3-fra"],
        ],
        defaultKennelTag: "fh3",
      },
      kennelCodes: ["fh3", "ffmh3", "shits-fra", "dom-fra", "bikeh3-fra"],
    },
    // FFMH3-specific JEM category (#1201) — cat/3 aggregator captures FFMH3
    // historical entries but cat/3 upcoming carries no future FFMH3 events.
    // This dedicated source pulls cat/8 ("next Frankfurt Full Moon Hash
    // re-reloaded") so future FFMH3 runs land as soon as they're posted.
    {
      name: "FFMH3 Hareline",
      url: "https://frankfurt-hash.de/index.php/coming-runs/category/8:next-frankfurt-full-moon-hash-re-reloaded",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        archiveUrl: "https://frankfurt-hash.de/index.php/coming-runs/category/8?id=8&task=archive&filter_reset=1&limit=0",
        kennelPatterns: [],
        defaultKennelTag: "ffmh3",
      },
      kennelCodes: ["ffmh3"],
    },

    // ===== JAPAN =====
    // Tokyo H3 — Harrier Central public API
    {
      name: "Tokyo H3 Harrier Central",
      url: "https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/",
      type: "HARRIER_CENTRAL" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        cityNames: "Tokyo",
        defaultKennelTag: "tokyo-h3",
        // Tokyo H3 enters trail names in HC's eventName field as the
        // neighborhood/station nearest the meeting point — not a real trail
        // name. Substitute the synthesized "Tokyo H3 Trail #N" for the
        // observed placeholder strings. Extend this list when new
        // neighborhood-only titles surface in scrapes. (#1166)
        defaultTitle: "Tokyo H3 Trail",
        staleTitleAliases: [
          "Akabane",
          "Akihabara",
          "Asakusa",
          "Ebisu",
          "Ginza",
          "Ikebukuro",
          "Iidabashi",
          "Kanda",
          "Meguro",
          "Nakameguro",
          "Nishiogikubo",
          "Roppongi",
          "Shibuya",
          "Shimbashi",
          "Shinagawa",
          "Shinjuku",
          "Suidobashi",
          "Takadanobaba",
          "Takadanobanba",
          "Tokyo",
          "Ueno",
          "Yotsuya",
        ],
      },
      kennelCodes: ["tokyo-h3"],
    },
    // KFMH3 — Kinky Fully Mooned Google Calendar (Osaka)
    {
      name: "KFMH3 Google Calendar",
      url: "595aa2ab39c504c22d8636bb4e99590a2ecfc51c4aadb752ad15bc16e6e40dcf@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "595aa2ab39c504c22d8636bb4e99590a2ecfc51c4aadb752ad15bc16e6e40dcf@group.calendar.google.com",
        defaultKennelTag: "kfmh3",
      },
      kennelCodes: ["kfmh3"],
    },
    // Kyoto H3 Google Calendar
    {
      name: "Kyoto H3 Google Calendar",
      url: "8f856affa4ba7fedce78561cd2553a2ee3deb306fcf8319db7b2ca112b468ca5@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "8f856affa4ba7fedce78561cd2553a2ee3deb306fcf8319db7b2ca112b468ca5@group.calendar.google.com",
        defaultKennelTag: "kyoto-h3",
      },
      kennelCodes: ["kyoto-h3"],
    },
    // Osaka H3 Google Calendar
    {
      name: "Osaka H3 Google Calendar",
      url: "7675c3154cb07e0769e722e4d95fd69707353d74941b69be0480fc65c0a97fd1@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "7675c3154cb07e0769e722e4d95fd69707353d74941b69be0480fc65c0a97fd1@group.calendar.google.com",
        defaultKennelTag: "osaka-h3",
      },
      kennelCodes: ["osaka-h3"],
    },
    // F3H3* Website (Tokyo)
    {
      name: "F3H3 Website",
      url: "https://www.f3h3.net/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["f3h3"],
    },
    // Sumo H3 Website (Kanagawa)
    {
      name: "Sumo H3 Website",
      url: "https://sumoh3.gotothehash.net/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["sumo-h3"],
    },
    // Yoko Yoko H3 Website (Yokohama/Yokosuka)
    {
      name: "Yoko Yoko H3 Website",
      url: "https://y2h3.net/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["yoko-yoko-h3"],
    },
    // Hayama 4H Website (Hayama/Zushi)
    {
      name: "Hayama 4H Website",
      url: "https://sites.google.com/site/hayama4h/hashes",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      // Low-change Google Sites page; weekly cadence avoids sharing a browser-render 429 timeslot with New Tokyo Katch.
      scrapeFreq: "weekly",
      scrapeDays: 365,
      kennelCodes: ["hayama-4h"],
    },
    // Samurai H3 Website (Tokyo — Wix + Table Master)
    {
      name: "Samurai H3 Website",
      url: "https://samuraihash2017.wixsite.com/samurai/hare-line",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        browserRender: true,
      },
      kennelCodes: ["samurai-h3"],
    },
    // New Tokyo Katch Website (Tokyo — Wix + Table Master)
    {
      name: "New Tokyo Katch Website",
      url: "https://newtokyohash.wixsite.com/newtokyokatchhash/hareline",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        browserRender: true,
      },
      kennelCodes: ["new-tokyo-katch"],
    },
    // ===== BELGIUM =====
    {
      name: "BMPH3 Google Calendar",
      url: "bmph3.onon@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "bmph3.onon@gmail.com",
        defaultKennelTag: "bmph3-be",
      },
      kennelCodes: ["bmph3-be"],
    },
    {
      name: "Brussels Blue Moon Google Calendar",
      url: "go81bpr3vj0v4n60dnotpkbo3c@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "go81bpr3vj0v4n60dnotpkbo3c@group.calendar.google.com",
        defaultKennelTag: "bbmh3",
      },
      kennelCodes: ["bbmh3"],
    },
    // BruH3 Website (Brussels — upcoming + write-ups)
    {
      name: "BruH3 Website",
      url: "http://www.bruh3.eu/blog/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        writeUpsUrl: "http://www.bruh3.eu/blog-2/",
      },
      kennelCodes: ["bruh3"],
    },

    // ===== NETHERLANDS =====
    {
      name: "Amsterdam H3 Website",
      url: "https://ah3.nl/nextruns/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        previousUrl: "https://ah3.nl/previous/",
      },
      kennelCodes: ["ah3-nl"],
    },
    {
      name: "The Hague H3 Website",
      url: "https://haguehash.nl/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["hagueh3"],
    },

    // ===== DENMARK =====
    {
      name: "Copenhagen H3 Google Calendar",
      url: "ch3.archive@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "ch3.archive@gmail.com",
        kennelPatterns: [
          ["^CH3\\b|Copenhagen", "ch3-dk"],
          ["^CH4\\b|Howling|Full Moon", "ch4-dk"],
          ["RDH3|Rabid", "rdh3"],
        ],
        defaultKennelTag: "ch3-dk",
        // Hares embedded in title — two formats coexist on this calendar:
        // 1. RDH3: "RDH3 134 Walkers. Hare: Lust Jucie" — period + label.
        // 2. CH3:  "CH3 2730 - Nørreport St - Mr Petit" — third dash segment
        //    is the hare (#1209/#1221). The kennel slug `^CH3\b` constraint
        //    keeps this pattern from misfiring on CH4/RDH3 titles.
        // Patterns fire only when description has no hares. The first
        // capture-group hit wins.
        titleHarePattern: [
          String.raw`[.]\s*Hare:\s*(.+)$`,
          String.raw`^CH3\s+\d+\s+-\s+[^-]+\s+-\s+(.+)$`,
        ],
      },
      kennelCodes: ["ch3-dk", "ch4-dk", "rdh3"],
    },
    {
      // Enrichment source: trustLevel 6 (below the GCal feed at 7) so this
      // scraper only fills NULL fields (location, hares, startTime) on events
      // the calendar source already created. Avoids overwriting calendar
      // titles/descriptions with the runsheet's generic "Full Moon Hash"
      // notes. See merge.ts L1110+ for the enrichment path.
      name: "Copenhagen Howling H3 Runsheet",
      url: "https://ch4.dk/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["ch4-dk"],
    },

    // ===== SWEDEN =====
    {
      name: "Stockholm HHH iCal Feed",
      url: "https://www.hash.se/calendar.ics",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["SUH3", "suh3"],
          ["SAH3", "sah3-se"],
        ],
        defaultKennelTag: "suh3",
      },
      kennelCodes: ["suh3", "sah3-se"],
    },

    // ===== LOUISIANA =====
    {
      name: "NOH3 Google Calendar",
      url: "nolahash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "nolahash@gmail.com",
        defaultKennelTag: "noh3",
        includeAllDayEvents: true,
      },
      kennelCodes: ["noh3"],
    },
    {
      name: "Voodoo H3 Google Calendar",
      url: "voodoohash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "voodoohash@gmail.com",
        defaultKennelTag: "voodoo-h3",
      },
      kennelCodes: ["voodoo-h3"],
    },

    // ===== TENNESSEE =====
    {
      name: "Memphis H3 Google Calendar",
      url: "memphish3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "memphish3@gmail.com",
        kennelPatterns: [
          ["GyNO", "gynoh3"],
          ["^MH3\\b|Memphis", "mh3-tn"],
        ],
        defaultKennelTag: "mh3-tn",
      },
      kennelCodes: ["mh3-tn", "gynoh3"],
    },
    {
      name: "Bushwhackers H3 Google Calendar",
      url: "bushwhackersh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "bushwhackersh3@gmail.com",
        defaultKennelTag: "bushwhackersh3",
      },
      kennelCodes: ["bushwhackersh3"],
    },
    {
      ...icalBaseChooChoo,
      // Issue #966: HTML scraper missed 3 of 16 published events. The site
      // is a WordPress install with The Events Calendar plugin, which exposes
      // a clean iCal feed at /events/?ical=1. Renamed source so the seed
      // identity (name, type) is distinct from the legacy HTML_SCRAPER row;
      // ops should disable the old row post-merge (or set
      // SEED_RECONCILE_DISABLE=true on next deploy).
      name: "Choo-Choo H3 iCal Feed",
      url: "https://choochooh3.com/events/?ical=1",
      kennelCodes: ["choochooh3"],
    },

    // ===== WEST VIRGINIA =====
    {
      name: "Morgantown H3 Google Calendar",
      url: "morgantownh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "morgantownh3@gmail.com",
        defaultKennelTag: "mh3-wv",
      },
      kennelCodes: ["mh3-wv"],
    },
    {
      name: "Morgantown H3 Harrier Central",
      url: "https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/",
      type: "HARRIER_CENTRAL" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelUniqueShortName: "MH3-US",
        defaultKennelTag: "mh3-wv",
      },
      kennelCodes: ["mh3-wv"],
    },

    // ===== ARKANSAS =====
    // Little Rock H3 — historic kennel (3rd US kennel, founded 1974), FB-only for
    // weekly trails. Shipped via STATIC_SCHEDULE per the historic-kennel exception
    // in feedback_sourceless_kennels memory. Description fields link to their FB
    // page so users can check the actual trail location day-of.
    //
    // The two records below share the same Facebook page but are kept as
    // separate seed rows by their distinct `name` values — the seed upsert
    // identity is `(name, type)` per `prisma/schema.prisma:221` and
    // `prisma/seed.ts:364`. The `#sunday` / `#wednesday` URL fragments are
    // only for human readability; identical names with different URLs would
    // collapse to a single row on seed.
    {
      name: "Little Rock H3 Static Schedule (Sunday)",
      url: "https://www.facebook.com/littlerockhashhouseharriers#sunday",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "lrh3",
        rrule: "FREQ=WEEKLY;BYDAY=SU",
        startTime: "15:00",
        defaultTitle: "Little Rock H3 Sunday Run",
        defaultLocation: "Little Rock, AR",
        defaultDescription: "Weekly Sunday afternoon trail, ~3-4 PM. Trail location is posted on the Little Rock H3 Facebook page (https://www.facebook.com/littlerockhashhouseharriers) the day of each run, or call the hotline 501-666-HASH at noon on Sundays.",
      },
      kennelCodes: ["lrh3"],
    },
    {
      name: "Little Rock H3 Static Schedule (Wednesday)",
      url: "https://www.facebook.com/littlerockhashhouseharriers#wednesday",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "lrh3",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        startTime: "19:00",
        defaultTitle: "Little Rock H3 Wednesday Run",
        defaultLocation: "Little Rock, AR",
        defaultDescription: "Weekly Wednesday evening trail, 7 PM. Trail location is posted on the Little Rock H3 Facebook page (https://www.facebook.com/littlerockhashhouseharriers) the day of each run.",
      },
      kennelCodes: ["lrh3"],
    },

    // ===== SINGAPORE =====
    // Singapore is the second-oldest hash scene in the world (after Mother Hash KL).
    // Five active kennels shipped here across four source patterns.

    // 1. Singapore Sunday H3 — Harrier Central (zero new code)
    {
      name: "Singapore Sunday H3 Harrier Central",
      url: "https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/",
      type: "HARRIER_CENTRAL" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelUniqueShortName: "SH3-SG",
        defaultKennelTag: "sh3-sg",
      },
      kennelCodes: ["sh3-sg"],
    },

    // 2. Lion City H3 — WordPress posts (custom adapter, reuses fetchWordPressPosts)
    {
      name: "Lion City H3 Website",
      url: "https://lioncityhhh.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["lch3"],
    },

    // 3. Kampong H3 — simple HTML "Next Run" block scraper
    {
      name: "Kampong H3 Website",
      url: "https://kampong.hash.org.sg",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["kampong-h3"],
    },

    // 4. HHHS (Father Hash) — STATIC_SCHEDULE under historic-kennel exception
    // (per feedback_sourceless_kennels memory). Founded 1962, the 2nd hash kennel
    // in the world ever. The Wix hareline iframe is richer but out of scope for
    // this PR; STATIC_SCHEDULE covers the weekly Monday recurrence.
    {
      name: "HHHS Father Hash Static Schedule",
      url: "https://www.hhhs.org.sg/hareline",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "hhhs",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        startTime: "18:00",
        defaultTitle: "HHHS Monday Run",
        defaultLocation: "Singapore",
        defaultDescription: "Weekly Monday evening run for the Father Hash (founded 1962, the 2nd hash kennel in the world). Run number, hares, and exact location are published on the HHHS hareline at https://www.hhhs.org.sg/hareline. Men only.",
      },
      kennelCodes: ["hhhs"],
    },

    // 5. Singapore Hash House Harriets — STATIC_SCHEDULE under historic-kennel
    // exception. Founded 1973, oldest women's hash in Asia. Website
    // (singaporeharriets.com) is DNS-dead; the public 374-member FB group is
    // their actual coordination channel.
    {
      name: "Singapore Harriets Static Schedule",
      url: "https://www.facebook.com/groups/49667691372/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "sgharriets",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        startTime: "18:00",
        defaultTitle: "Singapore Harriets Wednesday Run",
        defaultLocation: "Singapore",
        defaultDescription: "Weekly Wednesday evening run for Singapore Hash House Harriets (founded 1973, oldest women's hash in Asia). Trail location is posted in the public Facebook group (https://www.facebook.com/groups/49667691372/) the day of each run. Mixed welcome.",
      },
      kennelCodes: ["sgharriets"],
    },

    // 6. Hash House Horrors — children's hash, WordPress.com Public API hareline page
    {
      name: "Hash House Horrors Hareline",
      url: "https://hashhousehorrors.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["hhhorrors"],
    },

    // ===== MALAYSIA (Phase 1 — KL + Penang founder pack) =====
    // Malaysia is the birthplace of hashing. Mother Hash (1938) is the first
    // hash kennel in the world, 24 years older than HHHS. Seven kennels
    // shipped here across six adapters (Yii + goHash are shared).
    // KL Harriettes was researched but the Strapi API requires auth — defer
    // to Phase 2 when the kennel can expose a public feed.

    // 1. Mother Hash (Kuala Lumpur H3) — Google Sites static HTML, 2 runs visible
    {
      name: "Mother Hash (KL H3) Website",
      url: "https://www.motherhash.org",
      type: "HTML_SCRAPER" as const,
      trustLevel: 9,
      scrapeFreq: "daily",
      // Only 2 upcoming runs shown; use a generous window so both always land.
      scrapeDays: 180,
      kennelCodes: ["motherh3"],
    },

    // 2. Petaling H3 — Yii Framework hareline, 1,160+ runs back to 2003
    {
      name: "Petaling H3 Hareline",
      url: "https://ph3.org/index.php?r=site/hareline",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelTag: "ph3-my",
        startTime: "16:00",
      },
      kennelCodes: ["ph3-my"],
    },

    // 3. KL Full Moon H3 — Yii Framework hareline (same shape as PH3)
    {
      name: "KL Full Moon H3 Hareline",
      url: "https://klfullmoonhash.com/index.php?r=site/hareline",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelTag: "klfmh3",
        startTime: "18:00",
      },
      kennelCodes: ["klfmh3"],
    },

    // 4. KL Junior H3 — self-hosted WordPress REST API
    {
      name: "KL Junior H3 Website",
      url: "https://www.kljhhh.org",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["kljhhh"],
    },

    // 5. Penang H3 — goHash.app SSR with __INITIAL_STATE__
    {
      name: "Penang H3 Hareline",
      url: "https://www.penanghash3.org",
      type: "HTML_SCRAPER" as const,
      trustLevel: 9,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelTag: "penangh3",
        startTime: "17:30",
        harelinePath: "/hareline/upcoming",
      },
      kennelCodes: ["penangh3"],
    },

    // 6. Hash House Harriets Penang — shared goHash adapter
    {
      name: "Hash House Harriets Penang Hareline",
      url: "https://www.hashhouseharrietspenang.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 9,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelTag: "hhhpenang",
        startTime: "17:30",
        harelinePath: "/hareline/upcoming",
      },
      kennelCodes: ["hhhpenang"],
    },

    // 7. Kelana Jaya Harimau H3 — Blogger/Blogspot with Run#:NNNN title filter
    {
      name: "KJ Harimau H3 Blog",
      url: "https://khhhkj.blogspot.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      kennelCodes: ["kj-harimau"],
    },

    // 7. Seletar H3 — PWA backend JSON API at HashController.php.
    // The url is the actual fetch target (the PHP endpoint), not the PWA
    // homepage, so logs/errors/audits and the adapter all agree on the URL.
    {
      name: "Seletar H3 PWA",
      url: "https://sh3app.hash.org.sg/php/util/HashController.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["seletar-h3"],
    },

    // ===== MISSOURI =====

    // ===== KANSAS =====
    {
      name: "Tornado Alley H3 Google Calendar",
      url: "tornadoalleyhashers@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "tornadoalleyhashers@gmail.com",
        defaultKennelTag: "tah3",
      },
      kennelCodes: ["tah3"],
    },

    // --- Lawrence ---
    {
      name: "Larryville H3 Google Calendar",
      url: "larryvilleh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "lh3-ks",
        // Drop KCH3 events that leak into this calendar. KCH3 has its own
        // source via HashRego (trust 8). Anchored so joint titles stay put.
        // Closes #608.
        skipPatterns: ["^KCH3\\b"],
      },
      kennelCodes: ["lh3-ks"],
    },

    // ===== NORWAY =====
    {
      name: "Oslo H3 iCal Feed",
      url: "https://www.oh3.no/calendar.ics",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "oh3-no",
      },
      kennelCodes: ["oh3-no"],
    },

    // ===== MISSOURI =====
    // --- Kansas City ---
    {
      name: "Kansas City H3 Website",
      url: "https://kansascityh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["kch3", "pnh3"],
    },
    // --- St. Louis ---
    {
      name: "Big Hump H3 Hareline",
      url: "http://www.big-hump.com/hareline.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { includeHistory: true },
      kennelCodes: ["bh4"],
    },
    {
      name: "STL H3 Substack",
      url: "https://www.stlh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["stlh3"],
    },

    // ===== WISCONSIN =====
    // --- Madison ---
    {
      name: "Madison H3 Google Calendar",
      url: "q206h4gbp4cfg5m13ip95vch88@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "q206h4gbp4cfg5m13ip95vch88@group.calendar.google.com",
        defaultKennelTag: "madisonh3",
      },
      kennelCodes: ["madisonh3"],
    },
    // --- Milwaukee ---
    {
      name: "Brew City H3 Website",
      url: "https://www.brewcityh3.com/calendar",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["bch3"],
    },

    // ===== CANADA =====
    // --- Montreal ---
    {
      name: "Montreal H3 Meetup",
      url: "https://www.meetup.com/montreal-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        groupUrlname: "montreal-hash-house-harriers",
        kennelTag: "mh3-ca",
      },
      kennelCodes: ["mh3-ca"],
    },
    // --- Toronto ---
    {
      name: "Hogtown H3 Meetup",
      url: "https://www.meetup.com/meetup-group-pyrddkbc/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        groupUrlname: "meetup-group-pyrddkbc",
        kennelTag: "hogtownh3",
      },
      kennelCodes: ["hogtownh3"],
    },
    // --- Edmonton: EH3 multi-kennel (7 kennels) ---
    {
      name: "EH3 Edmonton Area Harelines",
      url: "https://www.eh3.org/wp-json/wp/v2/pages/437",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        pageIds: {
          "423": { kennelTag: "eh3-ab", defaultStartTime: "18:30" },
          "425": { kennelTag: "osh3-ab", defaultStartTime: "14:00" },
          "429": { kennelTag: "efmh3", defaultStartTime: "19:00" },
          "431": { kennelTag: "bash-eh3", defaultStartTime: "18:30" },
          "433": { kennelTag: "snash-eh3", defaultStartTime: "18:30" },
          "437": { kennelTag: "divah3-eh3", defaultStartTime: "19:00" },
          "439": { kennelTag: "rash-eh3", defaultStartTime: "13:00" },
        },
      },
      kennelCodes: ["eh3-ab", "osh3-ab", "efmh3", "bash-eh3", "snash-eh3", "divah3-eh3", "rash-eh3"],
    },
    // --- Edmonton: True Trail H3 ---
    {
      name: "True Trail H3 Hareline",
      url: "https://truetrailh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["tth3-ab"],
    },
    // --- Edmonton: Saintly H3 ---
    {
      name: "Saintly H3 Static Schedule",
      url: "https://www.facebook.com/groups/444202485756219/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      config: {
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        kennelTag: "saintlyh3",
        defaultTitle: "Saintly H3 Weekly Walk",
        startTime: "18:30",
        defaultLocation: "St. Albert, AB — check Facebook group",
      },
      kennelCodes: ["saintlyh3"],
    },
    // --- Ottawa: OH3 ---
    {
      name: "OH3 Ottawa Receding Hare Line",
      url: "https://docs.google.com/document/d/1jGyBUKxOYkxrZg8WVfpBYDP84fbacanoX_TJuyCmtAI/pub",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["oh3-ca"],
    },
    // --- Calgary: CH3 Upcoming Runs ---
    {
      name: "Calgary H3 Upcoming Runs",
      url: "https://home.onon.org/upcumming-runs",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["ch3-ab"],
    },
    // --- Calgary: CH3 Scribe ---
    {
      name: "Calgary H3 Scribe",
      url: "https://scribe.onon.org/",
      type: "HTML_SCRAPER" as const,
      // Trust 7 (below the Home adapter's 8): the merge pipeline's null-field
      // enrichment path lets the Scribe fill description + hares on canonical
      // events created by the Home adapter without being able to overwrite
      // the Home's title, location, or other non-null fields. Closes #585.
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["ch3-ab"],
    },

    // ===== NEW MEXICO =====
    {
      name: "ABQ H3 Google Calendar",
      url: "j19gg5vekabk94i8sn3pe892gk@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "j19gg5vekabk94i8sn3pe892gk@group.calendar.google.com",
        defaultKennelTag: "abqh3",
        // ABQ enters their Tuesday "CLiT" events as all-day calendar entries,
        // not as 6pm timed events. Opt into all-day ingestion AND set a
        // defaultStartTime so those events render as 6pm runs instead of
        // all-day/noon blocks. Saturday + Full Moon Wed events already carry
        // a proper `dateTime` and bypass this fallback. See #536.
        includeAllDayEvents: true,
        defaultStartTime: "18:00",
      },
      kennelCodes: ["abqh3"],
    },

    // ===== ALABAMA =====
    {
      name: "Mutha Rucker H3 Google Calendar",
      url: "mutharuckerh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "mutharuckerh3@gmail.com",
        defaultKennelTag: "mrh3",
      },
      kennelCodes: ["mrh3"],
    },
    {
      name: "Gulf Coast H3 Google Calendar",
      url: "gch3hash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "gch3hash@gmail.com",
        defaultKennelTag: "gch3",
      },
      kennelCodes: ["gch3"],
    },

    // ===== INDIANA =====
    {
      name: "Blooming Fools H3 Website",
      url: "https://bfh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["bfh3"],
    },
    // IndyScent's Upcumming Hashes page aggregates both IndyScent and THICC
    // events. Route titles containing "THICC" to thicch3; everything else
    // defaults to indyh3.
    {
      name: "IndyScent H3 Upcumming Hashes",
      url: "https://indyhhh.com/upcumming-hashes/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        baseUrl: "https://indyhhh.com",
        pageId: 1792,
        defaultKennelTag: "indyh3",
        kennelPatterns: [
          ["THICC", "thicch3"],
        ],
      },
      kennelCodes: ["indyh3", "thicch3"],
    },

    // ===== MAINE =====
    // Aggregator calendar for both Portland, ME kennels. Events titled
    // "Knightvillain"/"KV" route to knightvillian; everything else defaults to pormeh3.
    {
      name: "PorMe H3 Google Calendar",
      url: "pormeh3hashcash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        calendarId: "pormeh3hashcash@gmail.com",
        defaultKennelTag: "pormeh3",
        kennelPatterns: [
          // Handles both spellings: correct "Knightvillian" (ian) and common misspelling "Knightvillain" (ain)
          ["Knightvill(ian|ain)", "knightvillian"],
          // Matches "KV", "KV484", "KV 478" but NOT "KVR", "Kevin", etc.
          // (\bKV not followed by another letter)
          ["\\bKV(?![A-Za-z])", "knightvillian"],
        ],
      },
      kennelCodes: ["pormeh3", "knightvillian"],
    },

    // ─── Australia Phase 1a: Perth + Darwin + Canberra (zero new code) ───

    // 1. Perth H3 — WordPress + The Events Calendar (Tribe) plugin.
    // Tribe exposes iCal at /?post_type=tribe_events&ical=1&eventDisplay=list.
    // Feed has 30+ VEVENTs with structured SUMMARY "Run NNNN - Hare".
    {
      name: "Perth H3 Hareline",
      url: "https://www.perthhash.com/?post_type=tribe_events&ical=1&eventDisplay=list",
      type: "ICAL_FEED" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "perth-h3",
      },
      kennelCodes: ["perth-h3"],
    },

    // 2. Top End Hash (Darwin) — WordPress + Events Manager plugin.
    // Events Manager exposes iCal at /?post_type=event&ical=1&limit=50.
    // Feed mixes past + future events; the iCal adapter window-filters.
    {
      name: "Top End Hash Hareline",
      url: "https://topendhash.com/?post_type=event&ical=1&limit=50",
      type: "ICAL_FEED" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "top-end-h3",
      },
      kennelCodes: ["top-end-h3"],
    },

    // 3. Capital Hash (Canberra) — Google Calendar embed on the Joomla
    // homepage at capitalhash.com. The iframe src= param is
    // base64-encoded; decoded ID verified via Chrome in round-2. The
    // GOOGLE_CALENDAR adapter reads the calendar ID from `url`, NOT
    // from `config.calendarId`.
    {
      name: "Capital Hash Calendar",
      url: "i5joq71itadqf41njhm1iv0vec@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "capital-h3-au",
        // Capital H3 packs hares + address into the title with no item.location:
        // "Kwine & Mitzi 68 Macleay Street Turner." → hares "Kwine & Mitzi",
        // location "68 Macleay Street Turner" (#1222). The hare pattern stops
        // at the first run of digits (street number); the location pattern
        // captures from that digit run to end-of-string.
        titleHarePattern: String.raw`^(.+?)\s+\d+\s+[A-Z]`,
        titleLocationPattern: String.raw`(\d+\s+.+?)\.?\s*$`,
      },
      kennelCodes: ["capital-h3-au"],
    },

    // ─── Australia Phase 1b: Sydney + Adelaide + Gold Coast ───
    {
      name: "Sydney H3 Hareline",
      url: "https://www.sh3.link/?page_id=9470",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        upcomingOnly: true,
      },
      kennelCodes: ["sh3-au"],
    },
    {
      name: "Adelaide H3 admin-ajax",
      url: "https://ah3.com.au/wp-admin/admin-ajax.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      kennelCodes: ["ah3-au"],
    },
    {
      name: "Gold Coast H3 Hareline",
      url: "https://www.goldcoasthash.org/hareline/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      // TablePress hareline strips past rows automatically (see comment in
      // src/adapters/html-scraper/gold-coast-h3.ts:14-16). Without
      // upcomingOnly, the reconcile step cancels live past events the
      // moment they age out of the future-only table. (#1229)
      config: { upcomingOnly: true },
      kennelCodes: ["gch3-au"],
    },
    {
      name: "Sydney Larrikins Upcoming Runs",
      url: "https://sydney.larrikins.org/sydney-south-habour-hhh-tuesday-beers/upcoming-larrikin-runs/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      kennelCodes: ["larrikins-au"],
    },
    {
      name: "Sydney Thirsty H3 Upcoming Runs",
      url: "https://www.sth3.org/upcoming-runs",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      kennelCodes: ["sth3-au"],
    },

    // ===== AUSTRALIA — Victoria =====
    // Melbourne New Moon H3 — Meetup source (existing adapter handles it)
    {
      name: "Melbourne New Moon Meetup",
      url: "https://www.meetup.com/melbourne-new-moon-running-group/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        groupUrlname: "melbourne-new-moon-running-group",
        kennelTag: "mel-new-moon",
      },
      kennelCodes: ["mel-new-moon"],
    },

    // ===== MALAYSIA Phase 2 — Historic Regional STATIC_SCHEDULE kennels =====
    // Six historically significant Malaysian kennels (1960s-1970s founding dates)
    // verified active per the malaysiahash.com directory but with zero scrapeable
    // web sources (Facebook/phone-only). Historic-kennel STATIC_SCHEDULE exception
    // applies per feedback_sourceless_kennels memory.
    {
      name: "Kuching H3 Static Schedule",
      url: "https://www.malaysiahash.com/#kuching",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "kuching-h3",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        startTime: "17:00",
        defaultTitle: "Kuching H3 Weekly Run",
        defaultLocation: "Kuching, Sarawak, Malaysia",
        defaultDescription: "Weekly Saturday evening trail. Founded 1963, one of Malaysia's oldest hash kennels. Check the malaysiahash.com directory for contact details.",
      },
      kennelCodes: ["kuching-h3"],
    },
    {
      name: "KK H3 Static Schedule",
      url: "https://www.malaysiahash.com/#kota-kinabalu",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "kk-h3",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        startTime: "17:00",
        defaultTitle: "KK H3 Weekly Run",
        defaultLocation: "Kota Kinabalu, Sabah, Malaysia",
        defaultDescription: "Weekly Saturday evening trail. Founded 1964, one of Sabah's earliest hash kennels. Check the malaysiahash.com directory for contact details.",
      },
      kennelCodes: ["kk-h3"],
    },
    {
      name: "Ipoh H3 Static Schedule",
      url: "https://www.malaysiahash.com/#ipoh",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "ipoh-h3",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        startTime: "17:00",
        defaultTitle: "Ipoh H3 Weekly Run",
        defaultLocation: "Ipoh, Perak, Malaysia",
        defaultDescription: "Weekly Saturday evening trail. Founded 1965, one of Malaysia's oldest hash kennels. Check the malaysiahash.com directory for contact details.",
      },
      kennelCodes: ["ipoh-h3"],
    },
    {
      name: "JB H3 Static Schedule",
      url: "https://www.facebook.com/tjbhhh",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "jb-h3",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        startTime: "17:00",
        defaultTitle: "JB H3 Weekly Run",
        defaultLocation: "Johor Bahru, Johor, Malaysia",
        defaultDescription: "Weekly Saturday evening trail. Founded 1969, the oldest hash kennel in Johor. See Facebook page at facebook.com/tjbhhh for trail details.",
      },
      kennelCodes: ["jb-h3"],
    },
    {
      name: "Butterworth H3 Static Schedule",
      url: "https://www.malaysiahash.com/#butterworth",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      // malaysiahash.com directory: Wednesdays @ 6:00pm. The earlier Saturday
      // 17:00 was a data-entry mistake (likely confused with Butterworth
      // Hashettes/Hazards, both Mondays).
      config: {
        kennelTag: "butterworth-h3",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        startTime: "18:00",
        defaultTitle: "Butterworth H3 Weekly Hash",
        defaultLocation: "Butterworth, Penang, Malaysia",
        defaultDescription: "Weekly Wednesday evening trail on mainland Penang. Founded 1980. Check the malaysiahash.com directory for contact details.",
      },
      kennelCodes: ["butterworth-h3"],
    },
    {
      name: "Kluang H3 Static Schedule",
      url: "https://www.malaysiahash.com/#kluang",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "kluang-h3",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        startTime: "17:00",
        defaultTitle: "Kluang H3 Weekly Run",
        defaultLocation: "Kluang, Johor, Malaysia",
        defaultDescription: "Weekly Saturday evening trail. Founded 1967, one of Malaysia's oldest hash kennels. Check the malaysiahash.com directory for contact details.",
      },
      kennelCodes: ["kluang-h3"],
    },
    // ===== HONG KONG =====
    // --- HK H3 / H4 (homepage scraper — Next H4 Run block) ---
    // The 1970 founder kennel. The dedicated Hareline page (?page_id=44)
    // returns 404 and the WordPress REST API is iThemes-locked (401), so the
    // adapter scrapes the homepage's "Next H4 Run" block (run #, location,
    // map URL, format) and emits a single RawEvent for next Monday. The
    // STATIC_SCHEDULE source below provides multi-week visibility — merge
    // pipeline trust ordering lets homepage detail overwrite the template.
    {
      name: "HK H3 Homepage",
      url: "https://hkhash.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 30,
      kennelCodes: ["hkh3"],
    },
    // --- HK H3 (STATIC_SCHEDULE — recurring slot for advance visibility) ---
    staticScheduleSource({
      name: "HK H3 Static Schedule",
      url: "https://hkhash.com/",
      kennelTag: "hkh3",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      startTime: "18:00",
      defaultTitle: "HK H3 Weekly Run",
      defaultLocation: "Hong Kong",
      defaultDescription: "Weekly Monday evening trail (men only). Run number, hare, and exact location are posted on https://hkhash.com/ ahead of each Monday.",
    }),
    // --- N2TH3 (WordPress.com Public API — day-of detail) ---
    // Posts are run announcements published ~1 day before each run, so this
    // source provides rich detail (hare, location, map URL) but no future
    // visibility. Pair it with the STATIC_SCHEDULE source below to keep
    // upcoming runs on the hareline.
    {
      name: "N2TH3 WordPress Blog",
      url: "https://n2th3.org",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["n2th3"],
    },
    // --- N2TH3 (STATIC_SCHEDULE — recurring slot for advance visibility) ---
    staticScheduleSource({
      name: "N2TH3 Static Schedule",
      url: "https://n2th3.org",
      kennelTag: "n2th3",
      rrule: "FREQ=WEEKLY;BYDAY=WE",
      startTime: "19:00",
      defaultTitle: "N2TH3 Weekly Run",
      defaultLocation: "Hong Kong New Territories",
      defaultDescription: "Weekly Wednesday evening trail in Hong Kong's Northern New Territories. Trail location, hare, and on-on details are posted ~1 day before each run at https://n2th3.org/.",
    }),
    // --- RS2H3 (Google Sheets) ---
    {
      name: "RS2H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1ActKq1DoLoUA2WfUM7Q4JF3SASG7SEG-lGjy4byIf_Q",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "1ActKq1DoLoUA2WfUM7Q4JF3SASG7SEG-lGjy4byIf_Q",
        gid: 425141890,
        columns: { date: 0, runNumber: 1, hares: 2, description: 3 },
        kennelTagRules: { default: "rs2h3" },
      },
      kennelCodes: ["rs2h3"],
    },
    // --- Wanchai H3 (Google Sheets) ---
    {
      name: "Wanchai H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/11XWd6UBa0bX176z6AvvnCiduhnlkFmvgzgmn57qOB2Q",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "11XWd6UBa0bX176z6AvvnCiduhnlkFmvgzgmn57qOB2Q",
        gid: 81026820,
        columns: { runNumber: 2, date: 4, hares: 5, location: 6, description: 8 },
        kennelTagRules: { default: "wanchai-h3" },
        startTimeRules: { default: "18:30" },
      },
      kennelCodes: ["wanchai-h3"],
    },
    // --- Sek Kong H3 (Google Sheets) ---
    {
      name: "Sek Kong H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1x2bYuq0S68oBbxynEfuiXqdeyCX_GqJ6upudlqNLrvg",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "1x2bYuq0S68oBbxynEfuiXqdeyCX_GqJ6upudlqNLrvg",
        gid: 1625878211,
        columns: { runNumber: 0, date: 2, hares: 3, location: 4, description: 5 },
        kennelTagRules: { default: "sekkong-h3" },
      },
      kennelCodes: ["sekkong-h3"],
    },
    // --- LSW (HTML table scraper) ---
    {
      name: "LSW Hareline",
      url: "https://www.datadesignfactory.com/lsw/hareline.htm",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["lsw-h3"],
    },
    // --- Ladies H4 (Wix browser-render via Table Master iframe) ---
    // The hareline lives inside a Wix "Table Master" widget at the
    // comp-jvuzl97c iframe — top-level page has zero <table> elements.
    // Adapter targets the iframe via NAS browser-render's frameUrl path
    // (same pattern as samuraihash2017 / newtokyohash). Live-verified
    // 18 upcoming events (#2864–#2881).
    {
      name: "Ladies H4 Hareline",
      url: "https://hkladiesh4.wixsite.com/hklh4/hareline",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["lh4-hk"],
    },
    // --- Kowloon H3 (Google Sheets — published KH3Hareline) ---
    // Upgraded from STATIC_SCHEDULE: kowloonhash.com redirects to a published
    // Google Sheet with weekly run details (run #, hares, location, headline).
    // Layout: row 0/1 are notes, row 2 is the header, data rows expose
    //   col 0: blank/run-tag prefix (e.g. "LH13")
    //   col 1: Date (DD-MMM-YY)
    //   col 2: Run no.
    //   col 3: Hare1
    //   col 4: Hare2 (sometimes blank)
    //   col 5: Scribles (skipped — those are scribes, not hares)
    //   col 6: Headline (often blank, sometimes special-run titles)
    //   col 7: Location
    {
      name: "Kowloon H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRBZeDVCHJWXqLg4n1iL3RIbO2mPE4tZE5KSPe9lzSRUzE6smhcee9LNNT6I3usaKfnvjDRUNWST-OF/pub",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        sheetId: "e/2PACX-1vRBZeDVCHJWXqLg4n1iL3RIbO2mPE4tZE5KSPe9lzSRUzE6smhcee9LNNT6I3usaKfnvjDRUNWST-OF",
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRBZeDVCHJWXqLg4n1iL3RIbO2mPE4tZE5KSPe9lzSRUzE6smhcee9LNNT6I3usaKfnvjDRUNWST-OF/pub?output=csv&gid=1578340354",
        columns: {
          date: 1,
          runNumber: 2,
          hares: 3,
          extraHares: [4],
          location: 7,
          title: 6,
        },
        kennelTagRules: { default: "kowloon-h3" },
        startTimeRules: { default: "18:00" },
      },
      kennelCodes: ["kowloon-h3"],
    },
    // --- HKFH3 (STATIC_SCHEDULE) ---
    {
      name: "HKFH3 Static Schedule",
      url: "https://www.facebook.com/hkfullhousehash",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "hkfh3",
        rrule: "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1",
        startTime: "19:00",
        defaultTitle: "HKFH3 Monthly Run",
        defaultLocation: "Hong Kong",
        defaultDescription: "Monthly Friday evening trail (exact cadence uncertain — at least monthly per available evidence). Check Facebook for run details and start location.",
      },
      kennelCodes: ["hkfh3"],
    },
    // --- Free China H3 (STATIC_SCHEDULE) ---
    {
      name: "Free China H3 Static Schedule",
      url: "https://www.facebook.com/groups/freechinah3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "fch3-hk",
        rrule: "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1",
        startTime: "13:00",
        defaultTitle: "Free China H3 Monthly Run",
        defaultLocation: "Jaffe Rd & Fenwick St junction, Wan Chai, Hong Kong",
        defaultDescription: "Monthly Saturday afternoon trail. Founded 1994. Meet at Jaffe Rd & Fenwick St junction. Check Facebook for run details.",
      },
      kennelCodes: ["fch3-hk"],
    },
    // --- Hebe H3 (STATIC_SCHEDULE) ---
    {
      name: "Hebe H3 Static Schedule",
      url: "https://www.facebook.com/hebehash",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "hebe-h3",
        rrule: "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3",
        startTime: "15:00",
        defaultTitle: "Hebe H3 Monthly Run",
        defaultLocation: "Sai Kung, Hong Kong",
        defaultDescription: "Monthly Saturday afternoon trail in the Sai Kung area. Founded 2019. Check Facebook for run details.",
      },
      kennelCodes: ["hebe-h3"],
    },

    // ── Thailand ──
    // --- BSSH3 (Meetup) ---
    {
      name: "BSSH3 Meetup",
      url: "https://www.meetup.com/bangkok-weekend-walk-run-adventure-group/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "bangkok-weekend-walk-run-adventure-group",
        kennelTag: "bssh3",
      },
      kennelCodes: ["bssh3"],
    },
    // --- Cha-Am H3 (WordPress REST API — day-of detail when title carries date) ---
    // Posts announce upcoming biweekly Saturday runs but most titles only
    // contain "Run NNN: <event name>" with no date in title or body. The
    // adapter parses the ~20% of posts whose titles do carry dates (e.g.
    // "Songkran Outstation APR 10 & 11") and rejects the rest. Pair with
    // the STATIC_SCHEDULE source below so the recurring biweekly Saturday
    // slot still shows on the hareline.
    {
      name: "Cha-Am H3 Website",
      url: "https://cah3.net",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {},
      kennelCodes: ["cah3"],
    },
    // --- Cha-Am H3 (STATIC_SCHEDULE — biweekly recurring slot) ---
    // anchorDate is a confirmed CAH3 Saturday (Run #528 published Mon
    // 2026-01-05 → Sat 2026-01-10) so the biweekly RRULE expansion picks
    // the correct week parity. Observed cadence from WP publish dates:
    // Jan 10, Jan 24, Feb 7, Feb 21, Mar 7, Mar 21, Apr 4, Apr 18, ...
    staticScheduleSource({
      name: "Cha-Am H3 Static Schedule",
      url: "https://cah3.net",
      kennelTag: "cah3",
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      anchorDate: "2026-01-10",
      startTime: "16:00",
      defaultTitle: "Cha-Am H3 Biweekly Run",
      defaultLocation: "Hua Hin / Cha-Am, Thailand",
      defaultDescription: "Biweekly Saturday afternoon trail in the Hua Hin / Cha-Am area. Trail location, hare, and exact start time are posted at https://cah3.net/ ahead of each run.",
      extra: { trustLevel: 4 },
    }),
    // --- Chiang Rai H3 (Blogger API) ---
    {
      name: "Chiang Rai H3 Blog",
      url: "https://chiangraihhh.blogspot.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {},
      kennelCodes: ["crh3"],
    },
    // --- Bangkok Harriettes (WordPress.com Public API) ---
    {
      name: "Bangkok Harriettes Blog",
      url: "https://bangkokharriettes.wordpress.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {},
      kennelCodes: ["bkk-harriettes"],
    },
    // --- Bangkok Thursday Hash (Joomla + PHP API) ---
    {
      name: "Bangkok Thursday Hash",
      url: "https://www.bangkokhash.com/thursday/index.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { subSite: "thursday" },
      kennelCodes: ["bth3", "bfmh3"],
    },
    // --- Bangkok Full Moon Hash (Joomla + PHP API) ---
    {
      name: "Bangkok Full Moon Hash",
      url: "https://www.bangkokhash.com/fullmoon/index.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { subSite: "fullmoon" },
      kennelCodes: ["bfmh3"],
    },
    // --- Siam Sunday Hash (Joomla + PHP API) ---
    {
      name: "Siam Sunday Hash",
      url: "https://www.bangkokhash.com/siamsunday/index.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { subSite: "siamsunday" },
      kennelCodes: ["s2h3"],
    },
    // --- Phuket HHH Shared Hareline ---
    {
      name: "Phuket HHH Hareline",
      url: "https://www.phuket-hhh.com/hareline.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {},
      kennelCodes: ["phhh", "phuket-tinmen", "iron-pussy", "phuket-pooying"],
    },
    // --- Chiang Mai CH3 Hareline ---
    {
      name: "Chiang Mai CH3 Hareline",
      url: "http://www.chiangmaihhh.com/ch3-hareline/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { harelineKey: "ch3" },
      kennelCodes: ["ch3-cm"],
    },
    // --- Chiang Mai CGH3 Hareline ---
    {
      name: "Chiang Mai CGH3 Hareline",
      url: "http://www.chiangmaihhh.com/cgh3-hareline/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { harelineKey: "cgh3" },
      kennelCodes: ["cgh3"],
    },
    // --- Chiang Mai CH4 Hareline ---
    {
      name: "Chiang Mai CH4 Hareline",
      url: "http://www.chiangmaihhh.com/ch4-hareline/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { harelineKey: "ch4" },
      kennelCodes: ["ch4-cm"],
    },
    // --- Chiang Mai CSH3 Hareline ---
    {
      name: "Chiang Mai CSH3 Hareline",
      url: "http://www.chiangmaihhh.com/csh3-hareline/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { harelineKey: "csh3" },
      kennelCodes: ["csh3"],
    },
    // --- Chiang Mai CBH3 Hareline ---
    {
      name: "Chiang Mai CBH3 Hareline",
      url: "http://www.chiangmaihhh.com/cbh3-hareline/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { harelineKey: "cbh3" },
      kennelCodes: ["cbh3-cm"],
    },
    // --- Pattaya H3 Hareline ---
    {
      name: "Pattaya H3 Hareline",
      url: "https://www.pattayah3.com/PH3/php/HareLine/HareLine.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {},
      kennelCodes: ["pattaya-h3"],
    },
    // --- Bangkok H3 (Wix — disabled, needs browser render) ---
    {
      name: "Bangkok H3 Website",
      url: "https://www.bangkokhhh.org",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 90,
      enabled: false,
      config: {},
      kennelCodes: ["bkk-h3"],
    },
    // --- Bangkok Bikers ---
    // DISABLED: adapter fetches /hash_weekends/upcoming but selectors
    // (#next-hash, .hash-weekend, .ride-card) are unverified guesses.
    // Needs live Chrome verification before enabling.
    {
      name: "Bangkok Bikers Website",
      url: "https://www.bangkokbikehash.org",
      type: "HTML_SCRAPER" as const,
      enabled: false,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {},
      kennelCodes: ["bhhb"],
    },

    // ── Nevada + Utah (US gap fill) ──

    // Las Vegas H3 — Tribe Events Calendar REST API at lvh3.org
    // Covers LVH3 + ASS H3 via WordPress category routing
    {
      name: "Las Vegas H3 Events",
      url: "https://lvh3.org",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelPatterns: [["lvhhh", "lv-h3"], ["assh3", "ass-h3"]],
        defaultKennelTag: "lv-h3",
      },
      kennelCodes: ["lv-h3", "ass-h3"],
    },

    // Reno H3 — Google Calendar
    {
      name: "Reno H3 Calendar",
      url: "renoh3misman@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "reno-h3",
      },
      kennelCodes: ["reno-h3"],
    },

    // Whoreman H3 (SLC umbrella) — Google Calendar covers 4 Utah kennels
    {
      name: "Whoreman H3 Calendar",
      url: "4c78e8fc64a9536fa1f839765faf0eb6169e19aaa485fa40cb423795ebdfe7cb@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "every_6h",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["^wasatch", "wasatch-h3"],
          ["^LDS", "lds-h3"],
          ["^SLOSH", "slosh-h3"],
          // Match both "SL, UT" and escaped "SL\\, UT" from Google Calendar
          ["^SL[,\\\\]+\\s*UT", "slut-h3"],
          // Whoreman umbrella events (campouts, RDRs, specials)
          ["^WH3", "wasatch-h3"],
          ["^[Ww]horeman", "wasatch-h3"],
        ],
        // null default — unmatched events are skipped rather than
        // silently misrouted to wasatch-h3
        defaultKennelTag: null,
        // #796: Wasatch titles arrive as bare "wasatch #1144" — substitute a
        // readable trail name when the adapter matches the kennel-code-only
        // pattern. Per-kennel keys so lds/slosh/slut keep pattern routing.
        defaultTitles: {
          "wasatch-h3": "Wasatch H3 Trail",
        },
      },
      kennelCodes: ["wasatch-h3", "lds-h3", "slosh-h3", "slut-h3"],
    },
  ];

