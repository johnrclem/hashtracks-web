import type { SourceType } from "@/generated/prisma/client";
import type { SourceAdapter } from "./types";
import { HashNYCAdapter } from "./html-scraper/hashnyc";
import { GoogleCalendarAdapter } from "./google-calendar/adapter";
import { GoogleSheetsAdapter } from "./google-sheets/adapter";

const adapters: Partial<Record<SourceType, () => SourceAdapter>> = {
  HTML_SCRAPER: () => new HashNYCAdapter(),
  GOOGLE_CALENDAR: () => new GoogleCalendarAdapter(),
  GOOGLE_SHEETS: () => new GoogleSheetsAdapter(),
};

export function getAdapter(sourceType: SourceType): SourceAdapter {
  const factory = adapters[sourceType];
  if (!factory) {
    throw new Error(`Adapter not implemented for source type: ${sourceType}`);
  }
  return factory();
}
