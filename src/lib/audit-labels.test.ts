import { describe, it, expect } from "vitest";
import {
  STREAM_LABELS,
  ALL_STREAM_LABELS,
  kennelLabel,
  parseKennelLabel,
  parseStreamLabel,
} from "./audit-labels";

describe("audit-labels", () => {
  it("exposes the three forward streams", () => {
    expect(STREAM_LABELS.AUTOMATED).toBe("audit:automated");
    expect(STREAM_LABELS.CHROME_EVENT).toBe("audit:chrome-event");
    expect(STREAM_LABELS.CHROME_KENNEL).toBe("audit:chrome-kennel");
  });

  it("ALL_STREAM_LABELS contains every sub-label", () => {
    expect(ALL_STREAM_LABELS).toContain("audit:automated");
    expect(ALL_STREAM_LABELS).toContain("audit:chrome-event");
    expect(ALL_STREAM_LABELS).toContain("audit:chrome-kennel");
    expect(ALL_STREAM_LABELS).toHaveLength(3);
  });

  it("kennelLabel + parseKennelLabel are inverses", () => {
    expect(kennelLabel("agnews")).toBe("kennel:agnews");
    expect(parseKennelLabel("kennel:agnews")).toBe("agnews");
    expect(parseKennelLabel("kennel:nych3")).toBe("nych3");
  });

  it("parseKennelLabel rejects non-kennel labels and empty codes", () => {
    expect(parseKennelLabel("audit")).toBeNull();
    expect(parseKennelLabel("audit:automated")).toBeNull();
    expect(parseKennelLabel("kennel:")).toBeNull();
    expect(parseKennelLabel("kennel:   ")).toBeNull();
  });

  it("parseStreamLabel returns the canonical key", () => {
    expect(parseStreamLabel("audit:automated")).toBe("AUTOMATED");
    expect(parseStreamLabel("audit:chrome-event")).toBe("CHROME_EVENT");
    expect(parseStreamLabel("audit:chrome-kennel")).toBe("CHROME_KENNEL");
    expect(parseStreamLabel("audit")).toBeNull();
    expect(parseStreamLabel("kennel:agnews")).toBeNull();
  });
});
