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
    } catch (err) {
        return format(date, fmt); // Fallback to system local if error
    }
}

/**
 * Formats an absolute Date object into a readable date string in a specific timezone.
 */
export function formatDateInZone(date: Date, timezone: string, fmt = "EEE, MMM d"): string {
    try {
        return format(date, fmt, { in: tz(timezone) });
    } catch (err) {
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
    } catch (err) {
        return "";
    }
}

/**
 * Validates whether a provided string is a valid IANA timezone.
 */
export function isValidTimezone(timezone: string): boolean {
    if (!timezone || typeof timezone !== "string") return false;
    // Basic sanity check to prevent "EST" and focus on IANA "Area/Location"
    if (!timezone.includes("/")) return false;

    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}
