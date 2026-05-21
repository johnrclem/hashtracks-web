import { describe, expect, it } from "vitest";
import { computeHeatmapBounds } from "./heatmap-bounds";

describe("computeHeatmapBounds", () => {
  it("returns undefined for an empty input", () => {
    expect(computeHeatmapBounds([])).toBeUndefined();
  });

  it("returns a tightly padded box for a single point", () => {
    const bounds = computeHeatmapBounds([{ lat: 40, lng: -74 }]);
    expect(bounds).toEqual({
      south: 40 - 0.015,
      north: 40 + 0.015,
      west: -74 - 0.015,
      east: -74 + 0.015,
    });
  });

  it("skips IQR filtering when fewer than 8 samples (small-set keeps outliers)", () => {
    // 5 points + 1 wild outlier — small-set path keeps the outlier
    const locations = [
      { lat: 40.0, lng: -74.0 },
      { lat: 40.1, lng: -74.1 },
      { lat: 40.2, lng: -74.2 },
      { lat: 40.3, lng: -74.3 },
      { lat: 40.4, lng: -74.4 },
      { lat: 80.0, lng: 50.0 },
    ];
    const bounds = computeHeatmapBounds(locations)!;
    expect(bounds.north).toBeGreaterThanOrEqual(80);
    expect(bounds.east).toBeGreaterThanOrEqual(50);
  });

  it("filters a far outlier when ≥8 samples are provided", () => {
    const cluster = Array.from({ length: 9 }, (_, i) => ({
      lat: 40 + i * 0.01,
      lng: -74 + i * 0.01,
    }));
    cluster.push({ lat: 80, lng: 50 }); // wild outlier
    const bounds = computeHeatmapBounds(cluster)!;
    // Outlier should be clipped — north should stay near the cluster's top
    expect(bounds.north).toBeLessThan(45);
    expect(bounds.east).toBeLessThan(-70);
  });

  it("collapses to a thin band for collinear points", () => {
    const locations = Array.from({ length: 10 }, (_, i) => ({
      lat: 40,
      lng: -74 + i * 0.01,
    }));
    const bounds = computeHeatmapBounds(locations)!;
    expect(bounds.north - bounds.south).toBeCloseTo(0.03, 5); // just 2× padding
    expect(bounds.east - bounds.west).toBeGreaterThan(0.05);
  });

  it("respects a custom padding value", () => {
    const bounds = computeHeatmapBounds([{ lat: 0, lng: 0 }], 0.5)!;
    expect(bounds.north - bounds.south).toBeCloseTo(1.0, 5);
  });
});
