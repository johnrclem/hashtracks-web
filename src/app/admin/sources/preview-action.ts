"use server";

import { getAdminUser } from "@/lib/auth";
import { getAdapter } from "@/adapters/registry";
import { validateSourceConfig } from "./config-validation";
import { computeFillRates } from "@/pipeline/fill-rates";
import {
  resolveKennelTag,
  clearResolverCache,
} from "@/pipeline/kennel-resolver";
import type { SourceType, Source } from "@/generated/prisma/client";
import type { FieldFillRates } from "@/pipeline/fill-rates";
import type { ErrorDetails } from "@/adapters/types";

export interface PreviewEvent {
  date: string;
  kennelTag: string;
  title?: string;
  location?: string;
  hares?: string;
  startTime?: string;
  resolved: boolean;
  /** DB kennel ID when tag resolved — enables reliable auto-selection */
  resolvedKennelId?: string;
}

export interface PreviewData {
  events: PreviewEvent[];
  totalCount: number;
  errors: string[];
  errorDetails?: ErrorDetails;
  diagnosticContext?: Record<string, unknown>;
  unmatchedTags: string[];
  fillRates: FieldFillRates;
  sampleRows?: string[][]; // First 10 raw CSV rows (Google Sheets only — for Gemini column detection)
}

const MAX_PREVIEW_EVENTS = 25;
const PREVIEW_LOOKBACK_DAYS = 30;

/** Parse and validate config JSON for preview. */
function parsePreviewConfig(
  configRaw: string,
  type: string,
): { config: Record<string, unknown> | null; error?: string } {
  let config: Record<string, unknown> | null = null;
  if (configRaw) {
    try {
      config = JSON.parse(configRaw);
    } catch {
      return { config: null, error: "Invalid JSON in config field" };
    }
    if (config !== null && (typeof config !== "object" || Array.isArray(config))) {
      return { config: null, error: "Config must be a JSON object" };
    }
  }
  const configErrors = validateSourceConfig(type, config);
  if (configErrors.length > 0) {
    return { config: null, error: `Config validation failed: ${configErrors.join("; ")}` };
  }
  return { config };
}

/** Resolve all unique kennel tags and return resolution map + unmatched list. */
async function resolvePreviewTags(
  events: Array<{ kennelTag: string }>,
): Promise<{ tagResolution: Map<string, { matched: boolean; kennelId: string | null }>; unmatchedTags: string[] }> {
  clearResolverCache();
  const uniqueTags = [...new Set(events.map((e) => e.kennelTag))];
  const tagResults = await Promise.all(
    uniqueTags.map(async (tag) => {
      const { matched, kennelId } = await resolveKennelTag(tag);
      return { tag, matched, kennelId };
    }),
  );
  const tagResolution = new Map<string, { matched: boolean; kennelId: string | null }>();
  tagResults.forEach(({ tag, matched, kennelId }) =>
    tagResolution.set(tag, { matched, kennelId }),
  );
  const unmatchedTags = uniqueTags.filter((t) => !tagResolution.get(t)?.matched);
  return { tagResolution, unmatchedTags };
}

export async function previewSourceConfig(
  formData: FormData,
): Promise<{ data?: PreviewData; error?: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const type = String(formData.get("type") || "").trim();
  const url = String(formData.get("url") || "").trim();
  const configRaw = String(formData.get("config") || "").trim();

  if (!type || !url) {
    return { error: "Type and URL are required for preview" };
  }

  if (type !== "GOOGLE_CALENDAR") {
    const urlError = validatePreviewUrl(url);
    if (urlError) return { error: urlError };
  }

  const { config, error: configError } = parsePreviewConfig(configRaw, type);
  if (configError) return { error: configError };

  const mockSource = {
    id: "preview",
    name: "Preview",
    url,
    type: type as SourceType,
    config,
    trustLevel: 5,
    scrapeFreq: "daily",
    scrapeDays: PREVIEW_LOOKBACK_DAYS,
    healthStatus: "UNKNOWN",
    lastScrapeAt: null,
    lastSuccessAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Source;

  let adapter;
  try {
    adapter = getAdapter(type as SourceType, url);
  } catch (e) {
    return {
      error: `No adapter found for ${type}${url ? ` (${url})` : ""}: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  let result;
  try {
    result = await adapter.fetch(mockSource, { days: PREVIEW_LOOKBACK_DAYS });
  } catch (e) {
    return {
      error: `Adapter fetch failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  const fillRates = computeFillRates(result.events);
  const { tagResolution, unmatchedTags } = await resolvePreviewTags(result.events);

  // Build preview events (capped at MAX_PREVIEW_EVENTS)
  const previewEvents: PreviewEvent[] = result.events
    .slice(0, MAX_PREVIEW_EVENTS)
    .map((e) => ({
      date: e.date,
      kennelTag: e.kennelTag,
      title: e.title,
      location: e.location,
      hares: e.hares,
      startTime: e.startTime,
      resolved: tagResolution.get(e.kennelTag)?.matched ?? false,
      resolvedKennelId: tagResolution.get(e.kennelTag)?.kennelId ?? undefined,
    }));

  return {
    data: {
      events: previewEvents,
      totalCount: result.events.length,
      errors: result.errors,
      errorDetails: result.errorDetails,
      diagnosticContext: result.diagnosticContext,
      unmatchedTags,
      fillRates,
      sampleRows: result.sampleRows,
    },
  };
}

/** Validate URL for SSRF protection: only http/https, no private IPs */
function validatePreviewUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL format";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http and https URLs are allowed";
  }

  const hostname = parsed.hostname;

  // Block localhost and loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    return "URLs pointing to localhost are not allowed";
  }

  // Block private IP ranges (10.x, 172.16-31.x, 192.168.x)
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 169 && b === 254 // link-local
    ) {
      return "URLs pointing to private IP addresses are not allowed";
    }
  }

  return null;
}
