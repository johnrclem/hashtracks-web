import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  BucharestHashAdapter,
  parseBucharestDate,
  parseBucharestSheet,
  parseBucharestTime,
  splitHares,
} from "./bucharest-hash";

vi.mock("../safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "../safe-fetch";

// Selected rows from the live "BHHH Hareline" CSV export (2026-11-05).
const LIVE_CSV = readFileSync(
  path.join(__dirname, "fixtures/bucharest-hash-hareline-2026-11-05.csv.fixture"),
  "utf-8",
);

describe("parseBucharestDate", () => {
  it.each([
    ["26/2/2023", "2023-02-26"],
    ["14/2/25", "2025-02-14"],
    ["31.10.2026", "2026-10-31"],
    ["03/10/2026 (Sat)", "2026-10-03"],
    ["25-27/10/2024 Transylvanian Hash", "2024-10-25"],
  ])("%s → %s", (input, expected) => {
    expect(parseBucharestDate(input)).toBe(expected);
  });
  it("rejects undated cells", () => {
    expect(parseBucharestDate("HALLOWEEN HASH WEEKEND!!!!")).toBeNull();
    expect(parseBucharestDate("31/2/2026")).toBeNull();
  });
});

describe("parseBucharestTime", () => {
  it.each([
    ["2:00 PM", "14:00"],
    ["2PM start", "14:00"],
    ["3.00 pm start. Optional on after", "15:00"],
    ["4:00:00 PM Hash Club House", "16:00"],
    ["Gathering at 18:45 hash sharp", "18:45"],
    ["2:00", "14:00"],
    ["5pm start at hop hooligans , 6:30 pm chalk talk", "17:00"],
  ])("%s → %s", (input, expected) => {
    expect(parseBucharestTime(input)).toBe(expected);
  });
  it("ignores text without a time", () => {
    expect(parseBucharestTime("Circle at clubhouse")).toBeUndefined();
    expect(parseBucharestTime("Halloween 2026")).toBeUndefined();
  });
});

describe("splitHares", () => {
  it("splits and sorts", () => {
    expect(splitHares("Ich Been Laiden, PAB, Nice Cans")).toBe("Ich Been Laiden, Nice Cans, PAB");
    expect(splitHares("Can't Stay Up + Toothfairy")).toBe("Can't Stay Up, Toothfairy");
    expect(splitHares("Homo and Heejaa")).toBe("Heejaa, Homo");
    expect(splitHares("")).toBeUndefined();
  });
});

describe("parseBucharestSheet", () => {
  const { events, skippedOutOfOrder } = parseBucharestSheet(LIVE_CSV);
  const byRun = (tag: string, n: number) => events.find((e) => e.kennelTags[0] === tag && e.runNumber === n);

  it("routes #N to BH3 and FM#N to the Full Moon hash, skipping unnumbered/undated rows", () => {
    expect(events.map((e) => `${e.kennelTags[0]}:${e.runNumber}`)).toEqual([
      "bh3-ro:1132", "bh3-ro:1140", "bh3-ro:1194", "bfmh3-ro:1", "bfmh3-ro:2", "bh3-ro:1241",
      "bh3-ro:1276", "bfmh3-ro:19", "bh3-ro:1293", "bfmh3-ro:22", "bh3-ro:1299",
    ]);
    // #1141 "27/05/2022" sits among 2023 rows: a year typo, dropped. (In the full sheet
    // #1276 "07/06/25" sits among 2026 rows and is dropped too; in this trimmed
    // fixture its neighbour is only 4 months away, so it is kept.)
    expect(skippedOutOfOrder).toBe(1);
  });

  it("splits venue from theme and applies kennel default times", () => {
    expect(byRun("bh3-ro", 1132)).toMatchObject({ location: "Piata Sudului Metro", title: undefined, startTime: "14:00" });
    expect(byRun("bh3-ro", 1194)).toMatchObject({ location: "Parcul Casa Alba (Baneasa)", startTime: "14:00" });
    expect(byRun("bh3-ro", 1293)).toMatchObject({
      date: "2026-10-03",
      title: "Second Oktoberfest & IBL 50th Birthday",
      hares: "Ich Been Laiden, Nice Cans, PAB",
    });
    expect(byRun("bh3-ro", 1241)).toMatchObject({ title: "Short Trail Pre Lube", location: "hop hooligans", startTime: "17:00" });
    expect(byRun("bfmh3-ro", 1)).toMatchObject({ date: "2025-02-14", startTime: "18:45" });
    expect(byRun("bfmh3-ro", 22)).toMatchObject({ date: "2026-10-31", title: "Halloween", startTime: "19:00", hares: undefined });
    expect(byRun("bh3-ro", 1299)).toMatchObject({ date: "2026-11-08", startTime: "14:00", title: undefined, location: undefined });
  });
});

describe("BucharestHashAdapter.fetch", () => {
  const source = { url: "https://docs.google.com/spreadsheets/d/17NUJ3M9Th9fPi9oYkK8cLGhydW7nNq6yFMyD0x34fkQ/export?format=csv&gid=0" } as Source;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("windows the sheet", async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(LIVE_CSV, { status: 200 }));
    const result = await new BucharestHashAdapter().fetch(source, { days: 60 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([1293, 22, 1299]);
  });

  it("fails loud on a non-CSV body", async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response("<html>Sign in</html>", { status: 200 }));
    const result = await new BucharestHashAdapter().fetch(source, { days: 60 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("unexpected sheet export");
  });
});
