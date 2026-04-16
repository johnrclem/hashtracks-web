import { tz } from "@date-fns/tz";
import { format, parse } from "date-fns";

/**
 * Creates an exact global UTC Date representing the start time of an event.
 * 
 * @param dateUtcNoon The date part (stored in DB as UTC noon of the local day)
 * @param timeStr Local time string "HH:MM" (24-hour)
 * @param timezone IANA timezone string (e.g., "America/New_York")
 * @returns An absolute Date object representing the global start time
 */
export function composeUtcStart(
    dateUtcNoon: Date,
    timeStr: string | null | undefined,
    timezone: string | null | undefined
): Date | null {
    if (!timeStr || !timezone) return null;

    try {
        const timezoneObj = tz(timezone);
        // Extract YYYY-MM-DD from the UTC noon date
        const yyyyMmDd = format(dateUtcNoon, "yyyy-MM-dd", { in: tz("UTC") });

        // Create a naive local string (e.g. "2026-02-14 14:30")
        const localString = `${yyyyMmDd} ${timeStr}`;

        // Using date-fns parse with the timezone object
        const zonedDate = parse(localString, "yyyy-MM-dd HH:mm", new Date(), { in: timezoneObj });

        // The returned zonedDate is a Date object but its string representation 
        // might be tz-aware. We just want the absolute JS Date instance (which is always UTC under the hood).
        return new Date(zonedDate.getTime());
    } catch (err) {
        console.warn(`Failed to compose UTC start for ${timeStr} in ${timezone}`, err);
        return null;
    }
}

/**
 * Gets the user's local timezone from their browser setting.
 */
export function getBrowserTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return "America/New_York"; // Safe fallback
    }
}

/**
 * Formats an absolute Date object into a readable time string in a specific timezone.
 */
export function formatTimeInZone(date: Date, timezone: string, fmt = "h:mm a"): string {
    try {
        return format(date, fmt, { in: tz(timezone) });
    } catch {
        return format(date, fmt); // Fallback to system local if error
    }
}

/**
 * Formats an absolute Date object into a readable date string in a specific timezone.
 */
export function formatDateInZone(date: Date, timezone: string, fmt = "EEE, MMM d"): string {
    try {
        return format(date, fmt, { in: tz(timezone) });
    } catch {
        return format(date, fmt); // Fallback to system local if error
    }
}

/**
 * Gets a short abbreviation for a given timezone at a specific point in time (e.g. EST/EDT).
 */
export function getTimezoneAbbreviation(date: Date, timezone: string): string {
    try {
        const parts = Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            timeZoneName: "short",
        }).formatToParts(date);

        const tzPart = parts.find(p => p.type === "timeZoneName");
        return tzPart ? tzPart.value : "";
    } catch {
        return "";
    }
}

/**
 * Returns "today" as YYYY-MM-DD in the given IANA timezone. Used for trip
 * status comparisons (isPast / isSoon) so a Hawaii trip ending 2026-04-14
 * stays "active" while it's still 2026-04-14 in Honolulu, even after UTC
 * has rolled into 2026-04-15.
 *
 * en-CA + 2-digit components yields YYYY-MM-DD reliably across modern Node
 * and browsers. Falls back to the UTC date if the tz is invalid.
 */
export function todayInTimezone(timezone: string | null | undefined): string {
    const tz = timezone && isValidTimezone(timezone) ? timezone : "UTC";
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

/**
 * Validates whether a provided string is a valid IANA timezone.
 */
export function isValidTimezone(timezone: string): boolean {
    if (!timezone || typeof timezone !== "string") return false;
    // Require IANA format (Region/City) — reject legacy abbreviations like "EST"
    if (timezone !== "UTC" && !timezone.includes("/")) return false;

    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}
