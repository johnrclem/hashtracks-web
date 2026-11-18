import { describe, it, expect, vi } from "vitest";

// search.ts pulls in weather + db helpers at module load; only the
// ROWLESS_EMPTY_STATES constant is used here.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/weather", () => ({ getWeatherForEvents: vi.fn() }));

import { selectResultsToRender } from "./render-selection";
import type { EmptyStateKind } from "./search";

type Rows = { confirmed: string[]; likely: string[]; possible: string[] };
type Serialized = Rows & { broaderResults?: Rows };

const primary: Serialized = {
  confirmed: ["c1"],
  likely: ["l1"],
  possible: ["p1"],
  broaderResults: { confirmed: ["bc1"], likely: ["bl1"], possible: ["bp1"] },
};
const empty: Serialized = { confirmed: [], likely: [], possible: [] };

describe("selectResultsToRender", () => {
  describe("single stop", () => {
    it("renders the rows for none (a saved trip edited down to one leg)", () => {
      // Regression: single-stop `none` returned null, so a single-leg
      // `?savedTripId=` page showed run counts over an empty list.
      expect(selectResultsToRender("none", primary, false)).toBe(primary);
    });

    it("still renders an empty none, so TravelResults can say filters hid every row", () => {
      expect(selectResultsToRender("none", empty, false)).toBe(empty);
    });

    it("renders the in-radius rows for no_confirmed", () => {
      expect(selectResultsToRender("no_confirmed", primary, false)).toBe(primary);
    });

    it("swaps in the broader-ring rows for no_nearby", () => {
      const out = selectResultsToRender("no_nearby", primary, false);
      expect(out).toMatchObject({ confirmed: ["bc1"], likely: ["bl1"], possible: ["bp1"] });
    });

    it("renders nothing for no_nearby without broader rows", () => {
      expect(selectResultsToRender("no_nearby", empty, false)).toBeNull();
    });

    it.each(["no_runs", "no_coverage", "out_of_horizon"] satisfies EmptyStateKind[])(
      "renders nothing for the rowless %s",
      (state) => {
        expect(selectResultsToRender(state, primary, false)).toBeNull();
      },
    );
  });

  describe("multi stop", () => {
    it.each(["none", "no_confirmed", "no_nearby"] satisfies EmptyStateKind[])(
      "renders the merged arrays as-is for %s (no broader swap)",
      (state) => {
        expect(selectResultsToRender(state, primary, true)).toBe(primary);
      },
    );

    it.each(["no_runs", "no_coverage", "out_of_horizon"] satisfies EmptyStateKind[])(
      "renders nothing for the rowless %s",
      (state) => {
        expect(selectResultsToRender(state, primary, true)).toBeNull();
      },
    );
  });
});
