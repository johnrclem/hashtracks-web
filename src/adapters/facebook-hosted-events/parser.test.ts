import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseFacebookHostedEvents,
  parseFacebookHostedEventsWithStats,
  parseFacebookEventDetail,
  facebookEventToRawEvent,
  extractFieldsFromFbDescription,
} from "./parser";

/**
 * Fixture captured 2026-05-07 from
 *   https://www.facebook.com/GrandStrandHashing/upcoming_hosted_events
 * via a logged-out browser-UA fetch (HTTP 200, ~900KB).
 *
 * At capture time the page advertised exactly 1 upcoming event:
 *   - id: "1012210268147290"
 *   - name: "Trail #186…. Nuevo de Mayo"
 *   - start_timestamp: 1778353200  (2026-05-09 19:00 UTC = 3:00 PM EDT)
 *   - event_place.contextual_name: "Big Air Myrtle Beach"
 *   - is_canceled: false
 *
 * Refresh the fixture on adapter shape changes; the test assertions assume
 * exactly this snapshot.
 */
const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "grand-strand-upcoming.html.fixture"),
  "utf-8",
);

describe("parseFacebookHostedEvents — GSH3 fixture", () => {
  it("extracts exactly one upcoming event from the GSH3 fixture", () => {
    const events = parseFacebookHostedEvents(FIXTURE, { kennelTag: "gsh3" });
    expect(events).toHaveLength(1);
  });

  it("populates the canonical RawEventData fields", () => {
    const [event] = parseFacebookHostedEvents(FIXTURE, {
      kennelTag: "gsh3",
      timezone: "America/New_York",
    });
    expect(event.kennelTags).toEqual(["gsh3"]);
    // 1778353200 = 2026-05-09 19:00 UTC = 15:00 EDT. Merge pipeline keys
    // events by local-date in the kennel's TZ.
    expect(event.date).toBe("2026-05-09");
    expect(event.startTime).toBe("15:00");
  });

  it("captures the event title", () => {
    const [event] = parseFacebookHostedEvents(FIXTURE, { kennelTag: "gsh3" });
    expect(event.title).toBeTruthy();
    expect(event.title).toMatch(/trail/i);
  });

  it("captures the event location from event_place.contextual_name", () => {
    const [event] = parseFacebookHostedEvents(FIXTURE, { kennelTag: "gsh3" });
    expect(event.location).toBe("Big Air Myrtle Beach");
  });

  it("emits a Facebook event link in externalLinks", () => {
    const [event] = parseFacebookHostedEvents(FIXTURE, { kennelTag: "gsh3" });
    expect(event.externalLinks).toBeDefined();
    const fbLink = event.externalLinks?.find((l) => l.url.includes("facebook.com/events/"));
    expect(fbLink).toBeDefined();
    expect(fbLink?.url).toMatch(/facebook\.com\/events\/1012210268147290/);
    expect(fbLink?.label).toMatch(/facebook/i);
  });

  it("does not propagate is_canceled as a RawEventData field (canonical type lacks the slot)", () => {
    // FB cancellation flag is intentionally dropped at the parser boundary —
    // see parser.ts. Reconcile + PR #1185 admin override drive cancellations.
    const [event] = parseFacebookHostedEvents(FIXTURE, { kennelTag: "gsh3" });
    expect((event as { cancelled?: unknown }).cancelled).toBeUndefined();
  });
});

describe("parseFacebookHostedEvents — edge cases", () => {
  it("returns an empty array when no script tags contain Event payloads", () => {
    const html = "<html><head></head><body><p>No events</p></body></html>";
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toEqual([]);
  });

  it("returns an empty array when JSON parses but contains no Event nodes", () => {
    const html = '<script type="application/json">{"foo":"bar","nested":{"baz":1}}</script>';
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toEqual([]);
  });

  it("ignores Event-typed nodes that lack a paired time-node (schema descriptors)", () => {
    // Rich-only — no time node with start_timestamp anywhere in the JSON.
    const html = `<script type="application/json">{"data":{"__typename":"Event","id":"123456789012345","name":"Schema only"}}</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toEqual([]);
  });

  it("ignores time-only nodes that lack a paired rich __typename:Event node (Codex pass-1: shape-drift safety)", () => {
    // Time-only — start_timestamp + id, but no __typename:Event metadata
    // anywhere. Without the rich half we have no title/location/cancellation
    // info; emitting at trustLevel 8 would silently overwrite richer rows
    // from other sources with empty data.
    const html = `<script type="application/json">{"event":{"id":"123456789012345","start_timestamp":1778353200,"is_past":false,"eventUrl":"/events/123456789012345/"}}</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toEqual([]);
  });

  it("emits an event when both rich-info and time nodes are present (FB split-payload)", () => {
    // FB splits each event across two nodes that share an id. Both must be
    // present for the parser to emit a row.
    const html = `<script type="application/json">{"e":{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Test","is_canceled":false,"event_place":{"contextual_name":"Loc"}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }}</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(event).toBeDefined();
    expect(event.title).toBe("Test");
    expect(event.location).toBe("Loc");
  });

  it("dedups by event id when the same event appears in multiple script blocks", () => {
    const richJson = `{"__typename":"Event","id":"123456789012345","name":"Same","event_place":{"contextual_name":"Loc"}}`;
    const timeJson = `{"id":"123456789012345","start_timestamp":1778353200}`;
    const html = `<script type="application/json">{"r1":${richJson},"t1":${timeJson}}</script><script type="application/json">{"r2":${richJson},"t2":${timeJson}}</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toHaveLength(1);
  });

  it("drops cancelled events at ingest (Codex pass-2: upcomingOnly source can't auto-cancel via reconcile)", () => {
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Cancelled","is_canceled":true},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toEqual([]);
  });

  it("drops events lacking a non-empty name (shallow Event ref or shape drift)", () => {
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345"},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toEqual([]);
  });

  it("prefers a richer Event node over a shallow ref for the same id", () => {
    // Both nodes share id; the second is shallow and would overwrite the first
    // under naive replace semantics, leaving the row with no title.
    const html = `<script type="application/json">{
      "full":{"__typename":"Event","id":"123456789012345","name":"Real title","event_place":{"contextual_name":"Real loc"}},
      "shallow":{"__typename":"Event","id":"123456789012345"},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(event.title).toBe("Real title");
    expect(event.location).toBe("Real loc");
  });

  it("merges complementary Event nodes per-field — name from one, event_place from another (Codex pass-3)", () => {
    // FB can emit two Event refs for the same id with non-overlapping data.
    // Naive replace-wholesale would drop one of the two; field-level merge
    // produces one complete row.
    const html = `<script type="application/json">{
      "withName":{"__typename":"Event","id":"123456789012345","name":"Title only"},
      "withPlace":{"__typename":"Event","id":"123456789012345","event_place":{"contextual_name":"Place only"}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(event.title).toBe("Title only");
    expect(event.location).toBe("Place only");
  });

  it("merges event_place subfields — contextual_name from one node, location from another (Codex pass-4)", () => {
    // Same id, but contextual_name and lat/lng split across two refs. The
    // wholesale `prev.event_place ?? next.event_place` rule would drop one.
    const html = `<script type="application/json">{
      "named":{"__typename":"Event","id":"123456789012345","name":"T","event_place":{"contextual_name":"Big Air"}},
      "geo":{"__typename":"Event","id":"123456789012345","event_place":{"location":{"latitude":33.69,"longitude":-78.89}}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(event.location).toBe("Big Air");
    expect(event.latitude).toBeCloseTo(33.69, 2);
    expect(event.longitude).toBeCloseTo(-78.89, 2);
  });

  it("falls back to a later non-empty contextual_name when an earlier ref had an empty one", () => {
    // The first node has an empty contextual_name; the second has the real
    // venue. First-non-empty-wins must not be confused with first-defined-wins.
    const html = `<script type="application/json">{
      "empty":{"__typename":"Event","id":"123456789012345","name":"T","event_place":{"contextual_name":""}},
      "real":{"__typename":"Event","id":"123456789012345","event_place":{"contextual_name":"Real Place"}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(event.location).toBe("Real Place");
  });

  it("drops NaN / Infinity coordinates (Number.isFinite guard, Gemini review)", () => {
    // typeof NaN === "number" is true — a typeof guard would let a NaN
    // coordinate slip through and pollute lat/lng on the canonical Event.
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Trail #1","event_place":{"contextual_name":"V","location":{"latitude":"not-a-number","longitude":"not-a-number"}}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "x" });
    expect(event.latitude).toBeUndefined();
    expect(event.longitude).toBeUndefined();
  });

  it("accepts 0,0 as a real coordinate (Number.isFinite admits zero)", () => {
    // Equator/prime-meridian intersection — improbable for a hash trail
    // but the typeof check would already let this through; verifying
    // Number.isFinite preserves the same behavior.
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Trail #1","event_place":{"contextual_name":"V","location":{"latitude":0,"longitude":0}}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "x" });
    expect(event.latitude).toBe(0);
    expect(event.longitude).toBe(0);
  });

  it("merges location lat/lng per axis (one ref has latitude, the other has longitude)", () => {
    const html = `<script type="application/json">{
      "lat":{"__typename":"Event","id":"123456789012345","name":"T","event_place":{"contextual_name":"V","location":{"latitude":33.69}}},
      "lng":{"__typename":"Event","id":"123456789012345","event_place":{"location":{"longitude":-78.89}}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(event.latitude).toBeCloseTo(33.69, 2);
    expect(event.longitude).toBeCloseTo(-78.89, 2);
  });

  it("survives invalid JSON in a script tag without throwing", () => {
    // Title with run number so the #1497 placeholder filter doesn't fire.
    const html = `<script type="application/json">{ invalid </script><script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Trail #1"},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    expect(() => parseFacebookHostedEvents(html, { kennelTag: "any" })).not.toThrow();
    const events = parseFacebookHostedEvents(html, { kennelTag: "any" });
    expect(events).toHaveLength(1);
  });

  it("sets timezone-aware date for a kennel timezone option", () => {
    // 1778295600 = 2026-05-09 03:00 UTC.
    //   PDT (UTC-7) → 2026-05-08 20:00 (previous day)
    //   JST (UTC+9) → 2026-05-09 12:00 (same day)
    // Title with run number so the #1497 placeholder filter doesn't fire.
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Trail #1"},
      "time":{"id":"123456789012345","start_timestamp":1778295600}
    }</script>`;
    const laEvents = parseFacebookHostedEvents(html, { kennelTag: "la", timezone: "America/Los_Angeles" });
    const tokyoEvents = parseFacebookHostedEvents(html, { kennelTag: "tokyo", timezone: "Asia/Tokyo" });
    expect(laEvents[0].date).toBe("2026-05-08");
    expect(tokyoEvents[0].date).toBe("2026-05-09");
  });
});

// Build a minimal split-payload island (rich + time node sharing one id).
// Mirrors the documented FB SSR field surface used everywhere else here.
function fbRoutingIsland(id: string, name: string, startTs = 1778353200): string {
  return `<script type="application/json">{
      "rich":{"__typename":"Event","id":"${id}","name":${JSON.stringify(name)}},
      "time":{"id":"${id}","start_timestamp":${startTs}}
    }</script>`;
}

function tagsByTitle(events: { title?: string; kennelTags: string[] }[]): Record<string, string[]> {
  return Object.fromEntries(events.map((e) => [e.title ?? "", e.kennelTags]));
}

describe("parseFacebookHostedEvents — kennelPatterns routing (#1996)", () => {
  // Memphis FB page hosts both MH3's own trails and sister-kennel GyNO's.
  const MEMPHIS_PATTERNS: [string, string | string[]][] = [
    [String.raw`\bGyNO\b`, "gynoh3"],
    [String.raw`^MH3\b|Memphis`, "mh3-tn"],
  ];

  it("routes each event to the right kennel via string-tuple patterns", () => {
    const html =
      fbRoutingIsland("100000000000001", "GyNO H3 Harriette Happy Hour #12") +
      fbRoutingIsland("100000000000002", "MH3 Trail #850");
    const events = parseFacebookHostedEvents(html, {
      kennelTag: "mh3-tn",
      kennelPatterns: MEMPHIS_PATTERNS,
      defaultKennelTag: "mh3-tn",
    });
    const tags = tagsByTitle(events);
    expect(tags["GyNO H3 Harriette Happy Hour #12"]).toEqual(["gynoh3"]);
    expect(tags["MH3 Trail #850"]).toEqual(["mh3-tn"]);
  });

  it("falls back to defaultKennelTag when no pattern matches", () => {
    const html = fbRoutingIsland("100000000000003", "Surprise Joint Trail #1");
    const [event] = parseFacebookHostedEvents(html, {
      kennelTag: "mh3-tn",
      kennelPatterns: MEMPHIS_PATTERNS,
      defaultKennelTag: "mh3-tn",
    });
    expect(event.kennelTags).toEqual(["mh3-tn"]);
  });

  it("falls back to kennelTag when no pattern matches and defaultKennelTag is unset", () => {
    const html = fbRoutingIsland("100000000000004", "Surprise Joint Trail #1");
    const [event] = parseFacebookHostedEvents(html, {
      kennelTag: "mh3-tn",
      kennelPatterns: MEMPHIS_PATTERNS,
    });
    expect(event.kennelTags).toEqual(["mh3-tn"]);
  });

  it("emits the co-host union for an array-tuple pattern (spec §2 D15)", () => {
    const html = fbRoutingIsland("100000000000005", "MH3 x GyNO Joint Trail #1");
    const [event] = parseFacebookHostedEvents(html, {
      kennelTag: "mh3-tn",
      kennelPatterns: [[String.raw`Joint`, ["mh3-tn", "gynoh3"]]],
    });
    expect(event.kennelTags).toEqual(["mh3-tn", "gynoh3"]);
  });

  it("is unchanged for single-kennel sources (no kennelPatterns → [kennelTag])", () => {
    const html =
      fbRoutingIsland("100000000000006", "GyNO H3 Trail #1") + fbRoutingIsland("100000000000007", "MH3 Trail #2");
    const events = parseFacebookHostedEvents(html, { kennelTag: "mh3-tn" });
    expect(events.map((e) => e.kennelTags)).toEqual([["mh3-tn"], ["mh3-tn"]]);
  });

  it("ignores an empty kennelPatterns array (single-kennel behavior)", () => {
    const html = fbRoutingIsland("100000000000008", "GyNO H3 Trail #1");
    const [event] = parseFacebookHostedEvents(html, { kennelTag: "mh3-tn", kennelPatterns: [] });
    expect(event.kennelTags).toEqual(["mh3-tn"]);
  });
});

const DETAIL_FIXTURE = readFileSync(
  join(__dirname, "fixtures", "grand-strand-event-1012210268147290.html.fixture"),
  "utf-8",
);

describe("parseFacebookEventDetail — GSH3 detail-page fixture", () => {
  it("extracts the event_description.text post body", () => {
    const detail = parseFacebookEventDetail(DETAIL_FIXTURE);
    expect(detail.description).toBeDefined();
    expect(detail.description).toMatch(/Hare:\s*Lesbian/i);
    expect(detail.description).toMatch(/Big Air/);
    expect(detail.description).toMatch(/Mexican beers/);
    expect(detail.description).toMatch(/Dog friendly/);
    // Shiggy level — the project specifically tracks this per CLAUDE.md.
    expect(detail.description).toMatch(/Shiggy 1\.69/);
  });
});

describe("parseFacebookEventDetail — edge cases", () => {
  it("returns an empty result when no event_description is present", () => {
    const html = "<html><body></body></html>";
    const detail = parseFacebookEventDetail(html);
    expect(detail.description).toBeUndefined();
  });

  it("ignores best_description (the venue blurb, not the event body)", () => {
    // best_description on event_place is the VENUE description; we don't want
    // it as the event body even though both share the same shape.
    const html = `<script type="application/json">{
      "data":{"event":{"event_place":{"best_description":{"text":"Venue blurb — IGNORE"}}}}
    }</script>`;
    const detail = parseFacebookEventDetail(html);
    expect(detail.description).toBeUndefined();
  });

  it("ignores event_description that lives under any event_place ancestor (#1292 review)", () => {
    // The sticky inEventPlace flag means even a deeply-nested
    // `event_description` under `event_place.something.deeper` is rejected,
    // so a future shape rotation can't quietly leak venue copy into the
    // canonical event body.
    const html = `<script type="application/json">{
      "data":{"event":{"event_place":{"deeper":{"event_description":{"text":"Venue copy — IGNORE"}}}}}
    }</script>`;
    const detail = parseFacebookEventDetail(html);
    expect(detail.description).toBeUndefined();
  });

  it("extracts event_description.text even when nested under arbitrary GraphQL bbox path", () => {
    const html = `<script type="application/json">{
      "__bbox":{"result":{"data":{"event":{"event_description":{"text":"Real body"}}}}}
    }</script>`;
    const detail = parseFacebookEventDetail(html);
    expect(detail.description).toBe("Real body");
  });

  it("trims the description text", () => {
    const html = `<script type="application/json">{
      "data":{"event":{"event_description":{"text":"  spaced  "}}}
    }</script>`;
    const detail = parseFacebookEventDetail(html);
    expect(detail.description).toBe("spaced");
  });

  it("survives malformed JSON islands without throwing", () => {
    const html = `<script type="application/json">{ broken </script><script type="application/json">{
      "data":{"event":{"event_description":{"text":"OK"}}}
    }</script>`;
    expect(() => parseFacebookEventDetail(html)).not.toThrow();
    expect(parseFacebookEventDetail(html).description).toBe("OK");
  });
});

describe("facebookEventToRawEvent — CIC-harvested Event projection", () => {
  // 1714521600 = exactly 2024-05-01 00:00:00 UTC (= 19844 × 86400).
  // - America/New_York (EDT, UTC-4): 2024-04-30 20:00
  // - Asia/Hong_Kong (HKT, UTC+8):   2024-05-01 08:00
  const baseEvent = {
    id: "1234567890123456",
    name: "Trail #186 — Test",
    startTimestamp: 1714521600,
    isCanceled: false,
  };

  it("projects a confirmed event to the same shape as the live listing-tab parser", () => {
    const raw = facebookEventToRawEvent(
      {
        ...baseEvent,
        eventPlace: {
          contextualName: "Some Bar",
          latitude: 35.149,
          longitude: -90.048,
        },
      },
      "mh3-tn",
      "America/New_York",
    );
    expect(raw).toMatchObject({
      kennelTags: ["mh3-tn"],
      title: "Trail #186 — Test",
      date: "2024-04-30",
      startTime: "20:00",
      location: "Some Bar",
      latitude: 35.149,
      longitude: -90.048,
      sourceUrl: "https://www.facebook.com/events/1234567890123456/",
    });
    expect(raw?.externalLinks?.[0]).toMatchObject({
      url: "https://www.facebook.com/events/1234567890123456/",
      label: "Facebook event",
    });
  });

  it("returns null for cancelled events (matches live cron drop-at-ingest semantics)", () => {
    const raw = facebookEventToRawEvent(
      { ...baseEvent, isCanceled: true },
      "mh3-tn",
      "America/New_York",
    );
    expect(raw).toBeNull();
  });

  it("returns null when name is missing or empty", () => {
    expect(
      facebookEventToRawEvent({ ...baseEvent, name: undefined }, "mh3-tn", "America/New_York"),
    ).toBeNull();
    expect(
      facebookEventToRawEvent({ ...baseEvent, name: "   " }, "mh3-tn", "America/New_York"),
    ).toBeNull();
  });

  it("omits eventPlace fields gracefully when not provided", () => {
    const raw = facebookEventToRawEvent(baseEvent, "mh3-tn", "America/New_York");
    expect(raw).toMatchObject({ kennelTags: ["mh3-tn"], title: "Trail #186 — Test" });
    expect(raw?.location).toBeUndefined();
    expect(raw?.latitude).toBeUndefined();
    expect(raw?.longitude).toBeUndefined();
  });

  it("projects to the kennel's local timezone (HK/Asia rolls forward a day)", () => {
    // Same UTC instant; kennel timezones differ.
    const ny = facebookEventToRawEvent(baseEvent, "mh3-tn", "America/New_York");
    const hk = facebookEventToRawEvent(baseEvent, "hkh3", "Asia/Hong_Kong");
    expect(ny?.date).toBe("2024-04-30");
    expect(ny?.startTime).toBe("20:00");
    expect(hk?.date).toBe("2024-05-01");
    expect(hk?.startTime).toBe("08:00");
  });
});

function rawFromTitle(title: string) {
  const html = `<script type="application/json">{
    "rich":{"__typename":"Event","id":"123456789012345","name":${JSON.stringify(title)}},
    "time":{"id":"123456789012345","start_timestamp":1778353200}
  }</script>`;
  return parseFacebookHostedEvents(html, { kennelTag: "h6" })[0];
}

describe("facebookEventToRawEvent — title trailing-delimiter strip (#1557 Memphis)", () => {
  const baseEvent = {
    id: "1234567890123456",
    startTimestamp: 1714521600,
    isCanceled: false,
  };

  it.each([
    ["GyNO H3 Trail 8 -", "GyNO H3 Trail 8"],
    ["MH3 Trail -", "MH3 Trail"],
    ["Trail #42 —", "Trail #42"],
    ["Trail #42 –", "Trail #42"],
    ["Trail #42 :", "Trail #42"],
    ["Trail #42 - ", "Trail #42"],
  ])("strips trailing delimiter from %s", (raw, expected) => {
    const result = facebookEventToRawEvent(
      { ...baseEvent, name: raw },
      "mh3-tn",
      "America/New_York",
    );
    expect(result?.title).toBe(expected);
  });

  it("preserves a real mid-string dash", () => {
    const result = facebookEventToRawEvent(
      { ...baseEvent, name: "Trail - Red Dress Run" },
      "mh3-tn",
      "America/New_York",
    );
    expect(result?.title).toBe("Trail - Red Dress Run");
  });
});

describe("bagToRawEvent — runNumber extraction (#1319)", () => {
  it.each([
    ["…HapPy Hour ~ Boston Johnny's May's Birthday Party ~ H6#307", 307],
    ["…Tacos @ Bandoleros ~ H6 #308", 308],
    ["Hollyweird Hash House Harriers HapPy Hour w/ Shane Duncan Band ~ H6#308", 308],
  ])("extracts runNumber from %p", (title, expected) => {
    expect(rawFromTitle(title).runNumber).toBe(expected);
  });

  it.each([
    "Hollyweird Hash House Harriers HapPy Hour ~ Nelson Mangina ~ON-ON~H6#28?",
    "Hollyweird Hash House Harriers HapPy Hour w/ American Legion Party 310 ~ H6#31?",
    "Hollyweird Hash House Harriers HapPy Hour ~ Tin Fish Hash ~ H6#23?",
  ])("emits null for placeholder runNumber title %p", (title) => {
    expect(rawFromTitle(title).runNumber).toBeNull();
  });

  it("leaves runNumber undefined when the title carries no run marker", () => {
    expect(rawFromTitle("Plain title with no marker").runNumber).toBeUndefined();
  });

  it("leaves runNumber undefined for the unusual `# <digits>?` shape with a space", () => {
    // "H6# 20?" — both the shared extractor and the placeholder detector
    // reject it (extractHashRunNumber requires no leading whitespace; the
    // placeholder regex requires `#\d+`). Diverging the shared helper
    // rules to support this single-source typo isn't worth it.
    expect(rawFromTitle("Hollyweird ~ Tin Fish Hash ~ H6# 20?").runNumber).toBeUndefined();
  });
});

describe("extractFieldsFromFbDescription (#1319)", () => {
  const MAY_15_DESCRIPTION = [
    "Hollyweird Hash House Harriers HapPy Hour ~ Boston Johnny's May's Birthday Party ~ H6#307",
    "",
    "Hare: Cake by the Ocean",
    "Friday: 5/15/26",
    "Location: Boston Johnny's",
    "2120 N Dixie hywy,",
    "Holly-Hood, FL 33020",
    "",
    "Pre-lube: 5ish",
  ].join("\n");

  const MAY_29_DESCRIPTION = [
    "Hollyweird Hash House Harriers HapPy Hour 4 All we can Eat Tacos @ Bandoleros ~ H6 #308",
    "",
    "Hare: 🐰✨ Senorita Pink Taco and/or ¿ Going or Cumin ?",
    "",
    "Launchpad: 📍 Bandoleros",
    "208 SW 2nd St, Fort Lauderdale, FL, United States, Florida 33301",
    "➡️ e'rections: GPS it, then look just around a park",
  ].join("\n");

  it("extracts plain Hare name and a multi-line address block under Location:", () => {
    const fields = extractFieldsFromFbDescription(MAY_15_DESCRIPTION);
    expect(fields.hares).toBe("Cake by the Ocean");
    expect(fields.locationStreet).toMatch(/2120 N Dixie hywy/);
    expect(fields.locationStreet).toMatch(/33020$/);
  });

  it("strips emoji/decoration prefixes from Hare names and collapses FB redundant country/state in the address", () => {
    const fields = extractFieldsFromFbDescription(MAY_29_DESCRIPTION);
    expect(fields.hares).toBe("Senorita Pink Taco and/or ¿ Going or Cumin ?");
    expect(fields.locationStreet).toBe("208 SW 2nd St, Fort Lauderdale, FL 33301");
  });

  it("returns empty object when the description carries neither a Hare line nor a Location block", () => {
    expect(extractFieldsFromFbDescription("Just a regular blurb with no labels")).toEqual({});
  });

  it("returns empty object on empty/whitespace input", () => {
    expect(extractFieldsFromFbDescription("")).toEqual({});
    expect(extractFieldsFromFbDescription("   \n\n  ")).toEqual({});
  });

  it("extracts prelube when present (Hollyweird MAY_15)", () => {
    expect(extractFieldsFromFbDescription(MAY_15_DESCRIPTION).prelube).toBe("5ish");
  });

  it("recognizes alternate location labels (Where, Address, Start, Meet)", () => {
    const desc = "Where: Some Bar\n123 Main St, Anytown, NY 10001";
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("123 Main St, Anytown, NY 10001");
  });

  it("stops the address block at the next labeled section", () => {
    const desc = [
      "Location: A Bar",
      "12 First Ave",
      "Hare Away: 6:30 PM",
      "Theme: ridiculous",
    ].join("\n");
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("12 First Ave");
  });

  it("captures a single-line address when the full address is on the label line", () => {
    // Regression: prior implementation dropped same-line content because it
    // used .test() instead of capturing the regex group.
    const desc = "Location: 123 Main St, Anytown, NY 10001";
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("123 Main St, Anytown, NY 10001");
  });

  it("treats a digit-free same-line remainder as the venue and uses the continuation lines", () => {
    // "Location: Boston Johnny's" is a venue name; the address comes on
    // subsequent lines. We don't want the venue duplicated into locationStreet.
    const desc = "Location: Boston Johnny's\n2120 N Dixie hywy, Holly-Hood, FL 33020";
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("2120 N Dixie hywy, Holly-Hood, FL 33020");
  });

  it("terminates the address block on labels with no whitespace after the colon (Pre-Lube:6pm)", () => {
    const desc = [
      "Location: A Bar",
      "12 First Ave",
      "Pre-Lube:6pm",
      "Theme: ridiculous",
    ].join("\n");
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("12 First Ave");
  });

  it("admits address continuation lines that lead with `(`, `-`, `[`, or `*`", () => {
    const desc = [
      "Location: Some Bar",
      "123 Main St",
      "(Corner of Main & Oak)",
    ].join("\n");
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("123 Main St, (Corner of Main & Oak)");
  });

  it("skips a non-address `Start:` line and continues to the next location label (codex P1)", () => {
    // "Start: 6:30 PM" matches the location-label list but carries a clock
    // time, not an address. The walker must keep scanning so the real
    // "Location: 123 Main St…" later in the body wins.
    const desc = [
      "Hare: Alice",
      "Start: 6:30 PM",
      "Location: 123 Main St",
      "Anytown, NY 10001",
    ].join("\n");
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("123 Main St, Anytown, NY 10001");
  });

  it("strips a leading emoji decoration on a same-line full-address (gemini #3)", () => {
    const desc = "Location: 📍 123 Main St, Anytown, NY 10001";
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.locationStreet).toBe("123 Main St, Anytown, NY 10001");
  });

  // #1498 — SWH3 Run #1781 leaked the next-run announcement after the hare names.
  it("strips an `on <weekday>` next-run trailer from the hare names (#1498 SWH3)", () => {
    const desc = "Hare: Comfort and Tight Lips on Saturday, March 14";
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.hares).toBe("Comfort and Tight Lips");
  });

  it.each([
    ["Hare: Alice on Sunday, April 5", "Alice"],
    ["Hare: Alice and Bob on Friday, June 12th", "Alice and Bob"],
    ["Hare: Big Hare on Wednesday\nLocation: …", "Big Hare"],
  ])("strips next-run trailer for %p → %p", (desc, expected) => {
    expect(extractFieldsFromFbDescription(desc).hares).toBe(expected);
  });

  it("leaves the hare line untouched when no weekday-trailer follows", () => {
    // Defensive: a hare name like "Ronnie On the Run" contains "on" but no
    // weekday, so the strip must not fire.
    const fields = extractFieldsFromFbDescription("Hare: Ronnie On the Run");
    expect(fields.hares).toBe("Ronnie On the Run");
  });

  it.each([
    // Codex P2: 'on <weekday>' followed by prose (not a date) — must NOT
    // truncate. Without the date-suffix gate, "Born on Saturday Night"
    // would silently collapse to "Born".
    ["Hare: Born on Saturday Night", "Born on Saturday Night"],
    ["Hare: Made on Friday Adventures", "Made on Friday Adventures"],
    ["Hare: Closed on Sunday Brunch", "Closed on Sunday Brunch"],
  ])("leaves the hare line untouched for %p (prose, not a date trailer)", (desc, expected) => {
    expect(extractFieldsFromFbDescription(desc).hares).toBe(expected);
  });
});

describe("extractFieldsFromFbDescription — cost / shiggy / prelube (#1930)", () => {
  // PCH3 Run #1004 — structured Label: value lines in the FB post body.
  const PCH3_RUN_1004 = [
    "Hash #1004",
    "Inebriate DilToe's Birthday",
    "",
    "Hares: B-SH*t",
    "Start: Past Idyll Hounds - continue past Idyll Hounds on Serenoa",
    "",
    "Gather: 6:00pm",
    "Hares away: 6:30pm",
    "Shiggy: ?",
    "Hash Cash: $6",
    "Pets: ?",
    "Bring: Hash cash, whistle, light, bug spray, $ and ID",
    "On-after: Idyll Hounds",
  ].join("\n");

  it("extracts cost from Hash Cash and leaves shiggy unset when it is a placeholder", () => {
    const fields = extractFieldsFromFbDescription(PCH3_RUN_1004);
    expect(fields.cost).toBe("$6");
    // "Shiggy: ?" is a placeholder — never fabricate a difficulty.
    expect(fields.difficulty).toBeUndefined();
    // On-after / Gather / Hares away have no column — stay in the description.
    expect(fields.prelube).toBeUndefined();
  });

  it.each([
    ["Shiggy: 1", 1],
    ["Shiggy: 3", 3],
    ["Shiggy Level: 5", 5],
    ["Shiggy Scale: 4", 4],
  ])("parses a valid 1–5 shiggy value %p", (line, expected) => {
    expect(extractFieldsFromFbDescription(`Hash Cash: $5\n${line}`).difficulty).toBe(expected);
  });

  it.each([
    "Shiggy: ?",
    "Shiggy: 0",
    "Shiggy: 7",
    "Shiggy: hilly",
    "Shiggy: 3/5",
  ])("omits difficulty for out-of-range/non-numeric %p", (line) => {
    expect(extractFieldsFromFbDescription(line).difficulty).toBeUndefined();
  });

  it.each([
    ["Hash Cash: $6", "$6"],
    ["Hash Cash: $5 cash / $10 card", "$5 cash / $10 card"],
  ])("extracts free-form cost from %p", (line, expected) => {
    expect(extractFieldsFromFbDescription(line).cost).toBe(expected);
  });

  it("does NOT treat a bare 'Cash:' line as the run fee (avoids false positives across FB kennels)", () => {
    expect(extractFieldsFromFbDescription("Cash: bring small bills, no cards").cost).toBeUndefined();
  });

  it("extracts prelube from a Pre-lube line", () => {
    expect(extractFieldsFromFbDescription("Pre-lube: O'Malley's at 5pm").prelube).toBe(
      "O'Malley's at 5pm",
    );
  });

  it("ignores unrelated labeled lines (Gather, Pets, Bring)", () => {
    const desc = "Gather: 5:30pm\nPets: yes\nBring: water";
    const fields = extractFieldsFromFbDescription(desc);
    expect(fields.cost).toBeUndefined();
    expect(fields.difficulty).toBeUndefined();
    expect(fields.prelube).toBeUndefined();
  });
});

describe("parseFacebookHostedEvents — quality gate (#1497)", () => {
  // #1497 — SWH3 ingested a one-word "Test" event with no run number,
  // no location, no hares.
  const TEST_EVENT_HTML = `<script type="application/json">{
    "rich":{"__typename":"Event","id":"123456789012345","name":"Test"},
    "time":{"id":"123456789012345","start_timestamp":1778353200}
  }</script>`;

  it("rejects a one-word placeholder title with no run number and no location", () => {
    const events = parseFacebookHostedEvents(TEST_EVENT_HTML, { kennelTag: "swh3" });
    expect(events).toEqual([]);
  });

  it("counts the rejection under the `placeholder` reason in the stats result", () => {
    const result = parseFacebookHostedEventsWithStats(TEST_EVENT_HTML, { kennelTag: "swh3" });
    expect(result.events).toEqual([]);
    expect(result.filtered.placeholder).toBe(1);
  });

  it.each(["Test", "Testing", "Draft", "Placeholder", "Untitled", "New Event", "SAMPLE"])(
    "rejects placeholder title %p when no other identifying field is present",
    (title) => {
      const html = `<script type="application/json">{
        "rich":{"__typename":"Event","id":"123456789012345","name":${JSON.stringify(title)}},
        "time":{"id":"123456789012345","start_timestamp":1778353200}
      }</script>`;
      expect(parseFacebookHostedEvents(html, { kennelTag: "swh3" })).toEqual([]);
    },
  );

  it("does NOT reject a placeholder-shaped title that has a location", () => {
    // A real one-off event titled "Test" with a venue name is not a test
    // artifact and should not be silently dropped — better a noisy hareline
    // entry than silent corruption of real events.
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Test","event_place":{"contextual_name":"Some Bar"}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "swh3" });
    expect(events).toHaveLength(1);
    expect(events[0].location).toBe("Some Bar");
  });

  it("does NOT reject a title that contains 'Test' as a substring (e.g. 'Test Trail #186')", () => {
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Test Trail #186"},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "swh3" });
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Test Trail #186");
    expect(events[0].runNumber).toBe(186);
  });
});

describe("parseFacebookHostedEvents — admin-notice filter (#1500)", () => {
  // #1500 — Narwhal H3 admin posted "Moving to a new website site - Last day
  // in Meetup is March 10th" — verbatim title from the issue.
  it("rejects 'Moving to a new website site - Last day in Meetup …' verbatim (#1500 Narwhal)", () => {
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Moving to a new website site - Last day in Meetup is March 10th"},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const result = parseFacebookHostedEventsWithStats(html, { kennelTag: "narwhal-h3" });
    expect(result.events).toEqual([]);
    expect(result.filtered["admin-notice"]).toBe(1);
  });

  it.each([
    "Moving to a new website",
    "Moving to a new platform - last day in Meetup",
    "Farewell trail — wrapping up",
    "Please use our new website at example.com",
    "DEPRECATED: see new Page",
    "Goodbye Hashers",
    "RIP Hash Cash",
  ])("rejects admin/meta title %p unconditionally", (title) => {
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":${JSON.stringify(title)},"event_place":{"contextual_name":"Real Venue"}},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    // Even with a location present — admin notices are never real runs.
    expect(parseFacebookHostedEvents(html, { kennelTag: "x" })).toEqual([]);
  });

  it("does NOT reject a real trail title that contains 'new' or 'website' in passing", () => {
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"New Year's Day Trail — visit our website"},
      "time":{"id":"123456789012345","start_timestamp":1778353200}
    }</script>`;
    const events = parseFacebookHostedEvents(html, { kennelTag: "x" });
    expect(events).toHaveLength(1);
  });
});

describe("parseFacebookHostedEventsWithStats — counts", () => {
  it("returns zero counts when the page is empty", () => {
    const result = parseFacebookHostedEventsWithStats("<html></html>", { kennelTag: "x" });
    expect(result.events).toEqual([]);
    expect(Object.values(result.filtered).every((n) => n === 0)).toBe(true);
  });

  it("counts mixed reasons in a single scrape", () => {
    const html = [
      // Admin notice
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"100000000000001","name":"Moving to a new website"},
        "time":{"id":"100000000000001","start_timestamp":1778353200}
      }</script>`,
      // Placeholder
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"100000000000002","name":"Test"},
        "time":{"id":"100000000000002","start_timestamp":1778353200}
      }</script>`,
      // Cancelled
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"100000000000003","name":"Real Trail","is_canceled":true},
        "time":{"id":"100000000000003","start_timestamp":1778353200}
      }</script>`,
      // Real event
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"100000000000004","name":"Real Trail #42","event_place":{"contextual_name":"Bar"}},
        "time":{"id":"100000000000004","start_timestamp":1778353200}
      }</script>`,
    ].join("");
    const result = parseFacebookHostedEventsWithStats(html, { kennelTag: "x" });
    expect(result.events).toHaveLength(1);
    expect(result.filtered["admin-notice"]).toBe(1);
    expect(result.filtered.placeholder).toBe(1);
    expect(result.filtered.cancelled).toBe(1);
  });
});
