import {
  buildEventJsonLd,
  buildKennelJsonLd,
  buildRegionItemListJsonLd,
  buildWebSiteJsonLd,
  generateRegionIntro,
  safeJsonLd,
} from "@/lib/seo";

const BASE_URL = "https://hashtracks.xyz";

describe("safeJsonLd", () => {
  it("escapes </script> sequences to prevent XSS", () => {
    const data = { description: 'Hello</script><script>alert("xss")</script>' };
    const result = safeJsonLd(data);
    expect(result).not.toContain("</script>");
    expect(result).toContain("<\\/script");
  });

  it("handles normal data without modification", () => {
    const data = { name: "Test H3", region: "NYC" };
    expect(safeJsonLd(data)).toBe(JSON.stringify(data));
  });
});

describe("buildKennelJsonLd", () => {
  it("builds SportsTeam schema with all fields", () => {
    const result = buildKennelJsonLd({
      fullName: "New York City Hash House Harriers",
      shortName: "NYCH3",
      slug: "nych3",
      region: "New York City, NY",
      foundedYear: 1978,
      description: "Weekly Saturday runs in NYC.",
      website: "https://hashnyc.com",
    }, BASE_URL);

    expect(result["@type"]).toBe("SportsTeam");
    expect(result.name).toBe("New York City Hash House Harriers");
    expect(result.alternateName).toBe("NYCH3");
    expect(result.url).toBe("https://hashtracks.xyz/kennels/nych3");
    expect(result.foundingDate).toBe("1978");
    expect(result.location["@type"]).toBe("Place");
    expect(result.location.name).toBe("New York City, NY");
    expect(result.sameAs).toBe("https://hashnyc.com");
  });

  it("omits null fields", () => {
    const result = buildKennelJsonLd({
      fullName: "Test H3",
      shortName: "TH3",
      slug: "th3",
      region: "Test, TX",
      foundedYear: null,
      description: null,
      website: null,
    }, BASE_URL);

    expect(result.foundingDate).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.sameAs).toBeUndefined();
  });
});

describe("buildRegionItemListJsonLd", () => {
  it("builds ItemList with kennel URLs", () => {
    const result = buildRegionItemListJsonLd(
      "NYC",
      [{ slug: "nych3" }, { slug: "bkh3" }],
      BASE_URL,
    );

    expect(result["@type"]).toBe("ItemList");
    expect(result.numberOfItems).toBe(2);
    expect(result.itemListElement).toHaveLength(2);
    expect(result.itemListElement[0].position).toBe(1);
    expect(result.itemListElement[0].url).toBe("https://hashtracks.xyz/kennels/nych3");
  });
});

describe("buildWebSiteJsonLd", () => {
  it("builds WebSite with SearchAction", () => {
    const result = buildWebSiteJsonLd(BASE_URL);

    expect(result["@type"]).toBe("WebSite");
    expect(result.potentialAction["@type"]).toBe("SearchAction");
    expect(result.potentialAction.target).toContain("{search_term_string}");
  });
});

describe("buildEventJsonLd", () => {
  const kennel = {
    shortName: "NYCH3",
    fullName: "New York City Hash House Harriers",
    slug: "nych3",
    region: "New York City, NY",
  };
  const baseEvent = {
    id: "evt_abc",
    date: new Date(Date.UTC(2026, 4, 9, 12, 0, 0)), // 2026-05-09 noon UTC
    startTime: "14:30",
    timezone: "America/New_York",
    title: "Spring Fling Trail",
    description: "Trail through Central Park.",
    locationName: "Central Park West Entrance",
    locationStreet: "Central Park W & W 72nd St, New York, NY 10023",
    locationAddress: null,
    latitude: 40.7769,
    longitude: -73.9762,
    status: "CONFIRMED" as const,
  };

  it("builds Event schema with required + recommended fields", () => {
    const result = buildEventJsonLd(baseEvent, kennel, BASE_URL);

    expect(result["@type"]).toBe("Event");
    expect(result.name).toBe("Spring Fling Trail");
    expect(result.startDate).toBe("2026-05-09T18:30:00.000Z"); // 14:30 EDT = 18:30 UTC
    expect(result.endDate).toBe("2026-05-09T20:30:00.000Z"); // +2h fallback
    expect(result.eventStatus).toBe("https://schema.org/EventScheduled");
    expect(result.eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
    expect(result.url).toBe("https://hashtracks.xyz/hareline/evt_abc");
    expect(result.organizer.name).toBe("New York City Hash House Harriers");
    expect(result.organizer.url).toBe("https://hashtracks.xyz/kennels/nych3");
    expect(result.description).toBe("Trail through Central Park.");
    expect(result.location).toMatchObject({
      "@type": "Place",
      name: "Central Park West Entrance",
      address: "Central Park W & W 72nd St, New York, NY 10023",
      geo: { "@type": "GeoCoordinates", latitude: 40.7769, longitude: -73.9762 },
    });
  });

  it("maps CANCELLED status to schema.org/EventCancelled", () => {
    const result = buildEventJsonLd({ ...baseEvent, status: "CANCELLED" }, kennel, BASE_URL);
    expect(result.eventStatus).toBe("https://schema.org/EventCancelled");
  });

  it("falls back to UTC noon when startTime/timezone are missing", () => {
    const result = buildEventJsonLd(
      { ...baseEvent, startTime: null, timezone: null },
      kennel,
      BASE_URL,
    );
    expect(result.startDate).toBe("2026-05-09T12:00:00.000Z");
    expect(result.endDate).toBe("2026-05-09T14:00:00.000Z");
  });

  it("omits geo when coordinates are missing", () => {
    const result = buildEventJsonLd(
      { ...baseEvent, latitude: null, longitude: null },
      kennel,
      BASE_URL,
    );
    expect(result.location).not.toHaveProperty("geo");
  });

  it("falls back to kennel region as address when locationStreet missing", () => {
    const result = buildEventJsonLd(
      { ...baseEvent, locationStreet: null },
      kennel,
      BASE_URL,
    );
    expect(result.location.address).toBe("New York City, NY");
  });

  it("uses generated name when title is missing", () => {
    const result = buildEventJsonLd({ ...baseEvent, title: null }, kennel, BASE_URL);
    expect(result.name).toBe("NYCH3 Trail");
  });

  it("omits description when missing", () => {
    const result = buildEventJsonLd({ ...baseEvent, description: null }, kennel, BASE_URL);
    expect(result.description).toBeUndefined();
  });
});

describe("generateRegionIntro", () => {
  it("generates intro with active kennel count and schedule summary", () => {
    const result = generateRegionIntro("New York City, NY", 11, [
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]);
    expect(result).toContain("New York City, NY");
    expect(result).toContain("11");
    expect(result).toContain("every day of the week");
  });

  it("handles single day", () => {
    const result = generateRegionIntro("Denver, CO", 3, ["Saturday"]);
    expect(result).toContain("3");
    expect(result).toContain("Saturdays");
  });

  it("handles two days", () => {
    const result = generateRegionIntro("London, UK", 5, ["Saturday", "Sunday"]);
    expect(result).toContain("Saturdays and Sundays");
  });

  it("handles no schedule data", () => {
    const result = generateRegionIntro("Test Region", 2, []);
    expect(result).not.toContain("undefined");
    expect(result).toContain("2");
  });
});
