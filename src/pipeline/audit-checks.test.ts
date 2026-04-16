import { describe, it, expect } from "vitest";
import {
  checkHareQuality,
  checkTitleQuality,
  checkLocationQuality,
  checkEventQuality,
  checkDescriptionQuality,
  type AuditEventRow,
} from "./audit-checks";

function makeEvent(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: "evt-1",
    kennelShortName: "NYCH3",
    haresText: "On-Sec Hare",
    title: "Weekly Run #42",
    description: null,
    locationName: null,
    locationCity: null,
    startTime: "18:30",
    runNumber: 42,
    date: "2026-04-01",
    sourceUrl: "https://hashnyc.com/run/42",
    sourceType: "HTML_SCRAPER",
    kennelCode: "NYCH3",
    scrapeDays: 7,
    rawDescription: null,
    ...overrides,
  };
}

describe("checkHareQuality", () => {
  it("returns no findings for a clean hare value", () => {
    const event = makeEvent({ haresText: "John Doe / Jane Doe" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("skips events with null haresText", () => {
    const event = makeEvent({ haresText: null });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("flags hare-single-char as error when haresText is exactly 1 character", () => {
    const event = makeEvent({ haresText: "X" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-single-char");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].category).toBe("hares");
    expect(findings[0].field).toBe("haresText");
  });

  it("flags hare-cta-text as warning for 'TBD'", () => {
    const event = makeEvent({ haresText: "TBD" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
    expect(findings[0].severity).toBe("warning");
  });

  it("flags hare-cta-text as warning for 'tba' (case-insensitive)", () => {
    const event = makeEvent({ haresText: "tba" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
  });

  it("flags hare-cta-text for 'sign up!' variant", () => {
    const event = makeEvent({ haresText: "sign up!" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
  });

  it("flags hare-cta-text for 'volunteer'", () => {
    const event = makeEvent({ haresText: "volunteer" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
  });

  it("flags hare-cta-text for 'needed'", () => {
    const event = makeEvent({ haresText: "needed" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
  });

  it("flags hare-cta-text for embedded 'Hares needed …' sentence (#522)", () => {
    // The exact-match CTA_PATTERN required the whole string to be one of
    // tbd/tba/needed/…, so "Hares needed for Friday evening." slipped past.
    // The embedded-pattern catches CTA phrases inside a longer sentence.
    const event = makeEvent({ haresText: "Hares needed for Friday evening." });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
  });

  it("flags hare-cta-text for 'Looking for a hare'", () => {
    const event = makeEvent({ haresText: "Looking for a hare willing to lay next week" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-cta-text");
  });

  it("flags hare-cta-text for 'need a hare' and 'needed a hare' variants", () => {
    for (const haresText of [
      "We need a hare for this one!",
      "Needed a hare for this trail — step up!",
    ]) {
      const event = makeEvent({ haresText });
      const findings = checkHareQuality(event);
      expect(findings, haresText).toHaveLength(1);
      expect(findings[0].rule).toBe("hare-cta-text");
    }
  });

  it("does not flag a real hare name that happens to contain 'needed'", () => {
    // Guard against false positives — the embedded pattern requires the
    // word "needed" next to "hare(s)", not in isolation.
    const event = makeEvent({ haresText: "Needed a Beer" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("flags hare-url as warning when haresText starts with https://", () => {
    const event = makeEvent({ haresText: "https://example.com/signup" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-url");
    expect(findings[0].severity).toBe("warning");
  });

  it("flags hare-url as warning when haresText starts with http://", () => {
    const event = makeEvent({ haresText: "http://example.com/signup" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-url");
  });

  it("flags hare-description-leak as warning when haresText length > 200", () => {
    const longText = "A".repeat(201);
    const event = makeEvent({ haresText: longText });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-description-leak");
    expect(findings[0].severity).toBe("warning");
  });

  it("does not flag hare-description-leak for exactly 200 characters", () => {
    const text = "A".repeat(200);
    const event = makeEvent({ haresText: text });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("flags hare-phone-number as warning when haresText contains a phone number", () => {
    const event = makeEvent({ haresText: "Call (555) 867-5309 to hare" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-phone-number");
    expect(findings[0].severity).toBe("warning");
  });

  it("flags hare-phone-number for dotted format 555.867.5309", () => {
    const event = makeEvent({ haresText: "555.867.5309" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-phone-number");
  });

  it("flags hare-phone-number for bare 10-digit run (unseparated, #742)", () => {
    const event = makeEvent({
      haresText: "Any Cock'll Do Me, 2406185563 CALL for same day service",
    });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-phone-number");
  });

  it("does not flag hare-phone-number for shorter digit runs", () => {
    // 9 digits bounded by non-digits — below the 10-digit phone threshold
    const event = makeEvent({ haresText: "Runner #123456789" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("flags hare-boilerplate-leak when haresText contains 'WHAT TIME'", () => {
    const event = makeEvent({
      haresText: "WHAT TIME: 6:30 PM WHERE: Central Park",
    });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-boilerplate-leak");
    expect(findings[0].severity).toBe("warning");
  });

  it("flags hare-boilerplate-leak when haresText contains 'HASH CASH'", () => {
    const event = makeEvent({ haresText: "HASH CASH: $5" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-boilerplate-leak");
  });

  it("flags hare-boilerplate-leak when haresText contains 'WHERE'", () => {
    const event = makeEvent({ haresText: "WHERE: the park" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-boilerplate-leak");
  });

  it("flags hare-boilerplate-leak when haresText contains 'Location'", () => {
    const event = makeEvent({ haresText: "Location: TBD" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-boilerplate-leak");
  });

  it("flags hare-boilerplate-leak when haresText contains 'Directions'", () => {
    const event = makeEvent({ haresText: "Directions: go north" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-boilerplate-leak");
  });

  it("populates finding fields correctly", () => {
    const event = makeEvent({ haresText: "TBD" });
    const findings = checkHareQuality(event);
    const f = findings[0];
    expect(f.kennelShortName).toBe("NYCH3");
    expect(f.kennelCode).toBe("NYCH3");
    expect(f.eventId).toBe("evt-1");
    expect(f.eventUrl).toBe("https://www.hashtracks.xyz/hareline/evt-1");
    expect(f.sourceUrl).toBe("https://hashnyc.com/run/42");
    expect(f.adapterType).toBe("HTML_SCRAPER");
    expect(f.category).toBe("hares");
    expect(f.field).toBe("haresText");
    expect(f.currentValue).toBe("TBD");
  });

  it("prioritizes hare-single-char over other rules for a single-char value", () => {
    // A single char that also matches phone-like patterns shouldn't apply
    const event = makeEvent({ haresText: "1" });
    const findings = checkHareQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("hare-single-char");
  });
});

describe("checkTitleQuality", () => {
  it("flags title-raw-kennel-code as error when title starts with kennelCode Trail but not kennelShortName", () => {
    const event = makeEvent({
      title: "h4-tx Trail #2555",
      kennelCode: "h4-tx",
      kennelShortName: "Houston H3",
    });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-raw-kennel-code");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].category).toBe("title");
    expect(findings[0].field).toBe("title");
    expect(findings[0].expectedValue).toBe("Houston H3 Trail...");
  });

  it("flags title-cta-text as warning for CTA language", () => {
    const event = makeEvent({
      title: "Wanna Hare? Check out our upcoming available dates!",
    });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-cta-text");
    expect(findings[0].severity).toBe("warning");
  });

  it("flags title-cta-text for 'Hare wanted' recruitment prefix (#740)", () => {
    const event = makeEvent({
      title: "SH3 #880 Hare wanted - get in touch with Anni Tua",
    });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-cta-text");
  });

  it("flags title-cta-text for 'Hares needed' wording", () => {
    const event = makeEvent({ title: "Spring Trail — hares needed!" });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-cta-text");
  });

  it("flags title-schedule-description as warning for schedule language", () => {
    const event = makeEvent({
      title: "Mosquito H3 runs on the first and third Wednesdays",
    });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-schedule-description");
    expect(findings[0].severity).toBe("warning");
  });

  it("flags title-html-entities as warning for HTML entities", () => {
    const event = makeEvent({
      title: "St Patrick&apos;s Day Hash &amp; Run",
    });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-html-entities");
    expect(findings[0].severity).toBe("warning");
  });

  it("flags title-time-only as warning for time-only title", () => {
    const event = makeEvent({ title: "12:30pm" });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-time-only");
    expect(findings[0].severity).toBe("warning");
  });

  it("returns no findings for a clean title", () => {
    const event = makeEvent({ title: "NYCH3 #2800 Spring Equinox" });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("skips events with null title", () => {
    const event = makeEvent({ title: null });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("does not flag title-raw-kennel-code when title starts with kennelShortName", () => {
    const event = makeEvent({
      title: "Houston H3 Trail #2555",
      kennelCode: "h4-tx",
      kennelShortName: "Houston H3",
    });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(0);
  });

  it("prioritizes title-raw-kennel-code over other rules", () => {
    const event = makeEvent({
      title: "h4-tx Trail wanna hare",
      kennelCode: "h4-tx",
      kennelShortName: "Houston H3",
    });
    const findings = checkTitleQuality(event);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("title-raw-kennel-code");
  });
});

describe("checkLocationQuality", () => {
  it("flags location-url when locationName starts with https://", () => {
    const event = makeEvent({
      locationName: "https://maps.google.com/?q=Central+Park",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-url");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].category).toBe("location");
  });

  it("flags location-url when locationName starts with http://", () => {
    const event = makeEvent({
      locationName: "http://maps.example.com/location",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-url");
  });

  it("flags location-duplicate-segments when first two parts overlap", () => {
    const event = makeEvent({
      locationName: "Central Park, Central Park North, New York, NY",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-duplicate-segments");
    expect(findings[0].severity).toBe("warning");
  });

  it("passes clean location with no issues", () => {
    const event = makeEvent({
      locationName: "Central Park, New York, NY",
      locationCity: "New York, NY",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(0);
  });

  it("skips events with null locationName", () => {
    const event = makeEvent({ locationName: null });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(0);
  });

  it("flags location-phone-number for separated phone in locationName (#743)", () => {
    const event = makeEvent({
      locationName: "Casa De Assover – Raleigh, NC (text Assover at 919-332-2615 for address)",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-phone-number");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].category).toBe("location");
    expect(findings[0].field).toBe("locationName");
  });

  it("flags location-phone-number for bare 10-digit run in locationName", () => {
    const event = makeEvent({
      locationName: "Private home, call 9193326661 for address",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-phone-number");
  });

  it("does not flag location-phone-number for street numbers or ZIP codes", () => {
    const event = makeEvent({
      locationName: "15001 Health Center Dr, Bowie, MD 20716",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(0);
  });
});

describe("checkEventQuality", () => {
  it("flags event-improbable-time when startTime hour is 23", () => {
    const event = makeEvent({ startTime: "23:45" });
    const findings = checkEventQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("event-improbable-time");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].category).toBe("event");
  });

  it("flags event-improbable-time when startTime hour is in early morning (2:00)", () => {
    const event = makeEvent({ startTime: "02:00" });
    const findings = checkEventQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("event-improbable-time");
  });

  it("passes normal startTime of 18:30", () => {
    const event = makeEvent({ startTime: "18:30" });
    const findings = checkEventQuality([event]);
    expect(findings).toHaveLength(0);
  });

  it("skips events with null startTime", () => {
    const event = makeEvent({ startTime: null });
    const findings = checkEventQuality([event]);
    expect(findings).toHaveLength(0);
  });
});

describe("checkDescriptionQuality", () => {
  it("flags description-dropped when description is null but rawDescription has content", () => {
    const event = makeEvent({
      description: null,
    });
    const rawDescription = "A".repeat(21);
    const findings = checkDescriptionQuality([{ ...event, rawDescription }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("description-dropped");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].category).toBe("description");
    expect(findings[0].currentValue).toBe("(empty)");
    expect(findings[0].expectedValue).toBe(`Raw data has 21 chars`);
  });

  it("passes events that have a description", () => {
    const event = makeEvent({ description: "Meet at the park entrance" });
    const findings = checkDescriptionQuality([
      { ...event, rawDescription: "Meet at the park entrance" },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("skips events with no rawDescription", () => {
    const event = makeEvent({ description: null });
    const findings = checkDescriptionQuality([
      { ...event, rawDescription: null },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("skips events with short rawDescription (<=20 chars)", () => {
    const event = makeEvent({ description: null });
    const findings = checkDescriptionQuality([
      { ...event, rawDescription: "Short" },
    ]);
    expect(findings).toHaveLength(0);
  });
});
