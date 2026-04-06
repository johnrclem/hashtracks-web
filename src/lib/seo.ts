import type { EventStatus } from "@/generated/prisma/client";
import { composeUtcStart } from "./timezone";

const CONTEXT = "https://schema.org";

/** Default event duration when endTime is unknown — most hash trails run ~90–120 min. */
const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Safely serialize JSON-LD for injection into a <script> tag.
 * Escapes </script> sequences to prevent stored XSS from DB values.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/<\/script/gi, "<\\/script");
}

// ── JSON-LD Builders ──

interface KennelJsonLdInput {
  fullName: string;
  shortName: string;
  slug: string;
  region: string;
  foundedYear: number | null;
  description: string | null;
  website: string | null;
}

export function buildKennelJsonLd(kennel: KennelJsonLdInput, baseUrl: string) {
  return {
    "@context": CONTEXT,
    "@type": "SportsTeam" as const,
    name: kennel.fullName,
    alternateName: kennel.shortName,
    url: `${baseUrl}/kennels/${kennel.slug}`,
    sport: "Hash House Harriers",
    location: {
      "@type": "Place" as const,
      name: kennel.region,
    },
    ...(kennel.foundedYear ? { foundingDate: String(kennel.foundedYear) } : {}),
    ...(kennel.description ? { description: kennel.description } : {}),
    ...(kennel.website ? { sameAs: kennel.website } : {}),
  };
}

export function buildRegionItemListJsonLd(
  regionName: string,
  kennels: { slug: string }[],
  baseUrl: string,
) {
  return {
    "@context": CONTEXT,
    "@type": "ItemList" as const,
    name: `Hash House Harrier Kennels in ${regionName}`,
    numberOfItems: kennels.length,
    itemListElement: kennels.map((k, i) => ({
      "@type": "ListItem" as const,
      position: i + 1,
      url: `${baseUrl}/kennels/${k.slug}`,
    })),
  };
}

export function buildWebSiteJsonLd(baseUrl: string) {
  return {
    "@context": CONTEXT,
    "@type": "WebSite" as const,
    name: "HashTracks",
    url: baseUrl,
    description: "Discover hash house harrier runs, track attendance, and find kennels worldwide.",
    potentialAction: {
      "@type": "SearchAction" as const,
      target: `${baseUrl}/kennels?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

interface EventJsonLdInput {
  id: string;
  date: Date;
  startTime: string | null;
  timezone: string | null;
  title: string | null;
  description: string | null;
  locationName: string | null;
  locationStreet: string | null;
  latitude: number | null;
  longitude: number | null;
  status: EventStatus;
}

interface EventJsonLdKennel {
  shortName: string;
  fullName: string;
  slug: string;
  region: string;
}

function mapEventStatus(status: EventStatus): string {
  // TENTATIVE in our model means "not yet confirmed" (not "postponed"), so the
  // closest schema.org value is EventScheduled.
  if (status === "CANCELLED") return "https://schema.org/EventCancelled";
  return "https://schema.org/EventScheduled";
}

/**
 * Build schema.org Event JSON-LD for a canonical Event detail page.
 *
 * Required by Google for Event rich results: name, startDate, location.
 * Recommended: endDate, eventStatus, eventAttendanceMode, organizer, description.
 *
 * Docs: https://developers.google.com/search/docs/appearance/structured-data/event
 */
export function buildEventJsonLd(
  event: EventJsonLdInput,
  kennel: EventJsonLdKennel,
  baseUrl: string,
) {
  // Prefer the precise zoned timestamp; fall back to UTC noon (our storage convention)
  // when startTime/timezone are missing.
  const baseDate = composeUtcStart(event.date, event.startTime, event.timezone) ?? event.date;
  const startDate = baseDate.toISOString();
  const endDate = new Date(baseDate.getTime() + DEFAULT_EVENT_DURATION_MS).toISOString();

  const name = event.title?.trim() || `${kennel.shortName} Trail`;
  const placeName = event.locationName?.trim() || `${kennel.shortName} start location`;

  const place: {
    "@type": "Place";
    name: string;
    address: string;
    geo?: { "@type": "GeoCoordinates"; latitude: number; longitude: number };
  } = {
    "@type": "Place",
    name: placeName,
    address: event.locationStreet ?? kennel.region,
  };
  if (typeof event.latitude === "number" && typeof event.longitude === "number") {
    place.geo = {
      "@type": "GeoCoordinates",
      latitude: event.latitude,
      longitude: event.longitude,
    };
  }

  return {
    "@context": CONTEXT,
    "@type": "Event" as const,
    name,
    startDate,
    endDate,
    eventStatus: mapEventStatus(event.status),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode" as const,
    location: place,
    // Required by Google for Event rich results carousel eligibility. Uses the
    // site-wide dynamic OG image (src/app/opengraph-image.tsx, 1200x630).
    image: `${baseUrl}/opengraph-image`,
    organizer: {
      "@type": "SportsOrganization" as const,
      name: kennel.fullName,
      url: `${baseUrl}/kennels/${kennel.slug}`,
    },
    url: `${baseUrl}/hareline/${event.id}`,
    ...(event.description ? { description: event.description } : {}),
  };
}

// ── Region Intro Generator ──

export function generateRegionIntro(
  regionName: string,
  activeKennelCount: number,
  scheduleDays: string[],
): string {
  const uniqueDays = [...new Set(scheduleDays)];
  const daysSummary = formatDaysSummary(uniqueDays);

  const kennelWord = activeKennelCount === 1 ? "kennel" : "kennels";

  if (daysSummary) {
    return `${regionName} has ${activeKennelCount} active ${kennelWord} with runs on ${daysSummary}. Find your next trail below.`;
  }
  return `${regionName} has ${activeKennelCount} active ${kennelWord}. Find your next trail below.`;
}

function formatDaysSummary(days: string[]): string {
  if (days.length === 0) return "";
  if (days.length >= 7) return "every day of the week";

  const pluralized = days.map((d) => d + "s");
  if (pluralized.length === 1) return pluralized[0];
  if (pluralized.length === 2) return `${pluralized[0]} and ${pluralized[1]}`;
  return `${pluralized.slice(0, -1).join(", ")}, and ${pluralized[pluralized.length - 1]}`;
}
