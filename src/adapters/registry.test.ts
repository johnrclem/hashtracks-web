import { describe, it, expect } from "vitest";
import { getAdapter } from "./registry";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { BFMAdapter } from "./html-scraper/bfm";
import { HashPhillyAdapter } from "./html-scraper/hashphilly";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";
import { ICalAdapter } from "./ical/adapter";
import { CityHashAdapter } from "./html-scraper/city-hash";
import { WestLondonHashAdapter } from "./html-scraper/west-london-hash";
import { LondonHashAdapter } from "./html-scraper/london-hash";
import { BarnesHashAdapter } from "./html-scraper/barnes-hash";
import { OCH3Adapter } from "./html-scraper/och3";
import { SlashHashAdapter } from "./html-scraper/slash-hash";
import { EnfieldHashAdapter } from "./html-scraper/enfield-hash";
import { SFH3Adapter } from "./html-scraper/sfh3";

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

  it("returns CityHashAdapter for cityhash.org.uk URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://cityhash.org.uk/")).toBeInstanceOf(CityHashAdapter);
  });

  it("returns WestLondonHashAdapter for westlondonhash.com URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://westlondonhash.com/runs/")).toBeInstanceOf(WestLondonHashAdapter);
  });

  it("returns LondonHashAdapter for londonhash.org URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://www.londonhash.org/runlist.php")).toBeInstanceOf(LondonHashAdapter);
  });

  it("returns SFH3Adapter for sfh3.com URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://www.sfh3.com/runs?kennels=all")).toBeInstanceOf(SFH3Adapter);
  });

  it("returns GoogleCalendarAdapter for GOOGLE_CALENDAR", () => {
    expect(getAdapter("GOOGLE_CALENDAR")).toBeInstanceOf(GoogleCalendarAdapter);
  });

  it("returns GoogleSheetsAdapter for GOOGLE_SHEETS", () => {
    expect(getAdapter("GOOGLE_SHEETS")).toBeInstanceOf(GoogleSheetsAdapter);
  });

  it("returns ICalAdapter for ICAL_FEED", () => {
    expect(getAdapter("ICAL_FEED")).toBeInstanceOf(ICalAdapter);
  });

  it("returns BarnesHashAdapter for barnesh3.com URL", () => {
    expect(getAdapter("HTML_SCRAPER", "http://www.barnesh3.com/HareLine.htm")).toBeInstanceOf(BarnesHashAdapter);
  });

  it("returns OCH3Adapter for och3.org.uk URL", () => {
    expect(getAdapter("HTML_SCRAPER", "http://www.och3.org.uk/upcoming-run-list.html")).toBeInstanceOf(OCH3Adapter);
  });

  it("returns SlashHashAdapter for londonhash.org/slah3 URL", () => {
    expect(getAdapter("HTML_SCRAPER", "https://www.londonhash.org/slah3/runlist/slash3list.html")).toBeInstanceOf(SlashHashAdapter);
  });

  it("still returns LondonHashAdapter for londonhash.org/runlist.php (not SLH3)", () => {
    expect(getAdapter("HTML_SCRAPER", "https://www.londonhash.org/runlist.php")).toBeInstanceOf(LondonHashAdapter);
  });

  it("returns EnfieldHashAdapter for enfieldhash.org URL", () => {
    expect(getAdapter("HTML_SCRAPER", "http://www.enfieldhash.org/")).toBeInstanceOf(EnfieldHashAdapter);
  });

  it("throws for unimplemented source type", () => {
    expect(() => getAdapter("RSS_FEED" as never)).toThrow("Adapter not implemented");
  });
});
