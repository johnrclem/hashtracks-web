import type { SerializedConfirmed } from "./serialize";

/** Minimal shape required to build a VEVENT from a confirmed search result. */
export interface ExportableConfirmedEvent {
  date: string;
  startTime: string | null;
  timezone: string | null;
  title: string | null;
  runNumber: number | null;
  haresText: string | null;
  locationName: string | null;
  sourceUrl: string | null;
  kennelName: string;
}

/**
 * Project a serialized confirmed search result to the minimal
 * `ExportableConfirmedEvent` shape the ICS builder needs. Both
 * /travel entry points (TravelResultsServer + SavedTripPage) use
 * this so the projection stays in one place and the interface above
 * remains the source of truth for which fields the exporter depends
 * on.
 *
 * Lives in a plain (non-`"use client"`) module so server components
 * — `src/app/travel/page.tsx` — can import it without crossing an
 * RSC boundary. The client-side `TripSummary` re-exports
 * `ExportableConfirmedEvent` for backward compatibility with the
 * external consumer shape.
 *
 * The param is typed as a `Pick` of `SerializedConfirmed` (not an
 * inline shape) so adding a field to `ExportableConfirmedEvent`
 * surfaces a compile error at the projection and forces the call
 * sites to opt in explicitly.
 */
export function toExportableConfirmedEvent(
  r: Pick<
    SerializedConfirmed,
    | "date"
    | "startTime"
    | "timezone"
    | "title"
    | "runNumber"
    | "haresText"
    | "locationName"
    | "sourceUrl"
    | "kennelName"
  >,
): ExportableConfirmedEvent {
  return {
    date: r.date,
    startTime: r.startTime,
    timezone: r.timezone,
    title: r.title,
    runNumber: r.runNumber,
    haresText: r.haresText,
    locationName: r.locationName,
    sourceUrl: r.sourceUrl,
    kennelName: r.kennelName,
  };
}
