/**
 * Client-safe types and type guards for GenericHtmlAdapter configs.
 *
 * Separated from `./generic` (which imports server-only utils like
 * fetchHTMLPage) so client components — e.g., SourceOnboardingWizard /
 * ConfigureAndTest — can import the type guard without pulling in
 * Node built-ins (`node:dns`) through the server-side fetch stack.
 */

/** Date locale for `chrono-node` parsing. Mirrors the union defined in `../utils`. */
export type DateLocale = "en-US" | "en-GB";

/** Column selectors for extracting event fields from each row. */
export interface GenericHtmlColumns {
  date: string;             // required — CSS selector (e.g., "td:nth-child(2)")
  kennelTag?: string;
  title?: string;
  hares?: string;
  location?: string;
  locationUrl?: string;     // extracts href from <a>
  startTime?: string;
  runNumber?: string;
  sourceUrl?: string;       // extracts href from <a>
}

/** Config shape stored in Source.config for generic HTML sources. */
export interface GenericHtmlConfig {
  containerSelector: string;  // CSS selector for the event container
  rowSelector: string;        // CSS selector for each row within container
  columns: GenericHtmlColumns;
  defaultKennelTag: string;
  dateLocale?: DateLocale;    // "en-US" | "en-GB" — defaults to "en-US"
  locationTruncateAfter?: "uk-postcode";  // truncate location at first UK postcode match
  defaultStartTime?: string;               // "HH:MM" fallback when page doesn't have per-event times
  forwardDate?: boolean;                   // resolve year-less dates to next future occurrence
  maxPastDays?: number;                    // skip events with dates more than N days in the past
  stopWhenRunNumberDecreases?: boolean;    // stop parsing when run number drops (e.g., Cape Fear receding hareline)
}

/** Type guard: does this config look like a GenericHtmlConfig? */
export function isGenericHtmlConfig(
  config: unknown,
): boolean {
  if (!config || typeof config !== "object") return false;
  const obj = config as Record<string, unknown>;
  return (
    typeof obj.containerSelector === "string" &&
    typeof obj.rowSelector === "string" &&
    typeof obj.columns === "object" &&
    obj.columns !== null &&
    !Array.isArray(obj.columns)
  );
}
