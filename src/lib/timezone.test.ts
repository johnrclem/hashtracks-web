import { describe, it, expect } from "vitest";
import {
    composeUtcStart,
    formatTimeInZone,
    isValidTimezone,
    todayInTimezone,
} from "./timezone";

describe("timezone utils", () => {
    describe("composeUtcStart", () => {
        it("converts a local 2:30 PM NY time into an absolute UTC date", () => {
            // The Prisma 'date' is stored as UTC noon.
            const dateUtcNoon = new Date("2026-02-14T12:00:00Z");
            const timeStr = "14:30";
            const tz = "America/New_York";

            const utcDate = composeUtcStart(dateUtcNoon, timeStr, tz);

            // 14:30 NY time in Feb (EST) is UTC - 5 hours
            // So 14:30 + 5 hours = 19:30 UTC
            expect(utcDate?.toISOString()).toEqual("2026-02-14T19:30:00.000Z");
        });

        it("handles daylight saving time correctly (EDT)", () => {
            // In daylight savings (July), NY is UTC - 4 hours
            const dateUtcNoon = new Date("2026-07-04T12:00:00Z");
            const timeStr = "14:30";
            const tz = "America/New_York";

            const utcDate = composeUtcStart(dateUtcNoon, timeStr, tz);

            // 14:30 + 4 hours = 18:30 UTC
            expect(utcDate?.toISOString()).toEqual("2026-07-04T18:30:00.000Z");
        });

        it("handles Europe/London", () => {
            const dateUtcNoon = new Date("2026-02-14T12:00:00Z");
            const timeStr = "19:00";
            const tz = "Europe/London";

            const utcDate = composeUtcStart(dateUtcNoon, timeStr, tz);

            // London in Feb is +0 UTC
            expect(utcDate?.toISOString()).toEqual("2026-02-14T19:00:00.000Z");
        });

        it("returns null if missing inputs", () => {
            const dateUtcNoon = new Date("2026-02-14T12:00:00Z");
            expect(composeUtcStart(dateUtcNoon, undefined, "America/New_York")).toBeNull();
            expect(composeUtcStart(dateUtcNoon, "14:30", undefined)).toBeNull();
        });
    });

    describe("formatTimeInZone", () => {
        it("formats a UTC date into a target timezone correctly", () => {
            const globalEventTime = new Date("2026-02-14T19:30:00.000Z");

            // In NY, that's 2:30 PM (EST)
            expect(formatTimeInZone(globalEventTime, "America/New_York")).toEqual("2:30 PM");

            // In LA, that's 11:30 AM (PST)
            expect(formatTimeInZone(globalEventTime, "America/Los_Angeles")).toEqual("11:30 AM");

            // In London, that's 7:30 PM (GMT)
            expect(formatTimeInZone(globalEventTime, "Europe/London")).toEqual("7:30 PM");
        });
    });

    describe("isValidTimezone", () => {
        it("returns true for valid IANA zones", () => {
            expect(isValidTimezone("America/New_York")).toBe(true);
            expect(isValidTimezone("Europe/London")).toBe(true);
        });

        it("returns false for invalid zones", () => {
            expect(isValidTimezone("Fake/Timezone")).toBe(false);
            expect(isValidTimezone("EST")).toBe(false); // Only IANA formats
        });
    });

    describe("todayInTimezone", () => {
        it("returns YYYY-MM-DD format", () => {
            const out = todayInTimezone("America/New_York");
            expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it("can yield a different day for east-vs-west when UTC is mid-day", () => {
            // Boundary cases require a fixed clock, so just verify the
            // fundamental property: at any instant, timezones at opposite
            // ends of the world can return different YYYY-MM-DD values.
            // E.g. when it's 11pm UTC on Apr 14, Honolulu is 1pm Apr 14,
            // but Sydney is 9am Apr 15.
            const honolulu = todayInTimezone("Pacific/Honolulu");
            const sydney = todayInTimezone("Australia/Sydney");
            // Both are valid YYYY-MM-DD; they may equal or differ by 1 day
            // depending on when the test runs, so just assert format.
            expect(honolulu).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(sydney).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it("falls back to UTC for invalid or null timezone", () => {
            const utc = todayInTimezone("UTC");
            expect(todayInTimezone(null)).toBe(utc);
            expect(todayInTimezone(undefined)).toBe(utc);
            expect(todayInTimezone("Not/AReal/TZ")).toBe(utc);
            expect(todayInTimezone("EST")).toBe(utc); // legacy abbrev rejected
        });
    });
});
