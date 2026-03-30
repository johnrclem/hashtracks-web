export interface AuditEventRow {
  id: string;
  kennelShortName: string;
  haresText: string | null;
  title: string | null;
  description: string | null;
  locationName: string | null;
  locationCity: string | null;
  startTime: string | null;
  runNumber: number | null;
  date: string;
  sourceUrl: string | null;
  sourceType: string;
  kennelCode: string;
  scrapeDays: number;
}

export interface AuditFinding {
  kennelShortName: string;
  eventId: string;
  eventUrl: string;
  sourceUrl: string | null;
  adapterType: string;
  category: "hares" | "title" | "location" | "event" | "description";
  field: string;
  currentValue: string;
  expectedValue?: string;
  rule: string;
  severity: "error" | "warning";
}

const HARELINE_BASE_URL = "https://www.hashtracks.xyz/hareline";

/** Minimal event shape needed by finding() — avoids requiring full AuditEventRow. */
type FindingEvent = Pick<AuditEventRow, "id" | "kennelShortName" | "sourceUrl" | "sourceType">;

export function finding(
  event: FindingEvent,
  params: {
    category: AuditFinding["category"];
    field: string;
    currentValue: string;
    rule: string;
    severity: AuditFinding["severity"];
    expectedValue?: string;
  }
): AuditFinding {
  return {
    kennelShortName: event.kennelShortName,
    eventId: event.id,
    eventUrl: `${HARELINE_BASE_URL}/${event.id}`,
    sourceUrl: event.sourceUrl,
    adapterType: event.sourceType,
    category: params.category,
    field: params.field,
    currentValue: params.currentValue,
    expectedValue: params.expectedValue,
    rule: params.rule,
    severity: params.severity,
  };
}

const TITLE_CTA_PATTERN =
  /\b(?:wanna\s+hare|available\s+dates|check\s+out\s+our|sign\s*up)\b/i;
const TITLE_SCHEDULE_PATTERN =
  /\b(?:runs?\s+on\s+the\s+(?:first|second|third|fourth|last)|meets?\s+every|hashes?\s+on\s+the|runs?\s+every)\b/i;
const TITLE_HTML_ENTITIES_PATTERN =
  /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/i;
const TITLE_TIME_ONLY_PATTERN =
  /^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$/i;

const CTA_PATTERN =
  /^(?:tbd|tba|tbc|n\/a|sign[\s\u00A0]*up!?|volunteer|needed|required)$/i;
const BOILERPLATE_MARKERS = [
  "WHAT TIME",
  "WHERE",
  "HASH CASH",
  "Location",
  "Directions",
];

export function checkTitleQuality(event: AuditEventRow): AuditFinding[] {
  const { title, kennelCode, kennelShortName } = event;

  // Skip events with null title
  if (title === null) {
    return [];
  }

  // 1. title-raw-kennel-code (error): title starts with `{kennelCode} Trail` but NOT with `{kennelShortName}`
  // Dynamic regex is necessary here — kennelCode varies per event. Input is escaped.
  const escapedCode = kennelCode.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const kennelCodeTrailPattern = new RegExp(
    `^${escapedCode}\\s+Trail`,
    "i"
  );
  if (
    kennelCodeTrailPattern.test(title) &&
    !title.startsWith(kennelShortName)
  ) {
    return [
      finding(event, {
        category: "title",
        field: "title",
        currentValue: title,
        rule: "title-raw-kennel-code",
        severity: "error",
        expectedValue: `${kennelShortName} Trail...`,
      }),
    ];
  }

  // 2. title-cta-text (warning)
  if (TITLE_CTA_PATTERN.test(title)) {
    return [
      finding(event, {
        category: "title",
        field: "title",
        currentValue: title,
        rule: "title-cta-text",
        severity: "warning",
      }),
    ];
  }

  // 3. title-schedule-description (warning)
  if (TITLE_SCHEDULE_PATTERN.test(title)) {
    return [
      finding(event, {
        category: "title",
        field: "title",
        currentValue: title,
        rule: "title-schedule-description",
        severity: "warning",
      }),
    ];
  }

  // 4. title-html-entities (warning)
  if (TITLE_HTML_ENTITIES_PATTERN.test(title)) {
    return [
      finding(event, {
        category: "title",
        field: "title",
        currentValue: title,
        rule: "title-html-entities",
        severity: "warning",
      }),
    ];
  }

  // 5. title-time-only (warning)
  if (TITLE_TIME_ONLY_PATTERN.test(title)) {
    return [
      finding(event, {
        category: "title",
        field: "title",
        currentValue: title,
        rule: "title-time-only",
        severity: "warning",
      }),
    ];
  }

  return [];
}

type LocationEventRow = Pick<
  AuditEventRow,
  "id" | "kennelShortName" | "locationName" | "locationCity" | "sourceUrl" | "sourceType"
>;

type EventQualityRow = Pick<
  AuditEventRow,
  "id" | "kennelShortName" | "startTime" | "date" | "sourceUrl" | "sourceType" | "scrapeDays"
>;

type DescriptionEventRow = Pick<
  AuditEventRow,
  "id" | "kennelShortName" | "description" | "sourceUrl" | "sourceType"
> & { rawDescription: string | null };

function normalizeSegment(s: string): string {
  return s
    .toLowerCase()
    .replaceAll(/\bnorth\b/g, "n")
    .replaceAll(/\bsouth\b/g, "s")
    .replaceAll(/\beast\b/g, "e")
    .replaceAll(/\bwest\b/g, "w")
    .replaceAll(/\broad\b/g, "rd")
    .replaceAll(/\bstreet\b/g, "st")
    .replaceAll(/\bavenue\b/g, "ave")
    .replaceAll(/\bboulevard\b/g, "blvd")
    .replaceAll(/\bplace\b/g, "pl")
    .replaceAll(/\bdrive\b/g, "dr")
    .replaceAll(/[.\s]+/g, " ")
    .trim();
}

export function checkLocationQuality(events: LocationEventRow[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const event of events) {
    const { locationName, locationCity } = event;

    if (locationName === null) continue;

    // 1. location-url: locationName starts with URL scheme
    if (locationName.startsWith("https://") || locationName.startsWith("http://")) {
      findings.push(
        finding(event, {
          category: "location",
          field: "locationName",
          currentValue: locationName,
          rule: "location-url",
          severity: "warning",
        })
      );
      continue;
    }

    // 2. location-duplicate-segments: >=3 parts, check if first two overlap
    const parts = locationName.split(", ");
    if (parts.length >= 3) {
      const a = normalizeSegment(parts[0]);
      const b = normalizeSegment(parts[1]);
      if (a.includes(b) || b.includes(a)) {
        findings.push(
          finding(event, {
            category: "location",
            field: "locationName",
            currentValue: locationName,
            rule: "location-duplicate-segments",
            severity: "warning",
          })
        );
        continue;
      }
    }

    // 3. location-region-appended: ends with `, XX` or `, XX NNNNN`, locationCity exists,
    //    and locationCity's city name is NOT found in locationName
    const regionAppendedPattern = /,\s*[A-Z]{2}(?:\s+\d{5})?$/;
    if (regionAppendedPattern.test(locationName) && locationCity) {
      const cityName = locationCity.split(",")[0].trim();
      if (!locationName.includes(cityName)) {
        findings.push(
          finding(event, {
            category: "location",
            field: "locationName+locationCity",
            currentValue: `${locationName}, ${locationCity}`,
            rule: "location-region-appended",
            severity: "warning",
            expectedValue: locationName,
          })
        );
        continue;
      }
    }
  }

  return findings;
}

export function checkEventQuality(events: EventQualityRow[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const event of events) {
    const { startTime } = event;

    if (startTime === null) continue;

    // 1. event-improbable-time: hour >= 23 or 0-3
    const hourStr = startTime.split(":")[0];
    const hour = Number.parseInt(hourStr, 10);
    if (!Number.isNaN(hour) && (hour >= 23 || hour <= 3)) {
      findings.push(
        finding(event, {
          category: "event",
          field: "startTime",
          currentValue: startTime,
          rule: "event-improbable-time",
          severity: "warning",
        })
      );
    }
  }

  return findings;
}

export function checkDescriptionQuality(events: DescriptionEventRow[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const event of events) {
    const { description, rawDescription } = event;

    // Skip events with no raw description or short raw description
    if (!rawDescription || rawDescription.length <= 20) continue;

    // 1. description-dropped: description is null but rawDescription is non-null and >20 chars
    if (description === null) {
      findings.push(
        finding(event, {
          category: "description",
          field: "description",
          currentValue: "(empty)",
          rule: "description-dropped",
          severity: "warning",
          expectedValue: `Raw data has ${rawDescription.length} chars`,
        })
      );
    }
  }

  return findings;
}

export function checkHareQuality(event: AuditEventRow): AuditFinding[] {
  const { haresText } = event;

  // Skip events with null haresText
  if (haresText === null) {
    return [];
  }

  // 1. hare-single-char (error): haresText is exactly 1 character
  if (haresText.length === 1) {
    return [
      finding(event, {
        category: "hares",
        field: "haresText",
        currentValue: haresText,
        rule: "hare-single-char",
        severity: "error",
      }),
    ];
  }

  // 2. hare-cta-text (warning): matches CTA pattern
  if (CTA_PATTERN.test(haresText)) {
    return [
      finding(event, {
        category: "hares",
        field: "haresText",
        currentValue: haresText,
        rule: "hare-cta-text",
        severity: "warning",
      }),
    ];
  }

  // 3. hare-url (warning): starts with https:// or http://
  if (haresText.startsWith("https://") || haresText.startsWith("http://")) {
    return [
      finding(event, {
        category: "hares",
        field: "haresText",
        currentValue: haresText,
        rule: "hare-url",
        severity: "warning",
      }),
    ];
  }

  // 4. hare-description-leak (warning): length > 200 chars
  if (haresText.length > 200) {
    return [
      finding(event, {
        category: "hares",
        field: "haresText",
        currentValue: haresText,
        rule: "hare-description-leak",
        severity: "warning",
      }),
    ];
  }

  // 5. hare-phone-number (warning): contains phone pattern
  if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(haresText)) {
    return [
      finding(event, {
        category: "hares",
        field: "haresText",
        currentValue: haresText,
        rule: "hare-phone-number",
        severity: "warning",
      }),
    ];
  }

  // 6. hare-boilerplate-leak (warning): contains boilerplate markers
  if (BOILERPLATE_MARKERS.some((marker) => haresText.includes(marker))) {
    return [
      finding(event, {
        category: "hares",
        field: "haresText",
        currentValue: haresText,
        rule: "hare-boilerplate-leak",
        severity: "warning",
      }),
    ];
  }

  return [];
}
