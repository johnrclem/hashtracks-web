import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  parseDetailPage,
  parseDmy,
  parseHashLink,
  parseListPage,
  SouthHamsH4Adapter,
} from "./south-hams-h4";

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  fetchHTMLPage: vi.fn(),
}));
import { fetchHTMLPage } from "../utils";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
/** Real sh4.org.uk pages captured 2026-11-05. */
const LIST = fixture("sh4-list-2026-11-05.html.fixture");
const DETAIL_1608 = fixture("sh4-detail-1608-2026-11-05.html.fixture");
const DETAIL_1609 = fixture("sh4-detail-1609-2026-11-05.html.fixture");

describe("parseDmy", () => {
  it("parses DD/MM/YY with a 1998 pivot", () => {
    expect(parseDmy("11/11/26")).toBe("2026-11-11");
    expect(parseDmy("06/05/98")).toBe("1998-05-06");
    expect(parseDmy("31/02/26")).toBeNull();
    expect(parseDmy("2026-11-11")).toBeNull();
  });
});

describe("parseHashLink", () => {
  it("splits run number and theme", () => {
    expect(parseHashLink("Hash 1608")).toEqual({ runNumber: 1608 });
    expect(parseHashLink("hash 1571")).toEqual({ runNumber: 1571 });
    expect(parseHashLink("Hash 1607 AGPU 2")).toEqual({ runNumber: 1607, title: "AGPU 2" });
    expect(parseHashLink("Hash 1595 - Eclipse Hash")).toEqual({ runNumber: 1595, title: "Eclipse Hash" });
    expect(parseHashLink("Hash 1585 (Bring your own beer)")).toEqual({ runNumber: 1585, title: "Bring your own beer" });
    expect(parseHashLink("Hash 1054 *Pre-xmas hash weekend")).toEqual({ runNumber: 1054, title: "Pre-xmas hash weekend" });
    expect(parseHashLink("Hash 1591 OPTIONAL EARLY START 6:30PM FOR THOSE WHO WANT TO WATCH FOOTBALL.")?.note).toContain(
      "OPTIONAL EARLY START",
    );
    expect(parseHashLink("Christmas social")).toBeNull();
  });
});

describe("parseListPage", () => {
  const events = parseListPage(cheerio.load(LIST));

  it("reads every Future + Past row", () => {
    expect(events).toHaveLength(52);
    expect(events.every((e) => e.kennelTags[0] === "sh4")).toBe(true);
  });

  it("parses venue, street and postcode", () => {
    expect(events.find((e) => e.runNumber === 1608)).toMatchObject({
      date: "2026-11-11",
      startTime: "19:30",
      location: "Anchor Inn",
      locationStreet: "Lutterburn Street, PL21 0NG",
      sourceUrl: "https://www.sh4.org.uk/events/hash-1608/",
    });
    expect(events.find((e) => e.runNumber === 1607)).toMatchObject({ date: "2026-11-04", title: "AGPU 2" });
  });
});

describe("parseDetailPage", () => {
  it("reads time range, address, hares and what3words", () => {
    expect(parseDetailPage(cheerio.load(DETAIL_1608))).toEqual({
      startTime: "19:30",
      endTime: "23:00",
      hares: "Dulux & Rubbery",
      locationStreet: "Lutterburn Street, Ugborough, Devon, PL21 0NG",
      what3words: "lavished.drags.waddled",
      onDown: undefined,
    });
  });
});

describe("SouthHamsH4Adapter.fetch", () => {
  const source = { url: "https://www.sh4.org.uk/auto-draft/", scrapeDays: 365 } as Source;
  const page = (html: string) => ({ ok: true, $: cheerio.load(html), html, structureHash: "h", fetchDurationMs: 1 }) as never;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("enriches upcoming runs from their detail pages", async () => {
    vi.mocked(fetchHTMLPage).mockImplementation(async (url: string) => {
      if (url.endsWith("hash-1608/")) return page(DETAIL_1608);
      if (url.endsWith("hash-1609/")) return page(DETAIL_1609);
      return page(LIST);
    });
    const result = await new SouthHamsH4Adapter().fetch(source, { days: 3650 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(52);
    expect(result.events.find((e) => e.runNumber === 1608)).toMatchObject({
      hares: "Dulux & Rubbery",
      endTime: "23:00",
      description: "what3words: ///lavished.drags.waddled",
    });
    // Past rows are not enriched (no hares on the list page).
    expect(result.events.find((e) => e.runNumber === 1606)?.hares).toBeUndefined();
  });

  it("fails loud when the list has no rows", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page("<ul><li>No Events</li></ul>"));
    const result = await new SouthHamsH4Adapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("0 hash rows");
  });
});
