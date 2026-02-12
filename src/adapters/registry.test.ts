import { describe, it, expect } from "vitest";
import { getAdapter } from "./registry";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { BFMAdapter } from "./html-scraper/bfm";
import { HashPhillyAdapter } from "./html-scraper/hashphilly";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";

describe("getAdapter", () => {
  it("returns HashNYCAdapter for HTML_SCRAPER (default)", () => {
    expect(getAdapter("HTML_SCRAPER")).toBeInstanceOf(HashNYCAdapter);
  });

  it("returns HashNYCAdapter for hashnyc.com URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://hashnyc.com")).toBeInstanceOf(HashNYCAdapter);
  });

  it("returns BFMAdapter for benfranklinmob.com URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://benfranklinmob.com")).toBeInstanceOf(BFMAdapter);
  });

  it("returns HashPhillyAdapter for hashphilly.com URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://hashphilly.com/nexthash/")).toBeInstanceOf(HashPhillyAdapter);
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
