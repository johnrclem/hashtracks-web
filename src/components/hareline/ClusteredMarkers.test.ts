import { describe, it, expect } from "vitest";
import { getMarkerSize, getMarkerStyle } from "./ClusteredMarkers";

describe("getMarkerSize", () => {
  it("returns 24 when selected (regardless of precision)", () => {
    expect(getMarkerSize(true, true)).toBe(24);
    expect(getMarkerSize(true, false)).toBe(24);
  });

  it("returns 18 when precise and not selected", () => {
    expect(getMarkerSize(false, true)).toBe(18);
  });

  it("returns 14 when neither selected nor precise (centroid fallback)", () => {
    expect(getMarkerSize(false, false)).toBe(14);
  });
});

describe("getMarkerStyle", () => {
  it("uses solid background for precise markers", () => {
    const style = getMarkerStyle(18, "#2563eb", true, false);
    expect(style.backgroundColor).toBe("#2563eb");
  });

  it("uses transparent background for centroid markers", () => {
    const style = getMarkerStyle(14, "#2563eb", false, false);
    expect(style.backgroundColor).toBe("transparent");
  });

  it("uses 3px border when selected", () => {
    const style = getMarkerStyle(24, "#dc2626", true, true);
    expect(style.border).toBe("3px solid #dc2626");
  });

  it("uses 2px border when not selected", () => {
    const style = getMarkerStyle(18, "#dc2626", true, false);
    expect(style.border).toBe("2px solid #dc2626");
  });

  it("uses prominent box shadow when selected", () => {
    const style = getMarkerStyle(24, "#dc2626", true, true);
    expect(style.boxShadow).toContain("0 0 0 2px white");
    expect(style.boxShadow).toContain("#dc2626");
  });

  it("uses subtle box shadow when not selected", () => {
    const style = getMarkerStyle(18, "#dc2626", true, false);
    expect(style.boxShadow).toBe("0 1px 4px rgba(0,0,0,0.4)");
  });

  it("always applies teardrop shape", () => {
    const style = getMarkerStyle(14, "#000", false, false);
    expect(style.borderRadius).toBe("50% 50% 50% 0");
    expect(style.transform).toBe("rotate(-45deg)");
  });

  it("sets width and height to the given size", () => {
    const style = getMarkerStyle(18, "#000", true, false);
    expect(style.width).toBe(18);
    expect(style.height).toBe(18);
  });
});
