import { describe, it, expect } from "vitest";
import {
  regionSlug,
  regionBySlug,
  regionNameToSlug,
  allRegionOptions,
  regionAbbrev,
  regionColorClasses,
  getRegionColor,
  getRegionCentroid,
  regionTimezone,
  REGION_SEED_DATA,
  regionDisplayName,
  getCountryGroup,
  groupRegionsByCountry,
  expandRegionSelections,
  resolveCountryName,
} from "./region";

describe("regionSlug", () => {
  it("generates slug from region name", () => {
    expect(regionSlug("New York City, NY")).toBe("new-york-city-ny");
    expect(regionSlug("London")).toBe("london");
    expect(regionSlug("San Francisco, CA")).toBe("san-francisco-ca");
    expect(regionSlug("Washington, DC")).toBe("washington-dc");
  });
});

describe("regionBySlug", () => {
  it("returns lookup data for known slug", () => {
    const nyc = regionBySlug("new-york-city-ny");
    expect(nyc).not.toBeNull();
    expect(nyc!.name).toBe("New York City, NY");
    expect(nyc!.abbrev).toBe("NYC");
    expect(nyc!.slug).toBe("new-york-city-ny");
  });

  it("returns null for unknown slug", () => {
    expect(regionBySlug("unknown-region")).toBeNull();
  });
});

describe("regionNameToSlug", () => {
  it("resolves canonical name to slug", () => {
    expect(regionNameToSlug("New York City, NY")).toBe("new-york-city-ny");
    expect(regionNameToSlug("London")).toBe("london");
  });

  it("resolves alias to canonical slug", () => {
    expect(regionNameToSlug("London, England")).toBe("london");
    expect(regionNameToSlug("London, UK")).toBe("london");
  });

  it("returns null for unknown name", () => {
    expect(regionNameToSlug("Unknown Place")).toBeNull();
  });
});

describe("allRegionOptions", () => {
  it("returns all seed regions with slug, name, abbrev", () => {
    const options = allRegionOptions();
    expect(options.length).toBe(REGION_SEED_DATA.length);
    const nyc = options.find((o) => o.slug === "new-york-city-ny");
    expect(nyc).toEqual({ slug: "new-york-city-ny", name: "New York City, NY", abbrev: "NYC" });
  });
});

describe("slug-aware lookups", () => {
  it("regionAbbrev accepts slug", () => {
    expect(regionAbbrev("new-york-city-ny")).toBe("NYC");
    expect(regionAbbrev("london")).toBe("LDN");
  });

  it("regionAbbrev still works with name", () => {
    expect(regionAbbrev("New York City, NY")).toBe("NYC");
  });

  it("regionColorClasses accepts slug", () => {
    expect(regionColorClasses("new-york-city-ny")).toBe("bg-blue-200 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200");
  });

  it("getRegionColor accepts slug", () => {
    expect(getRegionColor("london")).toBe("#e11d48");
  });

  it("getRegionCentroid accepts slug", () => {
    const centroid = getRegionCentroid("san-francisco-ca");
    expect(centroid).toEqual({ lat: 37.77, lng: -122.42 });
  });

  it("regionTimezone accepts slug", () => {
    expect(regionTimezone("chicago-il")).toBe("America/Chicago");
    expect(regionTimezone("london")).toBe("Europe/London");
  });

  it("falls back to gray for unknown slug", () => {
    expect(regionColorClasses("fake-slug")).toBe("bg-gray-200 text-gray-800 dark:bg-gray-900/40 dark:text-gray-200");
    expect(getRegionColor("fake-slug")).toBe("#6b7280");
    expect(getRegionCentroid("fake-slug")).toBeNull();
  });
});

describe("regionDisplayName", () => {
  it("strips 'state:' prefix", () => {
    expect(regionDisplayName("state:New York")).toBe("New York");
    expect(regionDisplayName("state:California")).toBe("California");
  });

  it("strips 'country:' prefix", () => {
    expect(regionDisplayName("country:United Kingdom")).toBe("United Kingdom");
    expect(regionDisplayName("country:Germany")).toBe("Germany");
  });

  it("passes through plain names unchanged", () => {
    expect(regionDisplayName("New York City, NY")).toBe("New York City, NY");
    expect(regionDisplayName("London")).toBe("London");
  });
});

describe("getCountryGroup", () => {
  it("maps US states to United States", () => {
    expect(getCountryGroup("New York")).toBe("United States");
    expect(getCountryGroup("California")).toBe("United States");
    expect(getCountryGroup("D.C. Metro")).toBe("United States");
    expect(getCountryGroup("Texas")).toBe("United States");
  });

  it("maps international groups to their country", () => {
    expect(getCountryGroup("United Kingdom")).toBe("United Kingdom");
    expect(getCountryGroup("Scotland")).toBe("United Kingdom");
    expect(getCountryGroup("Ireland")).toBe("Ireland");
    expect(getCountryGroup("Germany")).toBe("Germany");
    expect(getCountryGroup("Japan")).toBe("Japan");
  });

  it("warns and defaults to United States for unmapped groups", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = getCountryGroup("Unknown State");
    expect(result).toBe("United States");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unmapped state group "Unknown State"'),
    );
    warnSpy.mockRestore();
  });
});

describe("groupRegionsByCountry", () => {
  it("builds 3-level hierarchy from flat region list", () => {
    const regions = ["New York City, NY", "London", "Chicago, IL"];
    const result = groupRegionsByCountry(regions);

    // Should have at least United States and United Kingdom
    expect(result.has("United States")).toBe(true);
    expect(result.has("United Kingdom")).toBe(true);

    // US should contain state-level groupings with metros
    const usStates = result.get("United States")!;
    // NYC is in New York state group
    let foundNyc = false;
    for (const [, metros] of usStates) {
      if (metros.includes("New York City, NY")) foundNyc = true;
    }
    expect(foundNyc).toBe(true);

    // UK should contain London
    const ukStates = result.get("United Kingdom")!;
    let foundLondon = false;
    for (const [, metros] of ukStates) {
      if (metros.includes("London")) foundLondon = true;
    }
    expect(foundLondon).toBe(true);
  });

  it("returns empty map for empty input", () => {
    const result = groupRegionsByCountry([]);
    expect(result.size).toBe(0);
  });
});

describe("expandRegionSelections", () => {
  const regionsByState = new Map<string, string[]>([
    ["New York", ["New York City, NY", "Buffalo, NY"]],
    ["California", ["San Francisco, CA", "Los Angeles, CA"]],
    ["United Kingdom", ["London"]],
  ]);

  it("expands state: prefix to all metros in that state", () => {
    const result = expandRegionSelections(["state:New York"], regionsByState);
    expect(result).toEqual(new Set(["New York City, NY", "Buffalo, NY"]));
  });

  it("expands country: prefix to all metros in all states of that country", () => {
    const result = expandRegionSelections(["country:United States"], regionsByState);
    expect(result).toEqual(
      new Set(["New York City, NY", "Buffalo, NY", "San Francisco, CA", "Los Angeles, CA"]),
    );
  });

  it("passes through plain metro names", () => {
    const result = expandRegionSelections(["London"], regionsByState);
    expect(result).toEqual(new Set(["London"]));
  });

  it("handles mixed selections", () => {
    const result = expandRegionSelections(
      ["state:California", "London"],
      regionsByState,
    );
    expect(result).toEqual(new Set(["San Francisco, CA", "Los Angeles, CA", "London"]));
  });

  it("returns empty set for unknown state prefix", () => {
    const result = expandRegionSelections(["state:Unknown"], regionsByState);
    expect(result.size).toBe(0);
  });
});

describe("resolveCountryName", () => {
  it("maps short codes to full names", () => {
    expect(resolveCountryName("UK")).toBe("United Kingdom");
    expect(resolveCountryName("US")).toBe("United States");
    expect(resolveCountryName("DE")).toBe("Germany");
    expect(resolveCountryName("JP")).toBe("Japan");
    expect(resolveCountryName("GB")).toBe("United Kingdom");
  });

  it("handles case-insensitive codes", () => {
    expect(resolveCountryName("us")).toBe("United States");
    expect(resolveCountryName("uk")).toBe("United Kingdom");
  });

  it("matches full country names case-insensitively", () => {
    expect(resolveCountryName("united states")).toBe("United States");
    expect(resolveCountryName("GERMANY")).toBe("Germany");
    expect(resolveCountryName("United Kingdom")).toBe("United Kingdom");
  });

  it("returns null for unknown codes or names", () => {
    expect(resolveCountryName("XX")).toBeNull();
    expect(resolveCountryName("Atlantis")).toBeNull();
  });
});
