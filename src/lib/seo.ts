import type { Metadata } from "next";

const SITE_NAME = "HashTracks";
const DEFAULT_DESCRIPTION =
  "Find upcoming hash runs, track your attendance, and explore 176+ kennels worldwide. The hareline you never knew you needed.";

export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
}

export function buildCanonicalUrl(path: string): string {
  return `${getBaseUrl()}${path}`;
}

/** Root metadata defaults — used in layout.tsx */
export function getRootMetadata(): Metadata {
  const baseUrl = getBaseUrl();
  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: "HashTracks — Discover Hash Runs Near You",
      template: `%s · ${SITE_NAME}`,
    },
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [{ url: "/api/og", width: 1200, height: 630, alt: "HashTracks" }],
    },
    twitter: {
      card: "summary_large_image",
    },
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: baseUrl,
    },
  };
}

/** Build JSON-LD script tag content for a Schema.org Event */
export function buildEventJsonLd(event: {
  name: string;
  startDate: string; // ISO date
  startTime?: string | null; // "HH:MM"
  locationName?: string | null;
  locationAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  url: string;
  organizerName: string;
  organizerUrl?: string;
}) {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: event.name,
    startDate: event.startTime
      ? `${event.startDate}T${event.startTime}:00`
      : event.startDate,
    url: event.url,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    organizer: {
      "@type": "SportsOrganization",
      name: event.organizerName,
      ...(event.organizerUrl ? { url: event.organizerUrl } : {}),
    },
  };

  if (event.description) {
    jsonLd.description = event.description;
  }

  if (event.locationName || event.locationAddress) {
    jsonLd.location = {
      "@type": "Place",
      ...(event.locationName ? { name: event.locationName } : {}),
      ...(event.locationAddress
        ? {
            address: {
              "@type": "PostalAddress",
              streetAddress: event.locationAddress,
            },
          }
        : {}),
      ...(event.latitude && event.longitude
        ? {
            geo: {
              "@type": "GeoCoordinates",
              latitude: event.latitude,
              longitude: event.longitude,
            },
          }
        : {}),
    };
  }

  return jsonLd;
}

/** Build JSON-LD script tag content for a Schema.org Organization (kennel) */
export function buildKennelJsonLd(kennel: {
  name: string;
  shortName: string;
  description?: string | null;
  url: string;
  website?: string | null;
  logoUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  region: string;
}) {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: kennel.name,
    alternateName: kennel.shortName,
    url: kennel.url,
    sport: "Hash House Harriers",
  };

  if (kennel.description) jsonLd.description = kennel.description;
  if (kennel.logoUrl) jsonLd.logo = kennel.logoUrl;
  if (kennel.website) jsonLd.sameAs = [kennel.website];

  if (kennel.latitude && kennel.longitude) {
    jsonLd.location = {
      "@type": "Place",
      name: kennel.region,
      geo: {
        "@type": "GeoCoordinates",
        latitude: kennel.latitude,
        longitude: kennel.longitude,
      },
    };
  }

  return jsonLd;
}
