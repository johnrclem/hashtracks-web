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

export function finding(
  event: AuditEventRow,
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
    eventUrl: HARELINE_BASE_URL,
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

const CTA_PATTERN =
  /^(?:tbd|tba|tbc|n\/a|sign[\s\u00A0]*up!?|volunteer|needed|required)$/i;
const BOILERPLATE_MARKERS = [
  "WHAT TIME",
  "WHERE",
  "HASH CASH",
  "Location",
  "Directions",
];

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
