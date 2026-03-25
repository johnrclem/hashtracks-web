import { groupByCoordinates, parseCoordKey } from "./map-utils";

// ── groupByCoordinates ───────────────────────────────────────────────────────

describe("groupByCoordinates", () => {
  const getCoords = (item: { lat: number; lng: number } | null) =>
    item ? { lat: item.lat, lng: item.lng } : null;

  it("returns empty Map for empty input", () => {
    const result = groupByCoordinates([], getCoords);
    expect(result.size).toBe(0);
  });

  it("groups items at distinct coords into separate entries", () => {
    const items = [
      { lat: 40.7488, lng: -73.9856 },
      { lat: 51.5074, lng: -0.1278 },
    ];
    const result = groupByCoordinates(items, getCoords);
    expect(result.size).toBe(2);
    expect(result.get("40.7488,-73.9856")).toEqual([items[0]]);
    expect(result.get("51.5074,-0.1278")).toEqual([items[1]]);
  });

  it("groups items at same coords (within 0.0001) into one entry", () => {
    // These two coords differ by less than 0.00005, so they round to the same 4-decimal key
    const items = [
      { lat: 40.74884, lng: -73.98562 },
      { lat: 40.74881, lng: -73.98558 },
    ];
    const result = groupByCoordinates(items, getCoords);
    expect(result.size).toBe(1);
    const group = result.get("40.7488,-73.9856");
    expect(group).toHaveLength(2);
    expect(group).toContain(items[0]);
    expect(group).toContain(items[1]);
  });

  it("excludes items where getCoords returns null", () => {
    type MaybeCoord = { lat: number; lng: number } | null;
    const items: MaybeCoord[] = [
      { lat: 40.7488, lng: -73.9856 },
      null,
      { lat: 51.5074, lng: -0.1278 },
    ];
    const result = groupByCoordinates(items, (item) =>
      item ? { lat: item.lat, lng: item.lng } : null,
    );
    expect(result.size).toBe(2);
  });

  it("correctly groups coords at rounding boundary", () => {
    // 40.74845 rounds to 40.7485 (round up at exactly 5)
    // 40.74855 rounds to 40.7486 (round up)
    // These should land in different groups
    const items = [
      { lat: 40.74845, lng: -73.9856 },
      { lat: 40.74855, lng: -73.9856 },
    ];
    const result = groupByCoordinates(items, getCoords);
    // 40.74845 → 40.7485, 40.74855 → 40.7486 — different keys
    expect(result.size).toBe(2);
    expect(result.get("40.7485,-73.9856")).toEqual([items[0]]);
    expect(result.get("40.7486,-73.9856")).toEqual([items[1]]);
  });

  it("handles negative coordinates correctly", () => {
    const items = [{ lat: -33.8688, lng: 151.2093 }];
    const result = groupByCoordinates(items, getCoords);
    expect(result.size).toBe(1);
    expect(result.get("-33.8688,151.2093")).toEqual(items);
  });
});

// ── parseCoordKey ────────────────────────────────────────────────────────────

describe("parseCoordKey", () => {
  it("extracts lat/lng from positive coordinates", () => {
    expect(parseCoordKey("40.7488,-73.9856")).toEqual({
      lat: 40.7488,
      lng: -73.9856,
    });
  });

  it("extracts lat/lng from negative coordinates", () => {
    expect(parseCoordKey("-33.8688,151.2093")).toEqual({
      lat: -33.8688,
      lng: 151.2093,
    });
  });

  it("handles zero coordinates", () => {
    expect(parseCoordKey("0,0")).toEqual({ lat: 0, lng: 0 });
  });

  it("round-trips with groupByCoordinates key format", () => {
    const items = [{ lat: 51.5074, lng: -0.1278 }];
    const groups = groupByCoordinates(items, (i) => i);
    const [key] = groups.keys();
    const parsed = parseCoordKey(key);
    expect(parsed.lat).toBeCloseTo(51.5074, 4);
    expect(parsed.lng).toBeCloseTo(-0.1278, 4);
  });
});
