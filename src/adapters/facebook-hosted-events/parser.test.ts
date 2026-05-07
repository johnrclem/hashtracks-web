import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFacebookHostedEvents } from "./parser";

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
  join(__dirname, "fixtures", "grand-strand-upcoming.html"),
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
    const html = `<script type="application/json">{ invalid </script><script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Test"},
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
    const html = `<script type="application/json">{
      "rich":{"__typename":"Event","id":"123456789012345","name":"Test"},
      "time":{"id":"123456789012345","start_timestamp":1778295600}
    }</script>`;
    const laEvents = parseFacebookHostedEvents(html, { kennelTag: "la", timezone: "America/Los_Angeles" });
    const tokyoEvents = parseFacebookHostedEvents(html, { kennelTag: "tokyo", timezone: "Asia/Tokyo" });
    expect(laEvents[0].date).toBe("2026-05-08");
    expect(tokyoEvents[0].date).toBe("2026-05-09");
  });
});
