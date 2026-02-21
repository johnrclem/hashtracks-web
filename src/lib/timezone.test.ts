import { describe, it, expect } from "vitest";
import { composeUtcStart, formatTimeInZone, isValidTimezone } from "./timezone";

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
});
