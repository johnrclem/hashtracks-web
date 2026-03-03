import { describe, it, expect } from "vitest";
import { parseKennelDirectory } from "./kennel-directory-parser";

/**
 * Build a realistic page snippet with the Google Maps JS pattern.
 * Each location is a triple: LatLng → Marker with title → InfoWindow with HTML.
 */
function buildPageSource(
  locations: Array<{
    id: number;
    lat: number;
    lng: number;
    title: string;
    kennels: Array<{ slug: string; name: string; schedule?: string }>;
  }>,
): string {
  const lines: string[] = [
    "<html><head></head><body><script>",
    "var kennelMap = new google.maps.Map(document.getElementById('map'));",
    "var infowindow = new google.maps.InfoWindow();",
  ];

  for (const loc of locations) {
    lines.push(
      `var loc${loc.id}Pos = new google.maps.LatLng(${loc.lat},${loc.lng});`,
    );
    lines.push(
      `var loc${loc.id}Marker = new google.maps.Marker({position: loc${loc.id}Pos, map: kennelMap, title: '${loc.title}'});`,
    );

    const kennelHtml = loc.kennels
      .map(
        (k) =>
          `<li><h4><a href="/kennels/${k.slug}/">${k.name}</a></h4>${k.schedule ? `<p>${k.schedule}</p>` : ""}</li>`,
      )
      .join("");
    const content = `<h3>${loc.title}</h3><ul>${kennelHtml}</ul>`;

    lines.push(
      `google.maps.event.addListener(loc${loc.id}Marker, 'click', function() { infowindow.setContent('${content}'); });`,
    );
  }

  lines.push("</script></body></html>");
  return lines.join("\n");
}

describe("parseKennelDirectory", () => {
  it("parses a single kennel from a single location", () => {
    const page = buildPageSource([
      {
        id: 1,
        lat: 38.9,
        lng: -77.0,
        title: "Washington, DC, USA",
        kennels: [{ slug: "EWH3", name: "Everyday Is Wednesday H3", schedule: "Weekly, Wednesdays" }],
      },
    ]);

    const result = parseKennelDirectory(page);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slug: "EWH3",
      name: "Everyday Is Wednesday H3",
      location: "Washington, DC, USA",
      latitude: 38.9,
      longitude: -77.0,
      schedule: "Weekly, Wednesdays",
      url: "https://hashrego.com/kennels/EWH3/",
    });
  });

  it("parses multiple kennels from a single location", () => {
    const page = buildPageSource([
      {
        id: 1,
        lat: 40.7,
        lng: -74.0,
        title: "New York, NY, USA",
        kennels: [
          { slug: "NYCH3", name: "New York City H3", schedule: "Weekly, Saturdays" },
          { slug: "NYRG", name: "New York Road Gangsters", schedule: "Monthly, Sundays" },
          { slug: "LIH3", name: "Long Island H3" },
        ],
      },
    ]);

    const result = parseKennelDirectory(page);
    expect(result).toHaveLength(3);
    expect(result[0].slug).toBe("NYCH3");
    expect(result[1].slug).toBe("NYRG");
    expect(result[2].slug).toBe("LIH3");
    expect(result[2].schedule).toBeUndefined();
    // All share the same location coords
    expect(result.every((k) => k.latitude === 40.7)).toBe(true);
    expect(result.every((k) => k.longitude === -74.0)).toBe(true);
  });

  it("parses multiple locations", () => {
    const page = buildPageSource([
      {
        id: 1,
        lat: 38.9,
        lng: -77.0,
        title: "Washington, DC, USA",
        kennels: [{ slug: "EWH3", name: "Everyday Is Wednesday H3" }],
      },
      {
        id: 2,
        lat: 51.5,
        lng: -0.1,
        title: "London, England",
        kennels: [{ slug: "LH3", name: "London Hash" }],
      },
    ]);

    const result = parseKennelDirectory(page);
    expect(result).toHaveLength(2);

    const dc = result.find((k) => k.slug === "EWH3")!;
    expect(dc.location).toBe("Washington, DC, USA");
    expect(dc.latitude).toBe(38.9);

    const london = result.find((k) => k.slug === "LH3")!;
    expect(london.location).toBe("London, England");
    expect(london.latitude).toBe(51.5);
  });

  it("handles negative coordinates", () => {
    const page = buildPageSource([
      {
        id: 1,
        lat: -33.86,
        lng: 151.2,
        title: "Sydney, Australia",
        kennels: [{ slug: "SydH3", name: "Sydney H3" }],
      },
    ]);

    const result = parseKennelDirectory(page);
    expect(result[0].latitude).toBe(-33.86);
    expect(result[0].longitude).toBe(151.2);
  });

  it("handles escaped single quotes in info window HTML", () => {
    // Hash Rego escapes single quotes in JS strings
    const page = [
      "<script>",
      "var loc1Pos = new google.maps.LatLng(42.3,-71.0);",
      "var loc1Marker = new google.maps.Marker({position: loc1Pos, map: kennelMap, title: 'Boston, MA, USA'});",
      "google.maps.event.addListener(loc1Marker, 'click', function() { infowindow.setContent('<h3>Boston, MA, USA</h3><ul><li><h4><a href=\"/kennels/BOSH3/\">Boston\\'s H3</a></h4></li></ul>'); });",
      "</script>",
    ].join("\n");

    const result = parseKennelDirectory(page);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Boston's H3");
  });

  it("returns empty array for empty page", () => {
    expect(parseKennelDirectory("")).toEqual([]);
    expect(parseKennelDirectory("<html></html>")).toEqual([]);
  });

  it("returns empty array when no locations match the pattern", () => {
    const page = "<script>var x = 1; var y = 2;</script>";
    expect(parseKennelDirectory(page)).toEqual([]);
  });

  it("skips locations with missing coordinates", () => {
    // Only title and info window, no LatLng
    const page = [
      "<script>",
      "var loc1Marker = new google.maps.Marker({position: loc1Pos, map: kennelMap, title: 'Nowhere'});",
      "google.maps.event.addListener(loc1Marker, 'click', function() { infowindow.setContent('<ul><li><h4><a href=\"/kennels/X/\">X H3</a></h4></li></ul>'); });",
      "</script>",
    ].join("\n");

    expect(parseKennelDirectory(page)).toEqual([]);
  });

  it("skips li elements without a /kennels/ link", () => {
    const page = buildPageSource([
      {
        id: 1,
        lat: 0,
        lng: 0,
        title: "Test",
        kennels: [],
      },
    ]);
    // Inject a li without a kennel link
    const modified = page.replace("<ul></ul>", '<ul><li><a href="/events/">Event Link</a></li></ul>');
    expect(parseKennelDirectory(modified)).toEqual([]);
  });

  it("handles whitespace in coordinates", () => {
    const page = [
      "<script>",
      "var loc1Pos = new google.maps.LatLng( 61.218 , -149.900 );",
      "var loc1Marker = new google.maps.Marker({position: loc1Pos, map: kennelMap, title: 'Anchorage, AK, USA'});",
      "google.maps.event.addListener(loc1Marker, 'click', function() { infowindow.setContent('<ul><li><h4><a href=\"/kennels/AncH3/\">Anchorage H3</a></h4><p>Monthly, Full Moons</p></li></ul>'); });",
      "</script>",
    ].join("\n");

    const result = parseKennelDirectory(page);
    expect(result).toHaveLength(1);
    expect(result[0].latitude).toBeCloseTo(61.218);
    expect(result[0].longitude).toBeCloseTo(-149.9);
    expect(result[0].schedule).toBe("Monthly, Full Moons");
  });

  it("constructs correct Hash Rego URL for each kennel", () => {
    const page = buildPageSource([
      {
        id: 1,
        lat: 0,
        lng: 0,
        title: "Test",
        kennels: [{ slug: "BFMH3", name: "Ben Franklin Mob" }],
      },
    ]);

    const result = parseKennelDirectory(page);
    expect(result[0].url).toBe("https://hashrego.com/kennels/BFMH3/");
  });

  it("handles large location IDs (double-digit)", () => {
    const page = buildPageSource([
      {
        id: 42,
        lat: 35.7,
        lng: 139.7,
        title: "Tokyo, Japan",
        kennels: [{ slug: "TKH3", name: "Tokyo H3", schedule: "Weekly, Mondays" }],
      },
    ]);

    const result = parseKennelDirectory(page);
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("TKH3");
    expect(result[0].location).toBe("Tokyo, Japan");
  });
});
