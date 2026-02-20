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

export interface PreviewEvent {
  date: string;
  kennelTag: string;
  title?: string;
  location?: string;
  hares?: string;
  startTime?: string;
  resolved: boolean;
}

export interface PreviewData {
  events: PreviewEvent[];
  totalCount: number;
  errors: string[];
  unmatchedTags: string[];
  fillRates: FieldFillRates;
}

const MAX_PREVIEW_EVENTS = 25;
const PREVIEW_LOOKBACK_DAYS = 30;

export async function previewSourceConfig(
  formData: FormData,
): Promise<{ data?: PreviewData; error?: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const type = (formData.get("type") as string)?.trim();
  const url = (formData.get("url") as string)?.trim();
  const configRaw = (formData.get("config") as string)?.trim() || "";

  if (!type || !url) {
    return { error: "Type and URL are required for preview" };
  }

  // Parse config JSON
  let config: Record<string, unknown> | null = null;
  if (configRaw) {
    try {
      config = JSON.parse(configRaw);
    } catch {
      return { error: "Invalid JSON in config field" };
    }
  }

  // Validate config
  const configErrors = validateSourceConfig(type, config);
  if (configErrors.length > 0) {
    return { error: `Config validation failed: ${configErrors.join("; ")}` };
  }

  // Build mock Source object — adapters only access url, config, type, scrapeDays
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

  // Get adapter and fetch events
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

  // Compute fill rates
  const fillRates = computeFillRates(result.events);

  // Resolve kennel tags (read-only DB queries)
  clearResolverCache();
  const tagResolution = new Map<string, boolean>();
  const uniqueTags = [...new Set(result.events.map((e) => e.kennelTag))];
  for (const tag of uniqueTags) {
    const { matched } = await resolveKennelTag(tag);
    tagResolution.set(tag, matched);
  }

  const unmatchedTags = uniqueTags.filter((t) => !tagResolution.get(t));

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
      resolved: tagResolution.get(e.kennelTag) ?? false,
    }));

  return {
    data: {
      events: previewEvents,
      totalCount: result.events.length,
      errors: result.errors,
      unmatchedTags,
      fillRates,
    },
  };
}
