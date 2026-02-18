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
      shortName: "NYCH3", fullName: "New York City Hash House Harriers", region: "New York City, NY",
      website: "https://hashnyc.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$8",
      facebookUrl: "https://www.facebook.com/groups/nychash",
    },
    {
      shortName: "BrH3", fullName: "Brooklyn Hash House Harriers", region: "New York City, NY",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
    },
    {
      shortName: "NAH3", fullName: "New Amsterdam Hash House Harriers", region: "New York City, NY",
      scheduleDayOfWeek: "Saturday", scheduleTime: "3:00 PM", scheduleFrequency: "Biweekly",
    },
    { shortName: "Knick", fullName: "Knickerbocker Hash House Harriers", region: "New York City, NY" },
    {
      shortName: "LIL", fullName: "Long Island Lunatics Hash House Harriers", region: "Long Island, NY",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Weekly",
    },
    { shortName: "QBK", fullName: "Queens Black Knights Hash House Harriers", region: "New York City, NY" },
    { shortName: "SI", fullName: "Staten Island Hash House Harriers", region: "New York City, NY" },
    { shortName: "Columbia", fullName: "Columbia Hash House Harriers", region: "New York City, NY" },
    { shortName: "Harriettes", fullName: "Harriettes Hash House Harriers", region: "New York City, NY" },
    {
      shortName: "GGFM", fullName: "GGFM Hash House Harriers", region: "New York City, NY",
      scheduleFrequency: "Full Moon",
    },
    { shortName: "NAWWH3", fullName: "North American Woman Woman Hash", region: "New York City, NY" },
    { shortName: "Drinking Practice (NYC)", fullName: "NYC Drinking Practice", region: "New York City, NY" },
    // Boston area (Google Calendar source)
    {
      shortName: "BoH3", fullName: "Boston Hash House Harriers", region: "Boston, MA",
      scheduleDayOfWeek: "Sunday", scheduleTime: "2:30 PM", scheduleFrequency: "Weekly",
    },
    {
      shortName: "BoBBH3", fullName: "Boston Ballbuster Hash House Harriers", region: "Boston, MA",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly",
    },
    { shortName: "Beantown", fullName: "Beantown Hash House Harriers", region: "Boston, MA" },
    {
      shortName: "Bos Moon", fullName: "Boston Moon Hash", region: "Boston, MA",
      scheduleFrequency: "Full Moon",
    },
    { shortName: "Pink Taco", fullName: "Pink Taco Hash House Harriers", region: "Boston, MA" },
    // New Jersey
    {
      shortName: "Summit", fullName: "Summit Hash House Harriers", region: "North NJ",
      scheduleDayOfWeek: "Monday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Summer: Mondays 7pm. Winter: Saturdays 3pm.",
    },
    {
      shortName: "SFM", fullName: "Summit Full Moon H3", region: "North NJ",
      scheduleFrequency: "Full Moon",
    },
    { shortName: "ASSSH3", fullName: "All Seasons Summit Shiggy H3", region: "North NJ" },
    { shortName: "Rumson", fullName: "Rumson Hash House Harriers", region: "New Jersey" },
    // Philadelphia
    {
      shortName: "BFM", fullName: "Ben Franklin Mob H3", region: "Philadelphia, PA",
      website: "https://benfranklinmob.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
    },
    {
      shortName: "Philly H3", fullName: "Philly Hash House Harriers", region: "Philadelphia, PA",
      website: "https://hashphilly.com/nexthash/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
    },
    // Chicago area (Chicagoland Google Calendar aggregator)
    {
      shortName: "CH3", fullName: "Chicago Hash House Harriers", region: "Chicago, IL",
      website: "https://chicagohash.org", foundedYear: 1978,
      facebookUrl: "https://www.facebook.com/groups/10638781851/",
      scheduleNotes: "Summer: Mondays 7pm. Winter: Sundays 2pm.",
      description: "Chicago's original kennel (est. 1978). Weekly Sunday afternoon runs (winter) / Monday evening runs (summer).",
    },
    {
      shortName: "TH3", fullName: "Thirstday Hash House Harriers", region: "Chicago, IL",
      website: "https://chicagoth3.com", foundedYear: 2003,
      scheduleDayOfWeek: "Thursday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Thursday evening hash. 7 PM meet, 7:30 on-out. Urban trails accessible via public transit.",
    },
    {
      shortName: "CFMH3", fullName: "Chicago Full Moon Hash House Harriers", region: "Chicago, IL",
      website: "https://www.hhhinchicago.com", foundedYear: 1987,
      facebookUrl: "https://www.facebook.com/groups/570636943051356/",
      scheduleFrequency: "Monthly", scheduleNotes: "Evenings near the full moon",
      description: "Monthly hash near the full moon (est. 1987). Day of week varies with the lunar cycle.",
    },
    {
      shortName: "FCMH3", fullName: "First Crack of the Moon Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/570636943051356/",
      scheduleFrequency: "Monthly", scheduleNotes: "Evenings near the new moon",
      description: "Monthly hash near the new moon. Sister kennel to Chicago Full Moon H3.",
    },
    {
      shortName: "BDH3", fullName: "Big Dogs Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/137255643022023/",
      scheduleFrequency: "Monthly", scheduleNotes: "2nd Saturday afternoon",
      description: "Monthly 2nd Saturday afternoon hash. Off-the-beaten-path trails.",
    },
    {
      shortName: "BMH3", fullName: "Bushman Hash House Harriers", region: "Chicago, IL",
      website: "https://www.hhhinchicago.com",
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Saturday afternoon",
      description: "Monthly 3rd Saturday afternoon hash. All-woods trails in Cook County Forest Preserves.",
    },
    {
      shortName: "2CH3", fullName: "Second City Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/secondcityhhh",
      scheduleFrequency: "Irregular",
      description: "Runs on an as-desired basis. Trails typically further from city center.",
    },
    {
      shortName: "WWH3", fullName: "Whiskey Wednesday Hash House Harriers", region: "Chicago, IL",
      website: "http://www.whiskeywednesdayhash.org",
      facebookUrl: "https://www.facebook.com/groups/wwwhhh",
      scheduleFrequency: "Monthly", scheduleNotes: "Last Wednesday evening, 7:00 PM.",
      hashCash: "Free",
      description: "Monthly last Wednesday evening hash. Free to runners. Features whiskey.",
    },
    {
      shortName: "4X2H4", fullName: "4x2 Hash House Harriers and Harriettes", region: "Chicago, IL",
      website: "https://www.4x2h4.org",
      facebookUrl: "https://www.facebook.com/groups/833761823403207",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "6:30 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "1st Tuesday. $2 hash cash, 4 miles, 2 beers.", hashCash: "$2",
      description: "Monthly 1st Tuesday evening hash. $2 hash cash, ~4 mile trail, 2 beers, brief circle.",
    },
    {
      shortName: "RTH3", fullName: "Ragtime Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/213336255431069/",
      scheduleFrequency: "Irregular", scheduleNotes: "Brunch hash, various Saturdays",
      description: "Brunch hash on various Saturdays, late morning.",
    },
    {
      shortName: "DLH3", fullName: "Duneland Hash House Harriers", region: "South Shore, IN",
      facebookUrl: "https://www.facebook.com/groups/SouthShoreHHH/",
      scheduleFrequency: "Irregular",
      description: "NW Indiana hash considered part of the Chicagoland community. Irregular schedule.",
    },
    // DC / DMV area
    {
      shortName: "EWH3", fullName: "Everyday is Wednesday Hash House Harriers", region: "Washington, DC",
      website: "https://www.ewh3.com", foundedYear: 1999,
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:45 PM", scheduleFrequency: "Weekly",
      discordUrl: "https://tinyurl.com/ewh3discord",
      description: "Weekly Thursday evening hash in DC. One of the largest and most active DC kennels (est. 1999).",
    },
    {
      shortName: "SHITH3", fullName: "So Happy It's Tuesday Hash House Harriers", region: "Northern Virginia",
      website: "https://shith3.com", foundedYear: 2002,
      facebookUrl: "https://www.facebook.com/groups/756148277731360/",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Weekly Tuesday evening hash in Northern Virginia / DC Metro. All live trails (est. 2002).",
    },
    {
      shortName: "CCH3", fullName: "Charm City Hash House Harriers", region: "Baltimore, MD",
      website: "https://charmcityh3.com",
      facebookUrl: "https://www.facebook.com/CharmCityH3",
      scheduleFrequency: "Biweekly", scheduleNotes: "Alternating Friday 7:00 PM and Saturday afternoons",
      description: "Biweekly hash in Baltimore, alternating Friday evenings and Saturday afternoons.",
    },
    {
      shortName: "W3H3", fullName: "Wild and Wonderful Wednesday Hash House Harriers", region: "Jefferson County, WV",
      website: "https://sites.google.com/view/w3h3",
      facebookUrl: "https://www.facebook.com/groups/273947756839837/",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:09 PM", scheduleFrequency: "Weekly",
      description: "Weekly Wednesday 6:09 PM hash in Jefferson County, West Virginia (Harpers Ferry area).",
    },
    {
      shortName: "DCH4", fullName: "DC Harriettes and Harriers Hash House", region: "Washington, DC",
      website: "https://dch4.org", foundedYear: 1978,
      facebookUrl: "https://www.facebook.com/groups/dch4hashhouse",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "2:00 PM daylight, 3:00 PM standard time",
      description: "Weekly Saturday afternoon hash. First co-ed kennel in DC (est. 1978). 2299+ trails.",
    },
    {
      shortName: "WH4", fullName: "White House Hash House Harriers", region: "Washington, DC",
      website: "https://whitehousehash.com", foundedYear: 1987,
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly",
      scheduleNotes: "3:00 PM Labor Day–Memorial Day, 5:00 PM Memorial Day–Labor Day",
      description: "Weekly Sunday hash in the DC/NoVA area (est. 1987). 2100+ trails.",
    },
    {
      shortName: "BAH3", fullName: "Baltimore Annapolis Hash House Harriers", region: "Baltimore, MD",
      website: "https://www.bah3.org",
      scheduleDayOfWeek: "Sunday", scheduleTime: "3:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Sunday 3 PM hash in the Baltimore/Annapolis area.",
    },
    {
      shortName: "MVH3", fullName: "Mount Vernon Hash House Harriers", region: "Washington, DC",
      website: "http://www.dchashing.org/mvh3/", foundedYear: 1985,
      scheduleDayOfWeek: "Saturday", scheduleTime: "10:00 AM", scheduleFrequency: "Weekly",
      description: "Weekly Saturday 10 AM hash in the DC metro area (est. 1985).",
    },
    {
      shortName: "OFH3", fullName: "Old Frederick Hash House Harriers", region: "Frederick, MD",
      website: "https://www.ofh3.com", foundedYear: 2000,
      scheduleFrequency: "Monthly", scheduleNotes: "2nd Saturday, 10:30 AM sign-in, 11:00 AM hares away",
      description: "Monthly 2nd Saturday hash in Frederick, western Maryland (est. ~2000).",
    },
    {
      shortName: "DCFMH3", fullName: "DC Full Moon Hash House Harriers", region: "Washington, DC",
      website: "https://sites.google.com/site/dcfmh3/home",
      scheduleFrequency: "Monthly", scheduleNotes: "Friday/Saturday on or near the full moon",
      contactEmail: "dcfullmoonh3@gmail.com",
      description: "Monthly hash on or near the full moon. Hosted by rotating DC-area kennels.",
    },
    {
      shortName: "GFH3", fullName: "Great Falls Hash House Harriers", region: "Northern Virginia",
      website: "http://www.gfh3.org", foundedYear: 1982,
      scheduleNotes: "Wednesday 7:00 PM (Spring/Summer), Saturday 3:00 PM (Fall/Winter)",
      description: "Seasonal schedule: Wednesday evenings (spring/summer), Saturday afternoons (fall/winter). Est. 1982, 1400+ runs.",
    },
    {
      shortName: "DCH3", fullName: "DC Hash House Harriers", region: "Washington, DC",
      foundedYear: 1972,
      scheduleNotes: "Monday 7:00 PM (Summer), Saturday 3:00 PM",
      description: "The original DC kennel (est. 1972). Men only. Monday evenings (summer) and Saturday afternoons.",
    },
    {
      shortName: "OTH4", fullName: "Over the Hump Hash House Harriers", region: "Washington, DC",
      facebookUrl: "https://www.facebook.com/share/g/6ZoFa1A5jD7Ukiv9/",
      foundedYear: 1991,
      scheduleFrequency: "Biweekly", scheduleNotes: "Sunday 2:00 PM + Wednesday 7:00 PM",
      description: "Biweekly Sunday 2 PM and Wednesday 7 PM hashes (est. 1991).",
    },
    {
      shortName: "SMUTTyCrab", fullName: "SMUTTy Crab Hash House Harriers", region: "Southern Maryland",
      website: "http://smuttycrabh3.com", foundedYear: 2007,
      scheduleFrequency: "Biweekly", scheduleNotes: "Saturday 1:00 PM",
      description: "Biweekly Saturday 1 PM hash in Southern Maryland (est. 2007).",
    },
    {
      shortName: "HillbillyH3", fullName: "Hillbilly Hash House Harriers", region: "Washington, DC",
      website: "https://sites.google.com/site/hillbillyh3/home",
      scheduleFrequency: "Twice monthly", scheduleNotes: "Sunday ~12:00 PM",
      description: "Twice-monthly Sunday hash in the DC metro / western Maryland area.",
    },
    {
      shortName: "DCRT", fullName: "DC Red Tent Harriettes", region: "Washington, DC",
      website: "https://sites.google.com/site/dcredtent/",
      facebookUrl: "https://m.facebook.com/groups/636027323156298/",
      scheduleFrequency: "Monthly", scheduleNotes: "Sunday 10:00 AM. Ladies only.",
      description: "Monthly Sunday 10 AM ladies-only hash in DC.",
    },
    {
      shortName: "H4", fullName: "Hangover Hash House Harriers", region: "Washington, DC",
      website: "https://hangoverhash.com", foundedYear: 2012,
      scheduleFrequency: "Monthly", scheduleNotes: "Sunday 10:00 AM",
      description: "Monthly Sunday 10 AM hash. Hashing the DC area since 2012.",
    },
    {
      shortName: "FUH3", fullName: "Fredericksburg Urban Hash House Harriers", region: "Fredericksburg, VA",
      website: "https://fuh3.net",
      scheduleFrequency: "Biweekly", scheduleNotes: "Saturday 3:00 PM",
      description: "Biweekly Saturday 3 PM hash in Fredericksburg, VA (~50 miles south of DC).",
    },
    {
      shortName: "DCPH4", fullName: "DC Powder/Pedal/Paddle Hounds", region: "Washington, DC",
      facebookUrl: "https://www.facebook.com/groups/DCPH4/",
      scheduleFrequency: "Quarterly", scheduleNotes: "Multi-sport hash (skiing, biking, paddling)",
      description: "Multi-sport hash (skiing, biking, paddling). Quarterly schedule.",
    },
    // San Francisco Bay Area (sfh3.com MultiHash platform)
    {
      shortName: "SFH3", fullName: "San Francisco Hash House Harriers", region: "San Francisco, CA",
      website: "https://www.sfh3.com", foundedYear: 1982,
      scheduleDayOfWeek: "Monday", scheduleTime: "6:15 PM", scheduleFrequency: "Weekly",
      twitterHandle: "@sfh3",
    },
    {
      shortName: "GPH3", fullName: "Gypsies in the Palace Hash House Harriers", region: "San Francisco, CA",
      website: "https://www.gypsiesh3.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:15 PM", scheduleFrequency: "Weekly",
    },
    {
      shortName: "EBH3", fullName: "East Bay Hash House Harriers", region: "Oakland, CA",
      website: "https://www.ebh3.com",
      scheduleDayOfWeek: "Sunday", scheduleTime: "1:00 PM", scheduleFrequency: "Biweekly",
      hashCash: "$6",
    },
    {
      shortName: "SVH3", fullName: "Silicone Valley Hash House Harriers", region: "San Jose, CA",
      website: "https://svh3.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      hashCash: "$6",
    },
    {
      shortName: "BARH3", fullName: "Bay Area Rabble Hash", region: "San Francisco, CA",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Bar-to-bar live hare hash starting at various BART stations",
    },
    {
      shortName: "MarinH3", fullName: "Marin Hash House Harriers", region: "Marin County, CA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:00 PM", scheduleFrequency: "Monthly",
    },
    {
      shortName: "FCH3", fullName: "Fog City Hash House Harriers", region: "San Francisco, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "LGBTQ-friendly kennel, special events",
    },
    {
      shortName: "SFFMH3", fullName: "San Francisco Full Moon Hash", region: "San Francisco, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "On the full moon",
    },
    // London, UK
    {
      shortName: "LH3", fullName: "London Hash House Harriers", region: "London", country: "UK",
      website: "https://www.londonhash.org", foundedYear: 1975,
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Summer: sometimes Monday evenings at 7pm",
      instagramHandle: "@london_hash_house_harriers",
    },
    {
      shortName: "CityH3", fullName: "City Hash House Harriers", region: "London", country: "UK",
      website: "https://cityhash.org.uk",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      instagramHandle: "@cityhashhouseharriers",
    },
    {
      shortName: "WLH3", fullName: "West London Hash House Harriers", region: "London", country: "UK",
      website: "https://westlondonhash.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
    },
    {
      shortName: "BarnesH3", fullName: "Barnes Hash House Harriers", region: "London", country: "UK",
      website: "http://www.barnesh3.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:30 PM", scheduleFrequency: "Weekly",
      hashCash: "£2",
    },
    {
      shortName: "OCH3", fullName: "Old Coulsdon Hash House Harriers", region: "Surrey", country: "UK",
      website: "http://www.och3.org.uk",
      scheduleFrequency: "Weekly", scheduleNotes: "Alternating Sunday 11 AM and Monday 7:30 PM",
      hashCash: "£2",
    },
    {
      shortName: "SLH3", fullName: "SLASH (South London Hash House Harriers)", region: "London", country: "UK",
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "2nd Saturday of the month",
    },
    {
      shortName: "FUKFM", fullName: "First UK Full Moon Hash House Harriers", region: "London", country: "UK",
      website: "https://fukfmh3.co.uk", foundedYear: 1990,
      scheduleFrequency: "Monthly", scheduleNotes: "Every full moon evening, 7:30 PM",
    },
    {
      shortName: "EH3", fullName: "Enfield Hash House Harriers", region: "London", country: "UK",
      website: "http://www.enfieldhash.org", foundedYear: 1999,
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Wednesday, 7:30 PM",
    },
  ];

  // ── ALIAS DATA (PRD Appendix D.3) ──

  const kennelAliases: Record<string, string[]> = {
    "NYCH3": ["NYC", "HashNYC", "NYC Hash", "NYCH3", "New York Hash", "NYC H3"],
    "BoH3": ["Boston", "BH3", "BoH3", "Boston Hash"],
    "BrH3": ["Brooklyn", "BrH3", "Brooklyn Hash", "Brooklyn H3"],
    "BoBBH3": ["Ballbuster", "BoBBH3", "Boston Ballbuster", "Ballbuster Hash"],
    "NAWWH3": ["NAWW", "NAWWH3", "NAWW Hash"],
    "NAH3": ["New Amsterdam", "NAH3", "NASS", "New Amsterdam Hash"],
    "QBK": ["Queens Black Knights", "QBK", "QBK Hash", "Queens", "Queens Hash"],
    "LIL": ["Long Island Lunatics", "LIL", "Long Island", "LI Hash", "Lunatics"],
    "BFM": ["Ben Franklin Mob", "BFM", "BFM H3"],
    "Philly H3": ["Philly Hash", "Philly H3", "Philadelphia H3", "Philadelphia Hash", "hashphilly"],
    "Bos Moon": ["Moon", "Moom", "Boston Moon", "Bos Moon", "Bos Moom"],
    "Pink Taco": ["Pink Taco", "Pink Taco Hash"],
    "Beantown": ["Beantown", "Beantown Hash"],
    "Knick": ["Knick", "Knickerbocker", "Knickerbocker Hash"],
    "Columbia": ["Columbia", "Columbia Hash"],
    "GGFM": ["GGFM", "GGFM Hash"],
    "Harriettes": ["Harriettes", "Harriettes Hash", "Harriettes (NYC)", "Harriettes NYC"],
    "SI": ["Staten Island", "SI", "SI Hash", "Staten Island Hash"],
    "Drinking Practice (NYC)": ["Drinking Practice", "NYC Drinking Practice", "NYC DP", "DP"],
    "Summit": ["Summit", "Summit H3", "Summit Hash", "SH3"],
    "SFM": ["SFM", "SFM H3", "Summit Full Moon", "Summit Full Moon H3"],
    "ASSSH3": ["ASSSH3", "ASSS H3", "All Seasons Summit Shiggy"],
    // Chicago area
    "CH3": ["Chicago Hash", "Chicago H3", "CHH3"],
    "TH3": ["Thirstday", "Thirstday Hash", "Thirstday H3", "Thursday Hash"],
    "CFMH3": ["Chicago Full Moon", "Chicago Full Moon Hash", "Chicago Moon Hash"],
    "FCMH3": ["First Crack", "First Crack H3", "First Crack of the Moon", "New Moon Hash"],
    "BDH3": ["Big Dogs", "Big Dogs H3", "Big Dogs Hash"],
    "BMH3": ["Bushman", "Bushman H3", "Bushman Hash", "The Greatest Hash"],
    "2CH3": ["Second City", "Second City H3", "Second City Hash"],
    "WWH3": ["Whiskey Wednesday", "Whiskey Wednesday Hash", "WWW H3"],
    "4X2H4": ["4x2 H4", "Four by Two H4", "4x2 Hash", "Four by Two"],
    "RTH3": ["Ragtime", "Ragtime Hash", "Brunch Hash"],
    "DLH3": ["Duneland", "Duneland H3", "South Shore HHH"],
    // DC / DMV area
    "EWH3": ["Everyday is Wednesday", "Every Day is Wednesday"],
    "SHITH3": ["SHIT H3", "S.H.I.T. H3", "So Happy It's Tuesday"],
    "CCH3": ["Charm City", "Charm City Hash", "Charm City H3"],
    "W3H3": ["Wild and Wonderful Wednesday"],
    "DCH4": ["DC Harriettes", "DC Harriettes and Harriers", "Harriettes and Harriers"],
    "WH4": ["White House Hash", "White House H3", "White House"],
    "BAH3": ["Baltimore Annapolis", "Baltimore Annapolis Hash"],
    "MVH3": ["Mount Vernon Hash", "Mount Vernon H3", "Mount Vernon"],
    "OFH3": ["Old Frederick", "Old Frederick Hash"],
    "DCFMH3": ["DC Full Moon", "DC Full Moon Hash"],
    "GFH3": ["Great Falls", "Great Falls Hash"],
    "DCH3": ["DC Hash", "DC Hash House Harriers", "the Men's Hash"],
    "OTH4": ["Over the Hump"],
    "SMUTTyCrab": ["SMUTTy Crab", "SMUTT", "Smutty Crab H3"],
    "HillbillyH3": ["Hillbilly Hash", "Hillbilly H3"],
    "DCRT": ["DC Red Tent", "Red Tent H3", "Red Tent Harriettes"],
    "H4": ["Hangover Hash", "Hangover H3", "Hangover"],
    "FUH3": ["Fredericksburg Urban Hash", "FXBG H3"],
    "DCPH4": ["DC Powder Pedal Paddle"],
    // San Francisco Bay Area
    "SFH3": ["SF Hash", "San Francisco Hash", "San Francisco H3"],
    "GPH3": ["Gypsies", "Gypsies H3", "Gypsies in the Palace", "GIP H3"],
    "EBH3": ["East Bay", "East Bay Hash", "East Bay H3"],
    "SVH3": ["Silicone Valley", "Silicone Valley H3", "Silicon Valley Hash", "SV Hash"],
    "BARH3": ["Bay Area Rabble", "BAR H3"],
    "MarinH3": ["Marin Hash", "Marin H3"],
    "FCH3": ["Fog City", "Fog City Hash", "Fog City H3"],
    "SFFMH3": ["SF Full Moon", "SF Full Moon Hash"],
    // London, UK
    "LH3": ["London Hash", "London H3"],
    "CityH3": ["City Hash", "City H3"],
    "WLH3": ["West London Hash", "West London H3", "WLH"],
    "BarnesH3": ["Barnes Hash", "Barnes H3", "BH3"],
    "OCH3": ["Old Coulsdon", "Old Coulsdon Hash", "OC Hash"],
    "SLH3": ["SLASH", "SLAH3", "South London Hash"],
    "FUKFM": ["FUKFMH3", "FUK Full Moon", "First UK Full Moon"],
    "EH3": ["Enfield Hash", "Enfield H3"],
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
      kennelShortNames: ["NYCH3", "BrH3", "NAH3", "Knick", "LIL", "QBK", "SI", "Columbia", "Harriettes", "GGFM", "NAWWH3"],
    },
    {
      name: "Boston Hash Calendar",
      url: "bostonhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelShortNames: ["BoH3", "BoBBH3", "Beantown", "Bos Moon", "Pink Taco"],
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
      kennelShortNames: ["Summit", "SFM", "ASSSH3"],
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
      kennelShortNames: ["BFM", "Philly H3"],
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
      kennelShortNames: ["BFM", "Philly H3"],
    },
    {
      name: "BFM Website",
      url: "https://benfranklinmob.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelShortNames: ["BFM"],
    },
    {
      name: "Philly H3 Website",
      url: "https://hashphilly.com/nexthash/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelShortNames: ["Philly H3"],
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
      kennelShortNames: ["CH3", "TH3", "CFMH3", "FCMH3", "BDH3", "BMH3", "2CH3", "WWH3", "4X2H4", "RTH3", "DLH3"],
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
      kennelShortNames: ["EWH3"],
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
      kennelShortNames: ["SHITH3"],
    },
  ];

  console.log("Seeding kennels...");

  // Upsert all kennels
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
      where: { shortName: kennel.shortName },
      update: {
        fullName: kennel.fullName,
        region: kennel.region,
        slug,
        ...profileFields,
      },
      create: {
        shortName: kennel.shortName,
        slug,
        fullName: kennel.fullName,
        region: kennel.region,
        country: kennel.country ?? "USA",
        ...profileFields,
      },
    });
    kennelRecords[kennel.shortName] = record;
  }
  console.log(`  ✓ ${kennels.length} kennels upserted`);

  // Upsert all aliases
  let aliasCount = 0;
  for (const [shortName, aliases] of Object.entries(kennelAliases)) {
    const kennel = kennelRecords[shortName];
    if (!kennel) {
      console.warn(`  ⚠ Kennel "${shortName}" not found, skipping aliases`);
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
    const { kennelShortNames, ...sourceData } = source;

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
    for (const shortName of kennelShortNames) {
      const kennel = kennelRecords[shortName];
      if (!kennel) continue;

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
    console.log(`  ✓ Linked ${kennelShortNames.length} kennels to ${sourceData.name}`);
  }

  // ── ROSTER GROUPS ──

  const rosterGroups = [
    {
      name: "NYC Metro",
      kennelShortNames: [
        "NYCH3", "BrH3", "NAH3", "Knick", "QBK", "SI",
        "Columbia", "Harriettes", "GGFM", "NAWWH3",
      ],
    },
    {
      name: "Philly Area",
      kennelShortNames: ["BFM", "Philly H3"],
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

    for (const shortName of group.kennelShortNames) {
      const kennel = kennelRecords[shortName];
      if (!kennel) {
        console.warn(`  ⚠ Kennel "${shortName}" not found, skipping roster group link`);
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
    console.log(`  ✓ Linked ${group.kennelShortNames.length} kennels to ${group.name}`);
  }

  // Ensure every kennel has a RosterGroup (standalone kennels get single-member groups)
  console.log("Ensuring all kennels have a roster group...");
  for (const [shortName, record] of Object.entries(kennelRecords)) {
    const existing = await prisma.rosterGroupKennel.findUnique({
      where: { kennelId: record.id },
    });
    if (!existing) {
      let group = await prisma.rosterGroup.findFirst({
        where: { name: shortName },
      });
      if (!group) {
        group = await prisma.rosterGroup.create({
          data: { name: shortName },
        });
      }
      await prisma.rosterGroupKennel.upsert({
        where: { kennelId: record.id },
        update: { groupId: group.id },
        create: { groupId: group.id, kennelId: record.id },
      });
      console.log(`  + Created standalone group for ${shortName}`);
    }
  }

  console.log("\nSeed complete!");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
