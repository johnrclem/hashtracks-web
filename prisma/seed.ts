import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[()]/g, "")    // Remove parens
    .replace(/\s+/g, "-")    // Spaces to hyphens
    .replace(/-+/g, "-")     // Collapse multiple hyphens
    .replace(/^-|-$/g, "");  // Trim leading/trailing hyphens
}

// Dynamic import of the generated client to handle ESM
async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // ── KENNEL DATA (PRD Section 8 + Appendix D.3) ──

  const kennels: Array<{
    kennelCode: string;
    shortName: string;
    fullName: string;
    region: string;
    country?: string;
    website?: string;
    scheduleDayOfWeek?: string;
    scheduleTime?: string;
    scheduleFrequency?: string;
    scheduleNotes?: string;
    hashCash?: string;
    facebookUrl?: string;
    instagramHandle?: string;
    twitterHandle?: string;
    discordUrl?: string;
    contactEmail?: string;
    foundedYear?: number;
    description?: string;
  }> = [
    // NYC area (hashnyc.com source)
    {
      kennelCode: "nych3", shortName: "NYCH3", fullName: "New York City Hash House Harriers", region: "New York City, NY",
      website: "https://hashnyc.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$8",
      facebookUrl: "https://www.facebook.com/groups/nychash",
    },
    {
      kennelCode: "brh3", shortName: "BrH3", fullName: "Brooklyn Hash House Harriers", region: "New York City, NY",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
    },
    {
      kennelCode: "nah3", shortName: "NAH3", fullName: "New Amsterdam Hash House Harriers", region: "New York City, NY",
      scheduleDayOfWeek: "Saturday", scheduleTime: "3:00 PM", scheduleFrequency: "Biweekly",
    },
    { kennelCode: "knick", shortName: "Knick", fullName: "Knickerbocker Hash House Harriers", region: "New York City, NY" },
    {
      kennelCode: "lil", shortName: "LIL", fullName: "Long Island Lunatics Hash House Harriers", region: "Long Island, NY",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Weekly",
    },
    { kennelCode: "qbk", shortName: "QBK", fullName: "Queens Black Knights Hash House Harriers", region: "New York City, NY" },
    { kennelCode: "si", shortName: "SI", fullName: "Staten Island Hash House Harriers", region: "New York City, NY" },
    { kennelCode: "columbia", shortName: "Columbia", fullName: "Columbia Hash House Harriers", region: "New York City, NY" },
    { kennelCode: "harriettes-nyc", shortName: "Harriettes", fullName: "Harriettes Hash House Harriers", region: "New York City, NY" },
    {
      kennelCode: "ggfm", shortName: "GGFM", fullName: "GGFM Hash House Harriers", region: "New York City, NY",
      scheduleFrequency: "Full Moon",
    },
    { kennelCode: "nawwh3", shortName: "NAWWH3", fullName: "North American Woman Woman Hash", region: "New York City, NY" },
    { kennelCode: "drinking-practice-nyc", shortName: "Drinking Practice (NYC)", fullName: "NYC Drinking Practice", region: "New York City, NY" },
    // Boston area (Google Calendar source)
    {
      kennelCode: "boh3", shortName: "BoH3", fullName: "Boston Hash House Harriers", region: "Boston, MA",
      scheduleDayOfWeek: "Sunday", scheduleTime: "2:30 PM", scheduleFrequency: "Weekly",
    },
    {
      kennelCode: "bobbh3", shortName: "BoBBH3", fullName: "Boston Ballbuster Hardcore Hash House Harriers", region: "Boston, MA",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly",
    },
    { kennelCode: "beantown", shortName: "Beantown", fullName: "Beantown City Hash House Harriers", region: "Boston, MA" },
    {
      kennelCode: "bos-moon", shortName: "Bos Moon", fullName: "Boston Moon Hash House Harriers", region: "Boston, MA",
      scheduleFrequency: "Full Moon",
    },
    { kennelCode: "pink-taco", shortName: "Pink Taco", fullName: "Pink Taco Hash House Harriers", region: "Boston, MA" },
    // New Jersey
    {
      kennelCode: "summit", shortName: "Summit", fullName: "Summit Hash House Harriers", region: "North NJ",
      scheduleDayOfWeek: "Monday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Summer: Mondays 7pm. Winter: Saturdays 3pm.",
    },
    {
      kennelCode: "sfm", shortName: "SFM", fullName: "Summit Full Moon H3", region: "North NJ",
      scheduleFrequency: "Full Moon",
    },
    { kennelCode: "asssh3", shortName: "ASSSH3", fullName: "All Seasons Summit Shiggy H3", region: "North NJ" },
    { kennelCode: "rumson", shortName: "Rumson", fullName: "Rumson Hash House Harriers", region: "New Jersey" },
    // Philadelphia
    {
      kennelCode: "bfm", shortName: "BFM", fullName: "Ben Franklin Mob H3", region: "Philadelphia, PA",
      website: "https://benfranklinmob.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
    },
    {
      kennelCode: "philly-h3", shortName: "Philly H3", fullName: "Philly Hash House Harriers", region: "Philadelphia, PA",
      website: "https://hashphilly.com/nexthash/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
    },
    // Chicago area (Chicagoland Google Calendar aggregator)
    {
      kennelCode: "ch3", shortName: "CH3", fullName: "Chicago Hash House Harriers", region: "Chicago, IL",
      website: "https://chicagohash.org", foundedYear: 1978,
      facebookUrl: "https://www.facebook.com/groups/10638781851/",
      scheduleNotes: "Summer: Mondays 7pm. Winter: Sundays 2pm.",
      description: "Chicago's original kennel (est. 1978). Weekly Sunday afternoon runs (winter) / Monday evening runs (summer).",
    },
    {
      kennelCode: "th3", shortName: "TH3", fullName: "Thirstday Hash House Harriers", region: "Chicago, IL",
      website: "https://chicagoth3.com", foundedYear: 2003,
      scheduleDayOfWeek: "Thursday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Thursday evening hash. 7 PM meet, 7:30 on-out. Urban trails accessible via public transit.",
    },
    {
      kennelCode: "cfmh3", shortName: "CFMH3", fullName: "Chicago Full Moon Hash House Harriers", region: "Chicago, IL",
      website: "https://www.hhhinchicago.com", foundedYear: 1987,
      facebookUrl: "https://www.facebook.com/groups/570636943051356/",
      scheduleFrequency: "Monthly", scheduleNotes: "Evenings near the full moon",
      description: "Monthly hash near the full moon (est. 1987). Day of week varies with the lunar cycle.",
    },
    {
      kennelCode: "fcmh3", shortName: "FCMH3", fullName: "First Crack of the Moon Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/570636943051356/",
      scheduleFrequency: "Monthly", scheduleNotes: "Evenings near the new moon",
      description: "Monthly hash near the new moon. Sister kennel to Chicago Full Moon H3.",
    },
    {
      kennelCode: "bdh3", shortName: "BDH3", fullName: "Big Dogs Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/137255643022023/",
      scheduleFrequency: "Monthly", scheduleNotes: "2nd Saturday afternoon",
      description: "Monthly 2nd Saturday afternoon hash. Off-the-beaten-path trails.",
    },
    {
      kennelCode: "bmh3", shortName: "BMH3", fullName: "Bushman Hash House Harriers", region: "Chicago, IL",
      website: "https://www.hhhinchicago.com",
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Saturday afternoon",
      description: "Monthly 3rd Saturday afternoon hash. All-woods trails in Cook County Forest Preserves.",
    },
    {
      kennelCode: "2ch3", shortName: "2CH3", fullName: "Second City Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/secondcityhhh",
      scheduleFrequency: "Irregular",
      description: "Runs on an as-desired basis. Trails typically further from city center.",
    },
    {
      kennelCode: "wwh3", shortName: "WWH3", fullName: "Whiskey Wednesday Hash House Harriers", region: "Chicago, IL",
      website: "http://www.whiskeywednesdayhash.org",
      facebookUrl: "https://www.facebook.com/groups/wwwhhh",
      scheduleFrequency: "Monthly", scheduleNotes: "Last Wednesday evening, 7:00 PM.",
      hashCash: "Free",
      description: "Monthly last Wednesday evening hash. Free to runners. Features whiskey.",
    },
    {
      kennelCode: "4x2h4", shortName: "4X2H4", fullName: "4x2 Hash House Harriers and Harriettes", region: "Chicago, IL",
      website: "https://www.4x2h4.org",
      facebookUrl: "https://www.facebook.com/groups/833761823403207",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "6:30 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "1st Tuesday. $2 hash cash, 4 miles, 2 beers.", hashCash: "$2",
      description: "Monthly 1st Tuesday evening hash. $2 hash cash, ~4 mile trail, 2 beers, brief circle.",
    },
    {
      kennelCode: "rth3", shortName: "RTH3", fullName: "Ragtime Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/213336255431069/",
      scheduleFrequency: "Irregular", scheduleNotes: "Brunch hash, various Saturdays",
      description: "Brunch hash on various Saturdays, late morning.",
    },
    {
      kennelCode: "dlh3", shortName: "DLH3", fullName: "Duneland Hash House Harriers", region: "South Shore, IN",
      facebookUrl: "https://www.facebook.com/groups/SouthShoreHHH/",
      scheduleFrequency: "Irregular",
      description: "NW Indiana hash considered part of the Chicagoland community. Irregular schedule.",
    },
    // DC / DMV area
    {
      kennelCode: "ewh3", shortName: "EWH3", fullName: "Everyday is Wednesday Hash House Harriers", region: "Washington, DC",
      website: "https://www.ewh3.com", foundedYear: 1999,
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:45 PM", scheduleFrequency: "Weekly",
      discordUrl: "https://tinyurl.com/ewh3discord",
      description: "Weekly Thursday evening hash in DC. One of the largest and most active DC kennels (est. 1999).",
    },
    {
      kennelCode: "shith3", shortName: "SHITH3", fullName: "So Happy It's Tuesday Hash House Harriers", region: "Northern Virginia",
      website: "https://shith3.com", foundedYear: 2002,
      facebookUrl: "https://www.facebook.com/groups/756148277731360/",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Weekly Tuesday evening hash in Northern Virginia / DC Metro. All live trails (est. 2002).",
    },
    {
      kennelCode: "cch3", shortName: "CCH3", fullName: "Charm City Hash House Harriers", region: "Baltimore, MD",
      website: "https://charmcityh3.com",
      facebookUrl: "https://www.facebook.com/CharmCityH3",
      scheduleFrequency: "Biweekly", scheduleNotes: "Alternating Friday 7:00 PM and Saturday afternoons",
      description: "Biweekly hash in Baltimore, alternating Friday evenings and Saturday afternoons.",
    },
    {
      kennelCode: "w3h3", shortName: "W3H3", fullName: "Wild and Wonderful Wednesday Hash House Harriers", region: "Jefferson County, WV",
      website: "https://sites.google.com/view/w3h3",
      facebookUrl: "https://www.facebook.com/groups/273947756839837/",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:09 PM", scheduleFrequency: "Weekly",
      description: "Weekly Wednesday 6:09 PM hash in Jefferson County, West Virginia (Harpers Ferry area).",
    },
    {
      kennelCode: "dch4", shortName: "DCH4", fullName: "DC Harriettes and Harriers Hash House", region: "Washington, DC",
      website: "https://dch4.org", foundedYear: 1978,
      facebookUrl: "https://www.facebook.com/groups/dch4hashhouse",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "2:00 PM daylight, 3:00 PM standard time",
      description: "Weekly Saturday afternoon hash. First co-ed kennel in DC (est. 1978). 2299+ trails.",
    },
    {
      kennelCode: "wh4", shortName: "WH4", fullName: "White House Hash House Harriers", region: "Washington, DC",
      website: "https://whitehousehash.com", foundedYear: 1987,
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly",
      scheduleNotes: "3:00 PM Labor Day–Memorial Day, 5:00 PM Memorial Day–Labor Day",
      description: "Weekly Sunday hash in the DC/NoVA area (est. 1987). 2100+ trails.",
    },
    {
      kennelCode: "bah3", shortName: "BAH3", fullName: "Baltimore Annapolis Hash House Harriers", region: "Baltimore, MD",
      website: "https://www.bah3.org",
      scheduleDayOfWeek: "Sunday", scheduleTime: "3:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Sunday 3 PM hash in the Baltimore/Annapolis area.",
    },
    {
      kennelCode: "mvh3", shortName: "MVH3", fullName: "Mount Vernon Hash House Harriers", region: "Washington, DC",
      website: "http://www.dchashing.org/mvh3/", foundedYear: 1985,
      scheduleDayOfWeek: "Saturday", scheduleTime: "10:00 AM", scheduleFrequency: "Weekly",
      description: "Weekly Saturday 10 AM hash in the DC metro area (est. 1985).",
    },
    {
      kennelCode: "ofh3", shortName: "OFH3", fullName: "Old Frederick Hash House Harriers", region: "Frederick, MD",
      website: "https://www.ofh3.com", foundedYear: 2000,
      scheduleFrequency: "Monthly", scheduleNotes: "2nd Saturday, 10:30 AM sign-in, 11:00 AM hares away",
      description: "Monthly 2nd Saturday hash in Frederick, western Maryland (est. ~2000).",
    },
    {
      kennelCode: "dcfmh3", shortName: "DCFMH3", fullName: "DC Full Moon Hash House Harriers", region: "Washington, DC",
      website: "https://sites.google.com/site/dcfmh3/home",
      scheduleFrequency: "Monthly", scheduleNotes: "Friday/Saturday on or near the full moon",
      contactEmail: "dcfullmoonh3@gmail.com",
      description: "Monthly hash on or near the full moon. Hosted by rotating DC-area kennels.",
    },
    {
      kennelCode: "gfh3", shortName: "GFH3", fullName: "Great Falls Hash House Harriers", region: "Northern Virginia",
      website: "http://www.gfh3.org", foundedYear: 1982,
      scheduleNotes: "Wednesday 7:00 PM (Spring/Summer), Saturday 3:00 PM (Fall/Winter)",
      description: "Seasonal schedule: Wednesday evenings (spring/summer), Saturday afternoons (fall/winter). Est. 1982, 1400+ runs.",
    },
    {
      kennelCode: "dch3", shortName: "DCH3", fullName: "DC Hash House Harriers", region: "Washington, DC",
      foundedYear: 1972,
      scheduleNotes: "Monday 7:00 PM (Summer), Saturday 3:00 PM",
      description: "The original DC kennel (est. 1972). Men only. Monday evenings (summer) and Saturday afternoons.",
    },
    {
      kennelCode: "oth4", shortName: "OTH4", fullName: "Over the Hump Hash House Harriers", region: "Washington, DC",
      facebookUrl: "https://www.facebook.com/share/g/6ZoFa1A5jD7Ukiv9/",
      foundedYear: 1991,
      scheduleFrequency: "Biweekly", scheduleNotes: "Sunday 2:00 PM + Wednesday 7:00 PM",
      description: "Biweekly Sunday 2 PM and Wednesday 7 PM hashes (est. 1991).",
    },
    {
      kennelCode: "smuttycrab", shortName: "SMUTTyCrab", fullName: "SMUTTy Crab Hash House Harriers", region: "Southern Maryland",
      website: "http://smuttycrabh3.com", foundedYear: 2007,
      scheduleFrequency: "Biweekly", scheduleNotes: "Saturday 1:00 PM",
      description: "Biweekly Saturday 1 PM hash in Southern Maryland (est. 2007).",
    },
    {
      kennelCode: "hillbillyh3", shortName: "HillbillyH3", fullName: "Hillbilly Hash House Harriers", region: "Washington, DC",
      website: "https://sites.google.com/site/hillbillyh3/home",
      scheduleFrequency: "Twice monthly", scheduleNotes: "Sunday ~12:00 PM",
      description: "Twice-monthly Sunday hash in the DC metro / western Maryland area.",
    },
    {
      kennelCode: "dcrt", shortName: "DCRT", fullName: "DC Red Tent Harriettes", region: "Washington, DC",
      website: "https://sites.google.com/site/dcredtent/",
      facebookUrl: "https://m.facebook.com/groups/636027323156298/",
      scheduleFrequency: "Monthly", scheduleNotes: "Sunday 10:00 AM. Ladies only.",
      description: "Monthly Sunday 10 AM ladies-only hash in DC.",
    },
    {
      kennelCode: "h4", shortName: "H4", fullName: "Hangover Hash House Harriers", region: "Washington, DC",
      website: "https://hangoverhash.com", foundedYear: 2012,
      scheduleFrequency: "Monthly", scheduleNotes: "Sunday 10:00 AM",
      description: "Monthly Sunday 10 AM hash. Hashing the DC area since 2012.",
    },
    {
      kennelCode: "fuh3", shortName: "FUH3", fullName: "Fredericksburg Urban Hash House Harriers", region: "Fredericksburg, VA",
      website: "https://fuh3.net",
      scheduleFrequency: "Biweekly", scheduleNotes: "Saturday 3:00 PM",
      description: "Biweekly Saturday 3 PM hash in Fredericksburg, VA (~50 miles south of DC).",
    },
    {
      kennelCode: "dcph4", shortName: "DCPH4", fullName: "DC Powder/Pedal/Paddle Hounds", region: "Washington, DC",
      facebookUrl: "https://www.facebook.com/groups/DCPH4/",
      scheduleFrequency: "Quarterly", scheduleNotes: "Multi-sport hash (skiing, biking, paddling)",
      description: "Multi-sport hash (skiing, biking, paddling). Quarterly schedule.",
    },
    // San Francisco Bay Area (sfh3.com MultiHash platform)
    {
      kennelCode: "sfh3", shortName: "SFH3", fullName: "San Francisco Hash House Harriers", region: "San Francisco, CA",
      website: "https://www.sfh3.com", foundedYear: 1982,
      facebookUrl: "https://www.facebook.com/sfhash",
      twitterHandle: "@sfh3",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:15 PM", scheduleFrequency: "Weekly",
      description: "The flagship Bay Area kennel (est. 1982). Weekly Monday evening runs in San Francisco. Hosts the sfh3.com aggregator platform.",
    },
    {
      kennelCode: "gph3", shortName: "GPH3", fullName: "Gypsies in the Palace Hash House Harriers", region: "San Francisco, CA",
      website: "https://www.gypsiesh3.com",
      twitterHandle: "@gypsiesh3",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:15 PM", scheduleFrequency: "Weekly",
      description: "Traditional Thursday night hash in San Francisco. Run #1696+.",
    },
    {
      kennelCode: "ebh3", shortName: "EBH3", fullName: "East Bay Hash House Harriers", region: "Oakland, CA",
      website: "https://www.ebh3.com",
      facebookUrl: "https://www.facebook.com/groups/Ebhhh/",
      scheduleDayOfWeek: "Sunday", scheduleTime: "1:00 PM", scheduleFrequency: "Biweekly",
      hashCash: "$6",
      description: "Biweekly Sunday afternoon runs in the East Bay. Run #1159+.",
    },
    {
      kennelCode: "svh3", shortName: "SVH3", fullName: "Silicone Valley Hash House Harriers", region: "San Jose, CA",
      website: "https://svh3.com",
      facebookUrl: "https://www.facebook.com/SIliconeValleyHash",
      twitterHandle: "@SiliconValleyH3",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      hashCash: "$6",
      description: "Biweekly Saturday afternoon runs from South Bay to mid-peninsula. Run #1266+. Note: deliberate 'Silicone' spelling.",
    },
    {
      kennelCode: "fhac-u", shortName: "FHAC-U", fullName: "FHAC-U Hash House Harriers", region: "San Jose, CA",
      website: "https://svh3.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Alternates Thursdays with Agnews",
      hashCash: "$7",
      description: "Biweekly Thursday evening traditional hash in the South Bay. Shorter trails, more pubs. Alternates with Agnews.",
    },
    {
      kennelCode: "agnews", shortName: "Agnews", fullName: "Agnews State Hash House Harriers", region: "San Jose, CA",
      website: "https://svh3.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Alternates Thursdays with FHAC-U",
      description: "Biweekly Thursday evening hash in the South Bay. Longer trails, more family-friendly. Alternates with FHAC-U. Run #1510+.",
    },
    {
      kennelCode: "barh3", shortName: "BARH3", fullName: "Bay Area Rabble Hash", region: "San Francisco, CA",
      twitterHandle: "@BARH3",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Bar-to-bar live hare hash starting at various BART stations",
      description: "Weekly Wednesday evening bar-to-bar live hare hash. Starts at BART stations across the Bay Area.",
    },
    {
      kennelCode: "marinh3", shortName: "MarinH3", fullName: "Marin Hash House Harriers", region: "Marin County, CA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:00 PM", scheduleFrequency: "Monthly",
      description: "Monthly Saturday afternoon hash in Marin County. Run #290+. No dedicated website.",
    },
    {
      kennelCode: "fch3", shortName: "FCH3", fullName: "Fog City Hash House Harriers", region: "San Francisco, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "LGBTQ-friendly kennel, special events",
      description: "LGBTQ-friendly hash in San Francisco with irregular/monthly events and special weekends.",
    },
    {
      kennelCode: "sffmh3", shortName: "SFFMH3", fullName: "San Francisco Full Moon Hash", region: "San Francisco, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "On the full moon",
      description: "Monthly full-moon hash in San Francisco. Previously known as SF Full Moon Zombies HHH.",
    },
    {
      kennelCode: "vmh3", shortName: "VMH3", fullName: "Vine & Malthouse Hash House Harriers", region: "San Francisco, CA",
      scheduleFrequency: "Irregular",
      description: "Specialty hash in the Bay Area. Occasional events listed on sfh3.com.",
    },
    // London, UK
    {
      kennelCode: "lh3", shortName: "LH3", fullName: "London Hash House Harriers", region: "London", country: "UK",
      website: "https://www.londonhash.org", foundedYear: 1975,
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Summer: sometimes Monday evenings at 7pm",
      instagramHandle: "@london_hash_house_harriers",
    },
    {
      kennelCode: "cityh3", shortName: "CityH3", fullName: "City Hash House Harriers", region: "London", country: "UK",
      website: "https://cityhash.org.uk",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      instagramHandle: "@cityhashhouseharriers",
    },
    {
      kennelCode: "wlh3", shortName: "WLH3", fullName: "West London Hash House Harriers", region: "London", country: "UK",
      website: "https://westlondonhash.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
    },
    {
      kennelCode: "barnesh3", shortName: "BarnesH3", fullName: "Barnes Hash House Harriers", region: "London", country: "UK",
      website: "http://www.barnesh3.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:30 PM", scheduleFrequency: "Weekly",
      hashCash: "£2",
    },
    {
      kennelCode: "och3", shortName: "OCH3", fullName: "Old Coulsdon Hash House Harriers", region: "Surrey", country: "UK",
      website: "http://www.och3.org.uk",
      scheduleFrequency: "Weekly", scheduleNotes: "Alternating Sunday 11 AM and Monday 7:30 PM",
      hashCash: "£2",
    },
    {
      kennelCode: "slh3", shortName: "SLH3", fullName: "SLASH (South London Hash House Harriers)", region: "London", country: "UK",
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "2nd Saturday of the month",
    },
    {
      kennelCode: "fukfm", shortName: "FUKFM", fullName: "First UK Full Moon Hash House Harriers", region: "London", country: "UK",
      website: "https://fukfmh3.co.uk", foundedYear: 1990,
      scheduleFrequency: "Monthly", scheduleNotes: "Every full moon evening, 7:30 PM",
    },
    {
      kennelCode: "eh3", shortName: "EH3", fullName: "Enfield Hash House Harriers", region: "London", country: "UK",
      website: "http://www.enfieldhash.org", foundedYear: 1999,
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Wednesday, 7:30 PM",
    },
  ];

  // ── ALIAS DATA (PRD Appendix D.3) ──

  // Aliases keyed by kennelCode (matches kennelRecords keys)
  const kennelAliases: Record<string, string[]> = {
    "nych3": ["NYC", "HashNYC", "NYC Hash", "NYCH3", "New York Hash", "NYC H3"],
    "boh3": ["Boston", "BH3", "BoH3", "Boston Hash"],
    "brh3": ["Brooklyn", "BrH3", "Brooklyn Hash", "Brooklyn H3"],
    "bobbh3": ["Ballbuster", "BoBBH3", "Boston Ballbuster", "Ballbuster Hash", "B3H4", "Boston Ballbuster Hardcore", "Boston Ballbuster H4"],
    "nawwh3": ["NAWW", "NAWWH3", "NAWW Hash"],
    "nah3": ["New Amsterdam", "NAH3", "NASS", "New Amsterdam Hash"],
    "qbk": ["Queens Black Knights", "QBK", "QBK Hash", "Queens", "Queens Hash"],
    "lil": ["Long Island Lunatics", "LIL", "Long Island", "LI Hash", "Lunatics"],
    "bfm": ["Ben Franklin Mob", "BFM", "BFM H3", "BFMH3"],
    "philly-h3": ["Philly Hash", "Philly H3", "Philadelphia H3", "Philadelphia Hash", "hashphilly"],
    "bos-moon": ["Moon", "Moom", "Boston Moon", "Bos Moon", "Bos Moom", "Boston Moon H3", "Boston Moon Hash"],
    "pink-taco": ["Pink Taco", "Pink Taco Hash", "PT2H3", "Pink Taco Trotters"],
    "beantown": ["Beantown", "Beantown Hash", "Beantown City", "Beantown City H3", "Beantown City Hash"],
    "knick": ["Knick", "Knickerbocker", "Knickerbocker Hash"],
    "columbia": ["Columbia", "Columbia Hash"],
    "ggfm": ["GGFM", "GGFM Hash"],
    "harriettes-nyc": ["Harriettes", "Harriettes Hash", "Harriettes (NYC)", "Harriettes NYC"],
    "si": ["Staten Island", "SI", "SI Hash", "Staten Island Hash"],
    "drinking-practice-nyc": ["Drinking Practice", "NYC Drinking Practice", "NYC DP", "DP"],
    "summit": ["Summit", "Summit H3", "Summit Hash", "SH3"],
    "sfm": ["SFM", "SFM H3", "Summit Full Moon", "Summit Full Moon H3"],
    "asssh3": ["ASSSH3", "ASSS H3", "All Seasons Summit Shiggy"],
    // Chicago area
    "ch3": ["Chicago Hash", "Chicago H3", "CHH3"],
    "th3": ["Thirstday", "Thirstday Hash", "Thirstday H3", "Thursday Hash"],
    "cfmh3": ["Chicago Full Moon", "Chicago Full Moon Hash", "Chicago Moon Hash"],
    "fcmh3": ["First Crack", "First Crack H3", "First Crack of the Moon", "New Moon Hash"],
    "bdh3": ["Big Dogs", "Big Dogs H3", "Big Dogs Hash"],
    "bmh3": ["Bushman", "Bushman H3", "Bushman Hash", "The Greatest Hash"],
    "2ch3": ["Second City", "Second City H3", "Second City Hash"],
    "wwh3": ["Whiskey Wednesday", "Whiskey Wednesday Hash", "WWW H3"],
    "4x2h4": ["4x2 H4", "Four by Two H4", "4x2 Hash", "Four by Two"],
    "rth3": ["Ragtime", "Ragtime Hash", "Brunch Hash"],
    "dlh3": ["Duneland", "Duneland H3", "South Shore HHH"],
    // DC / DMV area
    "ewh3": ["Everyday is Wednesday", "Every Day is Wednesday"],
    "shith3": ["SHIT H3", "S.H.I.T. H3", "So Happy It's Tuesday"],
    "cch3": ["Charm City", "Charm City Hash", "Charm City H3"],
    "w3h3": ["Wild and Wonderful Wednesday"],
    "dch4": ["DC Harriettes", "DC Harriettes and Harriers", "Harriettes and Harriers"],
    "wh4": ["White House Hash", "White House H3", "White House"],
    "bah3": ["Baltimore Annapolis", "Baltimore Annapolis Hash"],
    "mvh3": ["Mount Vernon Hash", "Mount Vernon H3", "Mount Vernon"],
    "ofh3": ["Old Frederick", "Old Frederick Hash"],
    "dcfmh3": ["DC Full Moon", "DC Full Moon Hash"],
    "gfh3": ["Great Falls", "Great Falls Hash"],
    "dch3": ["DC Hash", "DC Hash House Harriers", "the Men's Hash"],
    "oth4": ["Over the Hump"],
    "smuttycrab": ["SMUTTy Crab", "SMUTT", "Smutty Crab H3"],
    "hillbillyh3": ["Hillbilly Hash", "Hillbilly H3"],
    "dcrt": ["DC Red Tent", "Red Tent H3", "Red Tent Harriettes"],
    "h4": ["Hangover Hash", "Hangover H3", "Hangover"],
    "fuh3": ["Fredericksburg Urban Hash", "FXBG H3"],
    "dcph4": ["DC Powder Pedal Paddle"],
    // San Francisco Bay Area
    "sfh3": ["SF Hash", "San Francisco Hash", "San Francisco H3", "SF H3"],
    "gph3": ["Gypsies", "Gypsies H3", "Gypsies in the Palace", "GIP H3", "Gypsies Hash"],
    "ebh3": ["East Bay", "East Bay Hash", "East Bay H3", "EB Hash"],
    "svh3": ["Silicone Valley", "Silicone Valley H3", "Silicon Valley Hash", "SV Hash"],
    "fhac-u": ["FHACU", "FHAC-U H3"],
    "agnews": ["Agnews H3", "Agnews State H3", "Agnews Hash"],
    "barh3": ["Bay Area Rabble", "BAR H3"],
    "marinh3": ["Marin Hash", "Marin H3", "Marin HHH"],
    "fch3": ["Fog City", "Fog City Hash", "Fog City H3"],
    "sffmh3": ["SF Full Moon", "SF Full Moon Hash", "FMH3", "Full Moon H3 (SF)"],
    "vmh3": ["Vine & Malthouse", "Vine and Malthouse H3"],
    // London, UK
    "lh3": ["London Hash", "London H3", "London Hash House Harriers"],
    "cityh3": ["City Hash", "City H3"],
    "wlh3": ["West London Hash", "West London H3", "WLH"],
    "barnesh3": ["Barnes Hash", "Barnes H3"],
    "och3": ["Old Coulsdon", "Old Coulsdon Hash", "OC Hash"],
    "slh3": ["SLASH", "SLAH3", "South London Hash"],
    "fukfm": ["FUKFMH3", "FUK Full Moon", "First UK Full Moon"],
    "eh3": ["Enfield Hash", "Enfield H3"],
  };

  // ── SOURCE DATA (PRD Section 8) ──

  const sources = [
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
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["boh3", "bobbh3", "beantown", "bos-moon", "pink-taco"],
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
        columns: { runNumber: 0, specialRun: 1, date: 2, hares: 3, location: 4, title: 6, description: 9 },
        kennelTagRules: { default: "Summit", specialRunMap: { "ASSSH3": "ASSSH3" }, numericSpecialTag: "SFM" },
        startTimeRules: { byDayOfWeek: { "Mon": "19:00", "Sat": "15:00", "Fri": "19:00" }, default: "15:00" },
      },
      kennelCodes: ["summit", "sfm", "asssh3"],
    },
    {
      name: "BFM Google Calendar",
      url: "bfmhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["BFM|Ben Franklin|BFMH3", "BFM"],
          ["Philly Hash|hashphilly|Philly H3", "Philly H3"],
          ["Main Line", "Main Line H3"],
          ["TTH3", "TTH3"],
        ],
        defaultKennelTag: "BFM",
      },
      kennelCodes: ["bfm", "philly-h3"],
    },
    {
      name: "Philly H3 Google Calendar",
      url: "36ed6654c946ca632f71f400c1236c45d1bdd4e38c88c7c4da57619a72bfd7f8@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["BFM|Ben Franklin|BFMH3", "BFM"],
          ["Philly Hash|hashphilly|Philly H3", "Philly H3"],
        ],
        defaultKennelTag: "Philly H3",
      },
      kennelCodes: ["bfm", "philly-h3"],
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
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["CH3|Chicago Hash|Chicago H3", "CH3"],
          ["TH3|Thirstday|Thursday Hash", "TH3"],
          ["CFMH3|Chicago Full Moon|Full Moon Hash|Full Moon H3|Moon Hash", "CFMH3"],
          ["FCMH3|First Crack", "FCMH3"],
          ["BDH3|Big Dogs", "BDH3"],
          ["BMH3|Bushman", "BMH3"],
          ["2CH3|Second City", "2CH3"],
          ["WWH3|Whiskey Wednesday", "WWH3"],
          ["4X2|4x2", "4X2H4"],
          ["RTH3|Ragtime", "RTH3"],
          ["DLH3|Duneland|South Shore", "DLH3"],
        ],
        defaultKennelTag: "CH3",
      },
      kennelCodes: ["ch3", "th3", "cfmh3", "fcmh3", "bdh3", "bmh3", "2ch3", "wwh3", "4x2h4", "rth3", "dlh3"],
    },
    {
      name: "EWH3 Google Calendar",
      url: "ewh3harerazor@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "EWH3",
      },
      kennelCodes: ["ewh3"],
    },
    {
      name: "SHITH3 Google Calendar",
      url: "jackschitt.shit@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "SHITH3",
      },
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
        kennelTagRules: { default: "W3H3" },
        startTimeRules: { byDayOfWeek: { "Wed": "18:09" }, default: "18:09" },
      },
      kennelCodes: ["w3h3"],
    },
    // London, UK
    {
      name: "City Hash Website",
      url: "https://cityhash.org.uk/",
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
      kennelCodes: ["wlh3"],
    },
    {
      name: "London Hash Run List",
      url: "https://www.londonhash.org/runlist.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["lh3"],
    },
    // Bay Area iCal feed (sfh3.com aggregator — ~11 kennels)
    {
      name: "SFH3 MultiHash iCal Feed",
      url: "https://www.sfh3.com/calendar.ics?kennels=all",
      type: "ICAL_FEED" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelPatterns: [
          ["^SFH3", "SFH3"],
          ["^GPH3", "GPH3"],
          ["^EBH3", "EBH3"],
          ["^SVH3", "SVH3"],
          ["^FHAC-U", "FHAC-U"],
          ["^Agnews", "Agnews"],
          ["^Marin H3", "MarinH3"],
          ["^FCH3", "FCH3"],
          ["^FMH3", "SFFMH3"],
          ["^BARH3", "BARH3"],
          ["^VMH3", "VMH3"],
        ],
        defaultKennelTag: "SFH3",
        skipPatterns: ["^Hand Pump", "^Workday"],
      },
      kennelCodes: ["sfh3", "gph3", "ebh3", "svh3", "fhac-u", "agnews", "barh3", "marinh3", "fch3", "sffmh3", "vmh3"],
    },
    // Hash Rego (hashrego.com — multi-kennel registration platform)
    {
      name: "Hash Rego",
      url: "https://hashrego.com/events",
      type: "HASHREGO" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        kennelSlugs: ["BFMH3", "EWH3", "WH4", "GFH3", "CH3", "DCH4", "DCFMH3"],
      },
      kennelCodes: ["bfm", "ewh3", "wh4", "gfh3", "ch3", "dch4", "dcfmh3"],
    },
  ];

  console.log("Seeding kennels...");

  // Upsert all kennels (keyed by kennelCode — permanent identity)
  const kennelRecords: Record<string, { id: string }> = {};
  for (const kennel of kennels) {
    const slug = toSlug(kennel.shortName);
    // Extract profile fields (omit undefined to avoid overwriting existing data with null)
    const profileFields: Record<string, string | number | undefined> = {};
    for (const key of [
      "website", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency",
      "scheduleNotes", "hashCash", "facebookUrl", "instagramHandle",
      "twitterHandle", "discordUrl", "contactEmail", "foundedYear", "description",
    ] as const) {
      if (kennel[key] !== undefined) profileFields[key] = kennel[key];
    }
    const record = await prisma.kennel.upsert({
      where: { kennelCode: kennel.kennelCode },
      update: {
        shortName: kennel.shortName,
        fullName: kennel.fullName,
        region: kennel.region,
        slug,
        ...profileFields,
      },
      create: {
        kennelCode: kennel.kennelCode,
        shortName: kennel.shortName,
        slug,
        fullName: kennel.fullName,
        region: kennel.region,
        country: kennel.country ?? "USA",
        ...profileFields,
      },
    });
    kennelRecords[kennel.kennelCode] = record;
  }
  console.log(`  ✓ ${kennels.length} kennels upserted`);

  // Upsert all aliases (keyed by kennelCode)
  let aliasCount = 0;
  for (const [code, aliases] of Object.entries(kennelAliases)) {
    const kennel = kennelRecords[code];
    if (!kennel) {
      console.warn(`  ⚠ Kennel code "${code}" not found, skipping aliases`);
      continue;
    }
    for (const alias of aliases) {
      await prisma.kennelAlias.upsert({
        where: {
          kennelId_alias: { kennelId: kennel.id, alias },
        },
        update: {},
        create: {
          kennelId: kennel.id,
          alias,
        },
      });
      aliasCount++;
    }
  }
  console.log(`  ✓ ${aliasCount} kennel aliases upserted`);

  // Upsert sources and source-kennel links
  console.log("Seeding sources...");
  for (const source of sources) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { kennelCodes, ...sourceData } = source;

    let existingSource = await prisma.source.findFirst({
      where: { url: sourceData.url },
    });

    if (!existingSource) {
      existingSource = await prisma.source.create({
        // Cast needed because Prisma's InputJsonValue doesn't accept deep object literals
        data: sourceData as Parameters<typeof prisma.source.create>[0]["data"],
      });
      console.log(`  ✓ Created source: ${sourceData.name}`);
    } else {
      // Update config and scrapeDays if present
      await prisma.source.update({
        where: { id: existingSource.id },
        data: sourceData as Parameters<typeof prisma.source.update>[0]["data"],
      });
      console.log(`  ✓ Source already exists: ${sourceData.name}`);
    }

    // Create SourceKennel links
    for (const code of kennelCodes) {
      const kennel = kennelRecords[code];
      if (!kennel) {
        console.warn(`  ⚠ Kennel code "${code}" not found, skipping source link`);
        continue;
      }

      await prisma.sourceKennel.upsert({
        where: {
          sourceId_kennelId: {
            sourceId: existingSource.id,
            kennelId: kennel.id,
          },
        },
        update: {},
        create: {
          sourceId: existingSource.id,
          kennelId: kennel.id,
        },
      });
    }
    console.log(`  ✓ Linked ${kennelCodes.length} kennels to ${sourceData.name}`);
  }

  // ── ROSTER GROUPS ──

  const rosterGroups = [
    {
      name: "NYC Metro",
      kennelCodes: [
        "nych3", "brh3", "nah3", "knick", "qbk", "si",
        "columbia", "harriettes-nyc", "ggfm", "nawwh3",
      ],
    },
    {
      name: "Philly Area",
      kennelCodes: ["bfm", "philly-h3"],
    },
  ];

  console.log("Seeding roster groups...");
  for (const group of rosterGroups) {
    let rosterGroup = await prisma.rosterGroup.findFirst({
      where: { name: group.name },
    });

    if (!rosterGroup) {
      rosterGroup = await prisma.rosterGroup.create({
        data: { name: group.name },
      });
      console.log(`  ✓ Created roster group: ${group.name}`);
    } else {
      console.log(`  ✓ Roster group already exists: ${group.name}`);
    }

    for (const code of group.kennelCodes) {
      const kennel = kennelRecords[code];
      if (!kennel) {
        console.warn(`  ⚠ Kennel code "${code}" not found, skipping roster group link`);
        continue;
      }

      await prisma.rosterGroupKennel.upsert({
        where: { kennelId: kennel.id },
        update: { groupId: rosterGroup.id },
        create: {
          groupId: rosterGroup.id,
          kennelId: kennel.id,
        },
      });
    }
    console.log(`  ✓ Linked ${group.kennelCodes.length} kennels to ${group.name}`);
  }

  // Ensure every kennel has a RosterGroup (standalone kennels get single-member groups)
  console.log("Ensuring all kennels have a roster group...");
  // Build a code→shortName map for group naming
  const codeToShortName: Record<string, string> = {};
  for (const k of kennels) codeToShortName[k.kennelCode] = k.shortName;

  for (const [code, record] of Object.entries(kennelRecords)) {
    const existing = await prisma.rosterGroupKennel.findUnique({
      where: { kennelId: record.id },
    });
    if (!existing) {
      const groupName = codeToShortName[code] ?? code;
      let group = await prisma.rosterGroup.findFirst({
        where: { name: groupName },
      });
      if (!group) {
        group = await prisma.rosterGroup.create({
          data: { name: groupName },
        });
      }
      await prisma.rosterGroupKennel.upsert({
        where: { kennelId: record.id },
        update: { groupId: group.id },
        create: { groupId: group.id, kennelId: record.id },
      });
      console.log(`  + Created standalone group for ${groupName}`);
    }
  }

  // Post-seed validation: check for duplicate fullNames
  const dupes: Array<{ fullName: string; cnt: bigint }> = await prisma.$queryRaw`
    SELECT "fullName", COUNT(*) as cnt FROM "Kennel" GROUP BY "fullName" HAVING COUNT(*) > 1
  `;
  if (dupes.length > 0) {
    console.warn("\n⚠ Duplicate fullNames found:");
    for (const d of dupes) console.warn(`  - "${d.fullName}" (${d.cnt} records)`);
  }

  console.log("\nSeed complete!");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
