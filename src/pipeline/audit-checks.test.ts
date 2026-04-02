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

  it("skips location-region-appended when location ends with state abbreviation (display guard handles it)", () => {
    const event = makeEvent({
      locationName: "Central Park, Manhattan, NY",
      locationCity: "New York, NY",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(0);
  });

  it("flags location-region-appended when location has no state abbreviation and city differs", () => {
    const event = makeEvent({
      locationName: "The Rusty Bucket",
      locationCity: "Akron, OH",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("location-region-appended");
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

  it("does not flag location-region-appended when locationCity city name appears in locationName", () => {
    const event = makeEvent({
      locationName: "Some Bar, Brooklyn, NY",
      locationCity: "Brooklyn, NY",
    });
    const findings = checkLocationQuality([event]);
    expect(findings).toHaveLength(0);
  });

  it("does not flag location-region-appended when locationCity is null", () => {
    const event = makeEvent({
      locationName: "Some Bar, Queens, NY",
      locationCity: null,
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
