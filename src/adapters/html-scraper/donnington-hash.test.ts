import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import {
  DonningtonHashAdapter,
  headerKey,
  parseDonningtonDate,
  parseDonningtonTable,
  parseDonningtonTime,
} from "./donnington-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-donnington") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// Trimmed real-page fixtures (curl'd 2026-11-05 from donningtonh3.co.uk):
// homepage TablePress table — header, #2654 (hare-2 cell is a call for
// volunteers), #2655 (venue "TBA"), #2656, #2659 (venue "HARE NEEDED") and the
// impossible-date skeleton row #2666 "31/02/2027"; plus the first two rows of
// the deep archive page (different header labels, "21 Jun 1976" dates).
const HOME_HTML = readFileSync(path.join(__dirname, "fixtures/donnington-home-2026-11-05.html.fixture"), "utf8");
const ARCHIVE_HTML = readFileSync(
  path.join(__dirname, "fixtures/donnington-archive-1976-2026-11-05.html.fixture"),
  "utf8",
);

function makeSource(): Source {
  return {
    id: "src-donnington",
    name: "Donnington H3 Website",
    url: "https://www.donningtonh3.co.uk/",
    type: "HTML_SCRAPER",
    config: { upcomingOnly: true },
    scrapeDays: 365,
  } as unknown as Source;
}

describe("Donnington parsing helpers", () => {
  it("maps header labels across page eras", () => {
    expect(["Run No", "Run Number", "Post Code", "Postcode", "Hare 1", "Hare One", "Hare1", "Hare Two"].map(headerKey))
      .toEqual(["run", "run", "postcode", "postcode", "hare1", "hare1", "hare1", "hare2"]);
    expect(headerKey("Something")).toBeUndefined();
  });

  it("parses all three date formats and rejects impossible dates", () => {
    expect(parseDonningtonDate("08/11/2026")).toBe("2026-11-08");
    expect(parseDonningtonDate("03/01/10")).toBe("2010-01-03");
    expect(parseDonningtonDate("21 Jun 1976")).toBe("1976-06-21");
    expect(parseDonningtonDate("31/02/2027")).toBeUndefined();
    expect(parseDonningtonDate("")).toBeUndefined();
  });

  it("parses dotted, bare and colon times; ignores labels", () => {
    expect(parseDonningtonTime("18.30")).toBe("18:30");
    expect(parseDonningtonTime("1830")).toBe("18:30");
    expect(parseDonningtonTime("11:00")).toBe("11:00");
    expect(parseDonningtonTime("Summertime 'Do'")).toBeUndefined();
  });
});

describe("parseDonningtonTable", () => {
  it("parses the real homepage table", () => {
    const events = parseDonningtonTable(HOME_HTML, "https://www.donningtonh3.co.uk/");
    expect(events.map((e) => e.runNumber)).toEqual([2654, 2655, 2656, 2659]);
    expect(events[0]).toMatchObject({
      date: "2026-11-08",
      kennelTags: ["donnington-h3"],
      startTime: "11:00",
      location: "The Lion o Morfe",
      locationStreet: "Upper Farmcote, Upper, Bridgnorth., WV15 5PS",
      hares: "Jenny",
    });
    expect(events[0].title).toBeUndefined();
    expect(events[1]).toMatchObject({ location: undefined, hares: "Nancy & Stuart, Don" });
    expect(events[2].description).toBe("Apres; The Anvil, Aston Road. TF11 8DU");
    expect(events[3]).toMatchObject({ location: undefined, hares: undefined });
  });

  it("parses the deep archive's alternate headers and date format", () => {
    const events = parseDonningtonTable(ARCHIVE_HTML, "https://www.donningtonh3.co.uk/run-number-1-through-to-1791/");
    expect(events[0]).toMatchObject({
      runNumber: 1,
      date: "1976-06-21",
      startTime: "17:30",
      location: "Red House",
      locationStreet: "Lilleshall",
      hares: "Dell Hoy, Robbie Panter",
    });
  });
});

describe("DonningtonHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns windowed homepage runs", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      text: () => Promise.resolve(HOME_HTML),
      headers: new Headers({ "content-type": "text/html" }),
    } as Response);
    const result = await new DonningtonHashAdapter().fetch(makeSource(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(4);
  });

  it("fails loud when no run rows parse", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      text: () => Promise.resolve("<html><body><table><tr><td>hi</td></tr></table></body></html>"),
      headers: new Headers({ "content-type": "text/html" }),
    } as Response);
    const result = await new DonningtonHashAdapter().fetch(makeSource());
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/0 run rows parsed/);
  });
});
