import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import type { WordPressPost } from "../wordpress-api";
import {
  HellgateHashAdapter,
  buildDescription,
  cleanHares,
  cleanWhere,
  costIfNotDefault,
  htmlToLines,
  labelValue,
  monthDayMentions,
  parseHellgatePost,
  parseMeridiemTime,
  parseTitleDate,
  resolveHellgateDate,
  scrubContactDetails,
} from "./hellgate-hash";

// Real post bodies from missoulahash.org/wp-json/wp/v2/posts (2026-11-10), one per
// date-format era. Images and class attributes trimmed; text verbatim.
const NOV_2026: WordPressPost = {
  title: "Nov 21st, 2026: Novembeer Hash",
  url: "https://www.missoulahash.org/nov-2026-novembeer-hash/",
  date: "2026-01-03T09:09:36",
  content: `<p><strong>What:</strong> A Hashing Day!<br />
<strong>Hares:</strong> TBD<br />
<strong>When:</strong> Sat, Nov 21, 2026<br />
<strong>Where:</strong> TBD<br />
<strong>Pre-lube:</strong> 3:30 pm<br />
<strong>Chalk-talk:</strong> 4:00 pm<br />
<strong>Hash cash:</strong> $5 (Beer/Seltzer &amp; Snacks), Virgins are FREE<br />
<strong>Trail:</strong> Dog friendly?<br />
<strong>Bring:</strong> Drinking vessel, Whistle, and of course LOW expectations, $ for on-after.<br />
<strong>On-After:</strong> No-Host food &amp; more drinks @ TBD</p>
<p>&nbsp;</p>
<h3>Future Hashes are mostly held on the 3rd Saturday of every month roughly 12 &#8211; 4 pm.</h3>`,
};

const CAMPOUT_2026: WordPressPost = {
  title: "Aug 21-23, 2026: Campout Hash!",
  url: "https://www.missoulahash.org/aug-21-23-2026-campout-hash/",
  date: "2026-01-03T09:03:55",
  content: `<p><br />
<strong>Hares:</strong> Vagina Mouth &amp; Breakfast at Stiffany&#8217;s<br />
<strong>When:</strong> Campout Friday Aug 21st, Hash Saturday Aug 22nd, Depart Sunday Aug 23rd<br />
<strong>Where:</strong> <a href="https://maps.app.goo.gl/YDRaago45iWsNH8i9" target="_blank" rel="noopener">Forks Fishing Access, Fish Creek Road</a></p>
<p><strong>Directions:</strong></p>
<ul>
<li>Follow I-90 to exit 66 (Fish Creek Rd Exit).</li>
</ul>
<p><strong>Chalk Talk:</strong> Sat, Aug 22nd 1:00 pm<br />
<strong>Hash Cash:</strong> $30-$40 (Beer/Seltzers, Snacks, Sat Dinner, Sun Breakfast=$30; Optional $10 upgrade includes: Fri Dinner &amp; Sat Breakfast)<br />
<strong>Trail:</strong> A to A; Dog friendly if your dog is friendly<br />
<strong>Bring:</strong> Tent drop off to VM no later than Wed Aug 19th (msg 406-210-2271 for address) to hold camp spots</p>
<h3>Future Hashes are mostly held on the 3rd Saturday of every month roughly 12 &#8211; 4 pm.</h3>`,
};

// Title says December; the body (and publish date) say January 18th.
const TITLE_TYPO_2025: WordPressPost = {
  title: "Dec 18th, 2025: January Hash and Choir/Drinking Practice",
  url: "https://www.missoulahash.org/dec-18th-2025-january-hash-and-choir-drinking-practice/",
  date: "2025-01-14T12:10:08",
  content: `<p><span dir="auto">This month (and maybe February too) let&#8217;s have those that want to join for a winter hash first (there will be a sled involved) and then cum to the On-After for those that just want to drink/eat/sing! </span></p>
<p><span dir="auto"><strong>Hare:</strong> Vagina Mouth<br /><strong>When:</strong> Saturday January 18th (Now we&#8217;re into the 3rd Sat of each month)<br /><strong>Where:</strong> <a href="https://www.google.com/maps/place/Southside+Lions+Park/">Southside Lions Park</a><br /><strong>Pre-lube:</strong> 1:30 pm<br /><strong>Chalk-talk:</strong> 2:00 pm<br /><strong>Hash Cash:</strong> $5 (Beer/Wine &amp; Snacks)</span></p>`,
};

const DATE_LABEL_2022: WordPressPost = {
  title: "Mouth of a Schweatty Beaver’s Vagina",
  url: "https://www.missoulahash.org/mouth-of-a-schweatty-beavers-vagina/",
  date: "2022-04-07T15:27:26",
  content: `<p><strong data-wp-editing="1">Date:</strong> Saturday, April 9th<br />
<strong>Start Location:</strong> <a href="https://www.google.com/maps/place/Fort+Missoula+Regional+Park/"><span dir="auto"><span>Fort Missoula Regional Park</span></span></a><br />
<strong>Pre-lube:</strong> 12:30 PM<br />
<strong>Chalk-talk:</strong> 1:00 PM ish<br />
<strong>Hash Cash:</strong> $5 <span dir="auto"> (Beer, Non-beer, Snacks)<br />
</span><span dir="auto"><strong>Trail:</strong> A to A, Dog friendly</span><br />
<strong>Hare:</strong> <span dir="auto">Schweatty Beaver &amp; Vagina Mouth</span></p>`,
};

// Pre-2019: a bare first-line date with no label.
const BARE_LINE_2018: WordPressPost = {
  title: "Hash of Hash Past Hash",
  url: "https://www.missoulahash.org/december-2018-hash/",
  date: "2018-11-14T07:05:17",
  content: `<p><strong>Saturday, December 8th</strong><br />
<strong>Location:</strong>  <a href="https://www.facebook.com/The-RENO-391722741005539/">The Reno</a>, <a href="https://www.google.com/maps/place/3650+MT-200">3650 Hwy 200, East Missoula</a><br />
<strong>Prelube Time:</strong> 1:00 PM<br />
<strong>Hash Cash:</strong>  $10<br />
<strong>Hares:</strong>  Moby Tits, Just Rachel, and Pissus</p>
<p>Dick-ins or Dick-outs!!! Cum join us for the Hash of Hashes Past.</p>
<h2>Future Hashes</h2>
<p><strong>December 8th: Hash of Hash Past Hash</strong><br />January 2019: ??</p>`,
};

// "When:" with its value on the following lines.
const NEXT_LINE_2024: WordPressPost = {
  title: "The Tour de Wonder – Breaking Wind Hash",
  url: "https://www.missoulahash.org/the-tour-de-wonder-breaking-wind-hash/",
  date: "2024-03-23T10:47:54",
  content: `<p><strong>Your Hares:</strong><br />
Lady CadavWhore, Pissus Interruptus, Bobbin’ for Bonerz, Squeals Like a Pig</p>
<p><strong>When:</strong><br />
Saturday, May 11<sup>th </sup><br />
Pre-Lube @ 12:30 p.m.<br />
ON-OUT  @ 1 p.m.</p>
<p><strong>Where’s the ON-OUT</strong>:<br />
Grasworx Compound (backyard)<br />
1334 Phillips St.</p>`,
};

describe("htmlToLines / labelValue", () => {
  it("splits on <br> and block tags, decodes entities, drops blank lines", () => {
    const lines = htmlToLines(NOV_2026.content);
    expect(lines[0]).toBe("What: A Hashing Day!");
    expect(lines).toContain("Hash cash: $5 (Beer/Seltzer & Snacks), Virgins are FREE");
    expect(lines).not.toContain("");
  });
  it("reads a label whose value is on the next line", () => {
    expect(labelValue(htmlToLines(NEXT_LINE_2024.content), ["when"])).toBe("Saturday, May 11th");
  });
  it("matches labels case- and punctuation-insensitively", () => {
    expect(labelValue(["Pre-Lube @ 12:30 p.m."], ["prelube"])).toBe("12:30 p.m.");
    expect(labelValue(["Chalk Talk: 3 pm"], ["chalktalk"])).toBe("3 pm");
  });
});

describe("date parsing helpers", () => {
  it("parses only a leading Mon Dth, YYYY: title prefix", () => {
    expect(parseTitleDate("Oct 17th, 2026: Costumed Hash")).toEqual({ month: 10, day: 17, endDay: undefined, year: 2026 });
    expect(parseTitleDate("Aug 21-23, 2026: Campout Hash!")).toMatchObject({ month: 8, day: 21, endDay: 23 });
    expect(parseTitleDate("January 2019 Hash")).toBeNull();
    expect(parseTitleDate("July 9 Holes O’ Glory Hash")).toBeNull();
  });
  it("finds month/day mentions, ranges and playful month spellings, but not weekdays", () => {
    expect(monthDayMentions("Saturday, August 26-28, 2016")).toEqual([{ month: 8, day: 26 }, { month: 8, day: 28 }]);
    expect(monthDayMentions("Novembeer 8th")).toEqual([{ month: 11, day: 8 }]);
    expect(monthDayMentions("Friday, Sept. 20th")).toEqual([{ month: 9, day: 20 }]);
    expect(monthDayMentions("Campout starts Fri 9th & Hash starts Sat 10th")).toEqual([]);
    expect(monthDayMentions("Decent 5 miles")).toEqual([]);
  });
  it("parses 12-hour times with or without minutes and dots", () => {
    expect(parseMeridiemTime("3:30 pm")).toBe("15:30");
    expect(parseMeridiemTime("2 p.m.")).toBe("14:00");
    expect(parseMeridiemTime("Sat 10th @ 12:00pm")).toBe("12:00");
    expect(parseMeridiemTime("2:30ish")).toBeUndefined();
  });
});

describe("resolveHellgateDate", () => {
  const resolve = (p: WordPressPost) => resolveHellgateDate(htmlToLines(p.content), p.title, p.date);

  it("uses the body's explicit year", () => {
    expect(resolve(NOV_2026)).toEqual({ date: "2026-11-21" });
  });
  it("gives a campout an end date", () => {
    expect(resolve(CAMPOUT_2026)).toEqual({ date: "2026-08-21", endDate: "2026-08-23" });
  });
  it("trusts the body over a mistyped title month", () => {
    expect(resolve(TITLE_TYPO_2025)).toEqual({ date: "2025-01-18" });
  });
  it("infers the year closest to the publish date when none is given", () => {
    expect(resolve(DATE_LABEL_2022)).toEqual({ date: "2022-04-09" });
    expect(resolve(BARE_LINE_2018)).toEqual({ date: "2018-12-08" });
    expect(resolve(NEXT_LINE_2024)).toEqual({ date: "2024-05-11" });
  });
  it("rolls the year forward for a December post about January", () => {
    expect(resolveHellgateDate(["Date: Saturday, January 11th"], "January Hash", "2019-12-29T10:00:00")).toEqual({ date: "2020-01-11" });
  });
  it("falls back to the title prefix when the body has no date", () => {
    expect(resolveHellgateDate(["Hares: Somebody"], "Nov 8th, 2025: Novembeer Hash", "2025-10-28T00:00:00")).toEqual({ date: "2025-11-08" });
  });
  it("returns null when nothing is date-like", () => {
    expect(resolveHellgateDate(["When: Campout starts Fri 9th & Hash starts Sat 10th"], "Campout Hash", "2024-07-30T00:00:00")).toBeNull();
  });
  it("ignores a second date more than 4 days away", () => {
    expect(resolveHellgateDate(["When: Sat Dec 13th, 2025 (rain date Dec 20th)"], "x", "2025-11-18T00:00:00")).toEqual({ date: "2025-12-13" });
  });
});

describe("field cleaners", () => {
  it("cleanHares drops placeholders and asides; null when only placeholders", () => {
    expect(cleanHares("Vagina Mouth & ?? (Anyone?? Beuller??)")).toBe("Vagina Mouth");
    expect(cleanHares("Hares Hindlick Maneuver and Denied Entry")).toBe("Hindlick Maneuver and Denied Entry");
    expect(cleanHares("TBD")).toBeNull();
    expect(cleanHares(undefined)).toBeUndefined();
  });
  it("cleanWhere trims at a sentence break and rejects placeholders", () => {
    expect(cleanWhere("Flippers. Buy your own beer pre lube")).toBe("Flippers");
    expect(cleanWhere("Abandoned St. Pats parking garage")).toBe("Abandoned St. Pats parking garage");
    expect(cleanWhere("A to B trail. Starts at Thomas Meager Bar (130 W Pine St)")).toBe("Thomas Meager Bar (130 W Pine St)");
    expect(cleanWhere("Contact Us")).toBeNull();
    expect(cleanWhere("TBD")).toBeNull();
    expect(cleanWhere(undefined)).toBeUndefined();
  });
  it("costIfNotDefault keeps only non-$5 hash cash", () => {
    expect(costIfNotDefault("$5 (Beer/Seltzer & Snacks), Virgins are FREE")).toBeUndefined();
    expect(costIfNotDefault("$10 (Keg Beer)")).toBe("$10 (Keg Beer)");
  });
  it("scrubContactDetails removes phone numbers and emails", () => {
    expect(scrubContactDetails("Tent drop off (msg 406-210-2271 for address) by Wed")).toBe("Tent drop off by Wed");
    expect(scrubContactDetails("Drop off tents to VM house (406-210-2271 for address)")).toBe("Drop off tents to VM house");
    expect(scrubContactDetails("Email someone@example.com or call (406) 555-1234")).toBe("Email or call");
  });
  it("buildDescription drops the schedule footer and mapped labels", () => {
    const desc = buildDescription(htmlToLines(BARE_LINE_2018.content), "Saturday, December 8th");
    expect(desc).toBe("Dick-ins or Dick-outs!!! Cum join us for the Hash of Hashes Past.");
  });
});

describe("parseHellgatePost", () => {
  it("parses the upcoming placeholder post", () => {
    expect(parseHellgatePost(NOV_2026)).toEqual({
      date: "2026-11-21",
      kennelTags: ["hellgate-h3"],
      title: "Novembeer Hash",
      hares: null,
      location: null,
      startTime: "15:30",
      cost: undefined,
      trailType: undefined,
      dogFriendly: undefined,
      description:
        "What: A Hashing Day!\nTrail: Dog friendly?\nBring: Drinking vessel, Whistle, and of course LOW expectations, $ for on-after.\nOn-After: No-Host food & more drinks @ TBD",
      sourceUrl: "https://www.missoulahash.org/nov-2026-novembeer-hash/",
    });
  });

  it("parses a campout: endDate, no start time, no phone in the description", () => {
    const event = parseHellgatePost(CAMPOUT_2026);
    expect(event).toMatchObject({
      date: "2026-08-21",
      endDate: "2026-08-23",
      title: "Campout Hash!",
      hares: "Vagina Mouth, Breakfast at Stiffany’s",
      location: "Forks Fishing Access, Fish Creek Road",
      startTime: undefined,
      trailType: "A to A",
      dogFriendly: true,
    });
    expect(event?.cost).toContain("$30-$40");
    expect(event?.description).not.toMatch(/\d{3}-\d{3}-\d{4}/);
  });

  it("parses the older eras", () => {
    expect(parseHellgatePost(DATE_LABEL_2022)).toMatchObject({
      date: "2022-04-09",
      location: "Fort Missoula Regional Park",
      startTime: "12:30",
      hares: "Schweatty Beaver, Vagina Mouth",
      cost: undefined,
    });
    expect(parseHellgatePost(BARE_LINE_2018)).toMatchObject({
      date: "2018-12-08",
      location: "The Reno, 3650 Hwy 200, East Missoula",
      startTime: "13:00",
      cost: "$10",
      title: "Hash of Hash Past Hash",
    });
    expect(parseHellgatePost(NEXT_LINE_2024)).toMatchObject({
      date: "2024-05-11",
      location: "Grasworx Compound (backyard)",
      startTime: "12:30",
      hares: "Lady CadavWhore, Pissus Interruptus, Bobbin’ for Bonerz, Squeals Like a Pig",
    });
  });
});

describe("HellgateHashAdapter.fetch", () => {
  const source = {
    id: "src-hellgate",
    name: "Hellgate H3 Website",
    url: "https://www.missoulahash.org",
    type: "HTML_SCRAPER",
    scrapeDays: 365,
    config: { upcomingOnly: true },
  } as unknown as Source;

  function wpResponse(posts: WordPressPost[]): Response {
    const body = JSON.stringify(
      posts.map((p) => ({ title: { rendered: p.title }, content: { rendered: p.content }, link: p.url, date: p.date })),
    );
    return { ok: true, status: 200, statusText: "OK", text: () => Promise.resolve(body) } as Response;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("reads the latest 30 posts and windows the events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(wpResponse([NOV_2026, CAMPOUT_2026, DATE_LABEL_2022]));
    const result = await new HellgateHashAdapter().fetch(source, { days: 365 });
    expect(String(fetchSpy.mock.calls[0][0])).toContain("per_page=30");
    expect(result.errors).toEqual([]);
    // The 2022 run falls outside the ±365-day window.
    expect(result.events.map((e) => e.date)).toEqual(["2026-11-21", "2026-08-21"]);
    expect(result.diagnosticContext).toMatchObject({ postsFound: 3, unparsedTitles: [] });
  });

  it("fails loud when no post yields a date", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      wpResponse([{ title: "Hash news", content: "<p>Nothing here</p>", url: "u", date: "2026-11-01T00:00:00" }]),
    );
    const result = await new HellgateHashAdapter().fetch(source, { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("0 of 1 posts");
  });

  it("returns an error on an empty feed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(wpResponse([]));
    const result = await new HellgateHashAdapter().fetch(source, { days: 365 });
    expect(result.errors[0]).toContain("0 posts");
  });
});
