import type { RawEventData } from "@/adapters/types";
import type { CalendarEvent } from "@/lib/calendar";
import type {
  KennelHasher,
  KennelAttendance,
  MismanRequest,
  KennelHasherLink,
} from "@/generated/prisma/client";

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

export const mockMismanUser = {
  ...mockUser,
  id: "misman_1",
  clerkId: "clerk_misman",
  email: "misman@test.com",
  hashName: "Trail Boss",
  nerdName: "Mike Manager",
};

export function buildKennelHasher(
  overrides?: Partial<KennelHasher>,
): KennelHasher {
  return {
    id: "kh_1",
    rosterGroupId: "rg_1",
    kennelId: "kennel_1",
    hashName: "Mudflap",
    nerdName: "John Doe",
    email: null,
    phone: null,
    notes: null,
    mergeLog: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function buildKennelAttendance(
  overrides?: Partial<KennelAttendance>,
): KennelAttendance {
  return {
    id: "ka_1",
    kennelHasherId: "kh_1",
    eventId: "event_1",
    paid: false,
    haredThisTrail: false,
    isVirgin: false,
    isVisitor: false,
    visitorLocation: null,
    referralSource: null,
    referralOther: null,
    recordedBy: "misman_1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function buildMismanRequest(
  overrides?: Partial<MismanRequest>,
): MismanRequest {
  return {
    id: "mr_1",
    userId: "user_1",
    kennelId: "kennel_1",
    message: "I'm the misman for this kennel",
    status: "PENDING",
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function buildKennelHasherLink(
  overrides?: Partial<KennelHasherLink>,
): KennelHasherLink {
  return {
    id: "khl_1",
    kennelHasherId: "kh_1",
    userId: "user_1",
    status: "SUGGESTED",
    suggestedBy: "system",
    confirmedBy: null,
    dismissedBy: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}
