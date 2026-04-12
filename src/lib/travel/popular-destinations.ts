/**
 * Curated popular destinations for the Travel Mode landing page.
 * Static data — no DB query needed. Coordinates are approximate city centers.
 */

export interface PopularDestination {
  slug: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  kennelCount: number;
  teaser: string;
  pinColor: string;
}

export const POPULAR_DESTINATIONS: PopularDestination[] = [
  {
    slug: "washington-dc",
    city: "Washington, DC",
    country: "USA",
    latitude: 38.907,
    longitude: -77.037,
    kennelCount: 10,
    teaser: "EWH3, DCH4, and a packed weekly calendar year-round.",
    pinColor: "#2563eb",
  },
  {
    slug: "london",
    city: "London, UK",
    country: "UK",
    latitude: 51.507,
    longitude: -0.128,
    kennelCount: 31,
    teaser: "Dense hash network — something running almost every night.",
    pinColor: "#7c3aed",
  },
  {
    slug: "new-york",
    city: "New York, NY",
    country: "USA",
    latitude: 40.713,
    longitude: -74.006,
    kennelCount: 11,
    teaser: "Five boroughs, half a dozen kennels a week.",
    pinColor: "#6366f1",
  },
  {
    slug: "san-francisco",
    city: "San Francisco, CA",
    country: "USA",
    latitude: 37.775,
    longitude: -122.418,
    kennelCount: 13,
    teaser: "Bay Area trails from the city to the coast, every week.",
    pinColor: "#0ea5e9",
  },
  {
    slug: "singapore",
    city: "Singapore",
    country: "SG",
    latitude: 1.352,
    longitude: 103.82,
    kennelCount: 7,
    teaser: "Father Hash — second hash kennel founded on earth.",
    pinColor: "#10b981",
  },
  {
    slug: "tokyo",
    city: "Tokyo, JP",
    country: "JP",
    latitude: 35.682,
    longitude: 139.692,
    kennelCount: 4,
    teaser: "Wednesday urban trails and full-moon specials.",
    pinColor: "#eab308",
  },
  {
    slug: "berlin",
    city: "Berlin, DE",
    country: "DE",
    latitude: 52.52,
    longitude: 13.405,
    kennelCount: 2,
    teaser: "Founded 1980 — the oldest hash in continental Europe.",
    pinColor: "#ef4444",
  },
  {
    slug: "bangkok",
    city: "Bangkok, TH",
    country: "TH",
    latitude: 13.756,
    longitude: 100.502,
    kennelCount: 8,
    teaser: "Home to some of the oldest hashes in Asia.",
    pinColor: "#ec4899",
  },
];
