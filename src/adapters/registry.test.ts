import { describe, it, expect } from "vitest";
import { getAdapter } from "./registry";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";

describe("getAdapter", () => {
  it("returns HashNYCAdapter for HTML_SCRAPER", () => {
    expect(getAdapter("HTML_SCRAPER")).toBeInstanceOf(HashNYCAdapter);
  });

  it("returns GoogleCalendarAdapter for GOOGLE_CALENDAR", () => {
    expect(getAdapter("GOOGLE_CALENDAR")).toBeInstanceOf(GoogleCalendarAdapter);
  });

  it("returns GoogleSheetsAdapter for GOOGLE_SHEETS", () => {
    expect(getAdapter("GOOGLE_SHEETS")).toBeInstanceOf(GoogleSheetsAdapter);
  });

  it("throws for unimplemented source type", () => {
    expect(() => getAdapter("ICAL_FEED" as never)).toThrow("Adapter not implemented");
  });
});
