import type { RawEventData } from "@/adapters/types";
import type { CalendarEvent } from "@/lib/calendar";

export function buildRawEvent(overrides?: Partial<RawEventData>): RawEventData {
  return {
    date: "2026-02-14",
    kennelTag: "NYCH3",
    runNumber: 2100,
    title: "Valentine's Day Trail",
    description: "A lovely trail",
    hares: "Mudflap",
    location: "Central Park",
    startTime: "14:00",
    sourceUrl: "https://hashnyc.com",
    ...overrides,
  };
}

export function buildCalendarEvent(overrides?: Partial<CalendarEvent>): CalendarEvent {
  return {
    title: "Valentine's Day Trail",
    date: "2026-02-14T12:00:00.000Z",
    startTime: "14:00",
    description: "A lovely trail",
    haresText: "Mudflap",
    locationName: "Central Park",
    sourceUrl: "https://hashnyc.com",
    kennel: { shortName: "NYCH3" },
    runNumber: 2100,
    ...overrides,
  };
}

export const mockUser = {
  id: "user_1",
  clerkId: "clerk_1",
  email: "test@test.com",
  hashName: null,
  nerdName: "Test User",
  bio: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

export const mockAdminUser = { ...mockUser, id: "admin_1", clerkId: "clerk_admin" };
