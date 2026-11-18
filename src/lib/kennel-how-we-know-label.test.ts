import { confirmedLabel } from "./kennel-how-we-know-label";

describe("confirmedLabel", () => {
  it("labels by via", () => {
    expect(confirmedLabel("HALF_MIND")).toBe("Half-Mind listing checked");
    expect(confirmedLabel("ADMIN")).toBe("Checked running");
  });
});
