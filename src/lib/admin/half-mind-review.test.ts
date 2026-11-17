import {
  adminKennelStatusHref,
  halfMindRowActions,
  halfMindStatusBadge,
  nearestRegionId,
  searchKennels,
} from "./half-mind-review";

describe("halfMindRowActions", () => {
  it("maps each status", () => {
    expect(halfMindRowActions("NEW")).toEqual(["link", "add", "dismiss"]);
    expect(halfMindRowActions("LINKED")).toEqual(["unlink"]);
    expect(halfMindRowActions("ADDED")).toEqual(["view-kennel"]);
    expect(halfMindRowActions("DISMISSED")).toEqual([]);
  });
});

describe("halfMindStatusBadge", () => {
  it("flags dead and missing on LINKED/ADDED only", () => {
    expect(halfMindStatusBadge("LINKED", "dead")).toBe("Half-Mind marks this kennel dead");
    expect(halfMindStatusBadge("ADDED", "missing")).toBe("No longer on Half-Mind");
    expect(halfMindStatusBadge("NEW", "dead")).toBeNull();
    expect(halfMindStatusBadge("LINKED", "alive")).toBeNull();
    expect(halfMindStatusBadge("LINKED", null)).toBeNull();
  });
});

describe("nearestRegionId", () => {
  const regions = [
    { id: "atl", centroidLat: 33.75, centroidLng: -84.39 },
    { id: "sav", centroidLat: 32.08, centroidLng: -81.09 },
    { id: "none", centroidLat: null, centroidLng: null },
  ];
  it("picks the nearest centroid", () => {
    expect(nearestRegionId(33.9, -84.2, regions)).toBe("atl");
    expect(nearestRegionId(32.0, -81.2, regions)).toBe("sav");
  });
  it("returns null without coordinates or centroids", () => {
    expect(nearestRegionId(null, -84, regions)).toBeNull();
    expect(nearestRegionId(33, -84, [regions[2]])).toBeNull();
  });
});

describe("searchKennels", () => {
  const ks = [
    { id: "1", shortName: "Pinelake H3", fullName: "Pine Lake Hash House Harriers", region: "Atlanta" },
    { id: "2", shortName: "PF H3", fullName: "Peach Fuzz Hash", region: "Atlanta" },
  ];
  it("matches short or full name, case-insensitively", () => {
    expect(searchKennels(ks, "peach").map((k) => k.id)).toEqual(["2"]);
    expect(searchKennels(ks, "PINELAKE").map((k) => k.id)).toEqual(["1"]);
  });
  it("returns nothing for a blank query and honours the limit", () => {
    expect(searchKennels(ks, "  ")).toEqual([]);
    expect(searchKennels(ks, "h", 1)).toHaveLength(1);
  });
});

describe("adminKennelStatusHref", () => {
  it("encodes the name", () => {
    expect(adminKennelStatusHref("PF H3")).toBe("/admin/kennels?q=PF%20H3");
  });
});
