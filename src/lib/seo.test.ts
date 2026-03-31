import {
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
