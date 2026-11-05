import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { compileKennelPatterns } from "@/adapters/kennel-patterns";
import { compilePatterns } from "@/adapters/utils";
import { SOURCES } from "../prisma/seed-data/sources";
import { classify, routeTitle, type Candidate } from "./cleanup-oregon-calendar-misroutes";

const seed = (SOURCES as unknown as Array<{ name: string; config: Record<string, unknown> }>).find(
  (s) => s.name === "Oregon Hashing Calendar",
);
const cfg = seed?.config as { kennelPatterns: never; skipPatterns?: string[]; defaultKennelTag: string; strictKennelRouting: boolean };
const compiled = compileKennelPatterns(cfg.kennelPatterns);
const skips = compilePatterns(cfg.skipPatterns ?? [], "i");
const ev = (titles: string[], overrides: Partial<Candidate> = {}): Candidate => ({
  id: "e1",
  kennelCode: "oh3",
  titles,
  otherSource: false,
  attendances: 0,
  ...overrides,
});

describe("Oregon Hashing Calendar routing (seed)", () => {
  it("is strict and keeps oh3 as the default bucket", () => {
    expect(cfg.strictKennelRouting).toBe(true);
    expect(cfg.defaultKennelTag).toBe("oh3");
  });

  it("routes OH3 titles, including emoji-prefixed ones, to oh3", () => {
    for (const t of ["OH3 #1306 w/ The Hardigan Sweater!", "🍀OH3 #1185 Cockjaw!", "🌕 OH3 #1187 Full Moon Hash with Stinkfinger"]) {
      expect(routeTitle(t, compiled, skips)).toContain("oh3");
    }
  });

  it("routes sibling kennels to their own codes and drops template junk", () => {
    expect(routeTitle("EH3 #1584", compiled, skips)).toEqual(["eh3-or"]);
    expect(routeTitle("Stumptown H3", compiled, skips)).toEqual(["stumph3"]);
    expect(routeTitle("Dead Whores H3-Naked Lady Party", compiled, skips)).toEqual(["dwh3"]);
    expect(routeTitle("OKH3 #626 Granny Panties", compiled, skips)).toEqual(["okh3"]);
    expect(routeTitle("SH3 #407 - Thanks", compiled, skips)).toEqual([]); // ambiguous Stumptown/Salem
    expect(routeTitle("start comment- choose your preferred fields", compiled, skips)).toEqual([]);
  });
});

describe("classify", () => {
  it("deletes a misrouted sole-source oh3 row", () => {
    expect(classify(ev(["EH3 #1584"]), compiled, skips, "oh3")).toBe("DELETE");
  });

  it("keeps rows that still route to their kennel", () => {
    expect(classify(ev(["🍀OH3 #1185 Cockjaw!"]), compiled, skips, "oh3")).toBe("KEEP_ROUTES_HERE");
  });

  it("keeps rows another source backs, rows with attendance, and rows outside the default bucket", () => {
    expect(classify(ev(["EH3 #1584"], { otherSource: true }), compiled, skips, "oh3")).toBe("KEEP_OTHER_SOURCE");
    expect(classify(ev(["EH3 #1584"], { attendances: 1 }), compiled, skips, "oh3")).toBe("KEEP_ATTENDANCE");
    expect(classify(ev(["Cum out for cheap drinks"], { kennelCode: "tgif" }), compiled, skips, "oh3")).toBe(
      "KEEP_NOT_DEFAULT_BUCKET",
    );
  });
});
