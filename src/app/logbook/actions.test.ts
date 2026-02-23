import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──

const mockUser = { id: "user_1", clerkId: "clerk_1", email: "test@test.com" };

vi.mock("@/lib/auth", () => ({
  getOrCreateUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    attendance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    kennelHasherLink: { findMany: vi.fn() },
    kennelAttendance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  checkIn,
  rsvp,
  confirmAttendance,
  deleteAttendance,
  getPendingConfirmations,
  confirmMismanAttendance,
  declineMismanAttendance,
} from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockEventFind = vi.mocked(prisma.event.findUnique);
const mockAttFind = vi.mocked(prisma.attendance.findUnique);
const mockAttCreate = vi.mocked(prisma.attendance.create);
const mockAttUpdate = vi.mocked(prisma.attendance.update);
const mockAttDelete = vi.mocked(prisma.attendance.delete);

// Helper: create a UTC noon date for a given offset from today
function utcNoonDate(daysOffset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysOffset,
    12, 0, 0,
  ));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T15:00:00Z"));
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── checkIn ──

describe("checkIn", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await checkIn("evt_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when event not found", async () => {
    mockEventFind.mockResolvedValueOnce(null);
    const result = await checkIn("evt_missing");
    expect(result).toEqual({ error: "Event not found" });
  });

  it("returns error for future events", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(3) } as never);
    const result = await checkIn("evt_1");
    expect(result).toEqual({ error: "Can only check in to today's or past events" });
  });

  it("allows check-in for today's event", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(0) } as never);
    mockAttFind.mockResolvedValueOnce(null);
    mockAttCreate.mockResolvedValueOnce({ id: "att_1" } as never);

    const result = await checkIn("evt_1");
    expect(result).toEqual({ success: true, attendanceId: "att_1" });
    expect(mockAttCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "CONFIRMED", participationLevel: "RUN" }),
    });
  });

  it("allows check-in for past events", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(-5) } as never);
    mockAttFind.mockResolvedValueOnce(null);
    mockAttCreate.mockResolvedValueOnce({ id: "att_1" } as never);

    const result = await checkIn("evt_1");
    expect(result).toEqual({ success: true, attendanceId: "att_1" });
  });

  it("upgrades INTENDING to CONFIRMED for past event", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(-1) } as never);
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "INTENDING",
    } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);

    const result = await checkIn("evt_1", "HARE");
    expect(result).toEqual({ success: true, attendanceId: "att_1" });
    expect(mockAttUpdate).toHaveBeenCalledWith({
      where: { id: "att_1" },
      data: { status: "CONFIRMED", participationLevel: "HARE" },
    });
  });

  it("is idempotent for already-CONFIRMED attendance", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(-1) } as never);
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "CONFIRMED",
    } as never);

    const result = await checkIn("evt_1");
    expect(result).toEqual({ success: true, attendanceId: "att_1" });
    expect(mockAttUpdate).not.toHaveBeenCalled();
    expect(mockAttCreate).not.toHaveBeenCalled();
  });

  it("validates participationLevel — invalid falls back to RUN", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(-1) } as never);
    mockAttFind.mockResolvedValueOnce(null);
    mockAttCreate.mockResolvedValueOnce({ id: "att_1" } as never);

    await checkIn("evt_1", "BOGUS_LEVEL");
    expect(mockAttCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ participationLevel: "RUN" }),
    });
  });
});

// ── rsvp ──

describe("rsvp", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await rsvp("evt_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error for past events", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(-1) } as never);
    const result = await rsvp("evt_1");
    expect(result).toEqual({ error: "Can only RSVP to future events" });
  });

  it("returns error for today's event (use check-in instead)", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(0) } as never);
    const result = await rsvp("evt_1");
    expect(result).toEqual({ error: "Can only RSVP to future events" });
  });

  it("creates INTENDING attendance for future event", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(3) } as never);
    mockAttFind.mockResolvedValueOnce(null);
    mockAttCreate.mockResolvedValueOnce({ id: "att_1" } as never);

    const result = await rsvp("evt_1");
    expect(result).toEqual({ success: true, attendanceId: "att_1", toggled: "on" });
    expect(mockAttCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "INTENDING" }),
    });
  });

  it("toggles off INTENDING attendance", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(3) } as never);
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "INTENDING",
    } as never);
    mockAttDelete.mockResolvedValueOnce({} as never);

    const result = await rsvp("evt_1");
    expect(result).toEqual({ success: true, toggled: "off" });
    expect(mockAttDelete).toHaveBeenCalledWith({ where: { id: "att_1" } });
  });

  it("does not toggle off CONFIRMED attendance", async () => {
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", date: utcNoonDate(3) } as never);
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "CONFIRMED",
    } as never);

    const result = await rsvp("evt_1");
    expect(result).toEqual({ success: true, attendanceId: "att_1" });
    expect(mockAttDelete).not.toHaveBeenCalled();
  });
});

// ── confirmAttendance ──

describe("confirmAttendance", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await confirmAttendance("att_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when attendance not found", async () => {
    mockAttFind.mockResolvedValueOnce(null);
    const result = await confirmAttendance("att_missing");
    expect(result).toEqual({ error: "Attendance not found" });
  });

  it("returns error when not owner", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "other_user", status: "INTENDING",
      event: { date: utcNoonDate(-1) },
    } as never);

    const result = await confirmAttendance("att_1");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("returns error when already confirmed", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "CONFIRMED",
      event: { date: utcNoonDate(-1) },
    } as never);

    const result = await confirmAttendance("att_1");
    expect(result).toEqual({ error: "Already confirmed" });
  });

  it("returns error when event is still in the future", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "INTENDING",
      event: { date: utcNoonDate(3) },
    } as never);

    const result = await confirmAttendance("att_1");
    expect(result).toEqual({ error: "Event hasn't happened yet" });
  });

  it("upgrades INTENDING to CONFIRMED for past event", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "INTENDING",
      participationLevel: "WALK",
      event: { date: utcNoonDate(-1) },
    } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);

    const result = await confirmAttendance("att_1");
    expect(result).toEqual({ success: true });
    expect(mockAttUpdate).toHaveBeenCalledWith({
      where: { id: "att_1" },
      data: { status: "CONFIRMED", participationLevel: "WALK" },
    });
  });

  it("allows confirmation for today's event", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "INTENDING",
      participationLevel: "RUN",
      event: { date: utcNoonDate(0) },
    } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);

    const result = await confirmAttendance("att_1");
    expect(result).toEqual({ success: true });
  });

  it("uses provided participationLevel when confirming", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "INTENDING",
      participationLevel: "RUN",
      event: { date: utcNoonDate(-1) },
    } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);

    await confirmAttendance("att_1", "BAG_HERO");
    expect(mockAttUpdate).toHaveBeenCalledWith({
      where: { id: "att_1" },
      data: { status: "CONFIRMED", participationLevel: "BAG_HERO" },
    });
  });
});

// ── deleteAttendance ──

describe("deleteAttendance", () => {
  it("returns error when not owner", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "other_user",
    } as never);

    const result = await deleteAttendance("att_1");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("deletes attendance when owner", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1",
    } as never);
    mockAttDelete.mockResolvedValueOnce({} as never);

    const result = await deleteAttendance("att_1");
    expect(result).toEqual({ success: true });
    expect(mockAttDelete).toHaveBeenCalledWith({ where: { id: "att_1" } });
  });
});

// ── updateAttendance ──

import { updateAttendance } from "./actions";

describe("updateAttendance", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await updateAttendance("att_1", { participationLevel: "HARE" });
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when attendance not found", async () => {
    mockAttFind.mockResolvedValueOnce(null);
    const result = await updateAttendance("att_missing", {});
    expect(result).toEqual({ error: "Attendance not found" });
  });

  it("returns error when not owner", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "other_user",
    } as never);
    const result = await updateAttendance("att_1", {});
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("updates participationLevel only", async () => {
    mockAttFind.mockResolvedValueOnce({ id: "att_1", userId: "user_1" } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);
    const result = await updateAttendance("att_1", { participationLevel: "HARE" });
    expect(result).toEqual({ success: true });
    expect(mockAttUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ participationLevel: "HARE" }),
      }),
    );
  });

  it("updates stravaUrl only", async () => {
    mockAttFind.mockResolvedValueOnce({ id: "att_1", userId: "user_1" } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);
    const result = await updateAttendance("att_1", { stravaUrl: "https://strava.com/123" });
    expect(result).toEqual({ success: true });
    expect(mockAttUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stravaUrl: "https://strava.com/123" }),
      }),
    );
  });

  it("updates notes only", async () => {
    mockAttFind.mockResolvedValueOnce({ id: "att_1", userId: "user_1" } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);
    const result = await updateAttendance("att_1", { notes: "Great trail" });
    expect(result).toEqual({ success: true });
  });

  it("validates invalid participationLevel falls back to RUN", async () => {
    mockAttFind.mockResolvedValueOnce({ id: "att_1", userId: "user_1" } as never);
    mockAttUpdate.mockResolvedValueOnce({} as never);
    await updateAttendance("att_1", { participationLevel: "INVALID" });
    expect(mockAttUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ participationLevel: "RUN" }),
      }),
    );
  });
});

// ── getPendingConfirmations ──

describe("getPendingConfirmations", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await getPendingConfirmations();
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns empty when user has no confirmed links", async () => {
    vi.mocked(prisma.kennelHasherLink.findMany).mockResolvedValueOnce([]);
    const result = await getPendingConfirmations();
    expect(result.data).toEqual([]);
  });

  it("returns pending records for linked hashers, excluding already-confirmed", async () => {
    vi.mocked(prisma.kennelHasherLink.findMany).mockResolvedValueOnce([
      { kennelHasherId: "kh_1" },
    ] as never);

    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([
      {
        id: "ka_1",
        kennelHasherId: "kh_1",
        eventId: "evt_1",
        haredThisTrail: false,
        event: {
          id: "evt_1",
          date: new Date("2026-02-10"),
          title: "Monday Hash",
          runNumber: 100,
          kennel: { shortName: "NYCH3" },
        },
      },
      {
        id: "ka_2",
        kennelHasherId: "kh_1",
        eventId: "evt_2",
        haredThisTrail: true,
        event: {
          id: "evt_2",
          date: new Date("2026-02-03"),
          title: "Super Bowl Hash",
          runNumber: 99,
          kennel: { shortName: "NYCH3" },
        },
      },
    ] as never);

    // User already checked in to evt_1
    vi.mocked(prisma.attendance.findMany).mockResolvedValueOnce([
      { eventId: "evt_1" },
    ] as never);

    const result = await getPendingConfirmations();
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual(
      expect.objectContaining({
        kennelAttendanceId: "ka_2",
        eventId: "evt_2",
        kennelShortName: "NYCH3",
        haredThisTrail: true,
      }),
    );
  });
});

// ── confirmMismanAttendance ──

describe("confirmMismanAttendance", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await confirmMismanAttendance("ka_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when misman record not found", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce(null);
    const result = await confirmMismanAttendance("ka_missing");
    expect(result).toEqual({ error: "Attendance record not found" });
  });

  it("returns error when no confirmed link to hasher", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "other_user", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    const result = await confirmMismanAttendance("ka_1");
    expect(result).toEqual({ error: "Not authorized — no confirmed link to this hasher" });
  });

  it("creates logbook entry with correct participation level", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: true,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "user_1", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    // No existing logbook entry
    mockAttFind.mockResolvedValueOnce(null);
    mockAttCreate.mockResolvedValueOnce({ id: "att_new" } as never);

    const result = await confirmMismanAttendance("ka_1");
    expect(result).toEqual({ success: true, attendanceId: "att_new" });
    expect(mockAttCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        eventId: "evt_1",
        status: "CONFIRMED",
        participationLevel: "HARE",
        isVerified: true,
        verifiedBy: "misman_1",
      }),
    });
  });

  it("is idempotent when logbook entry already exists", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "user_1", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    // Already has logbook entry
    mockAttFind.mockResolvedValueOnce({ id: "att_existing" } as never);

    const result = await confirmMismanAttendance("ka_1");
    expect(result).toEqual({ success: true, attendanceId: "att_existing" });
    expect(mockAttCreate).not.toHaveBeenCalled();
  });

  it("returns error when event is cancelled", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "user_1", status: "CONFIRMED" },
      },
      event: { status: "CANCELLED" },
    } as never);

    mockAttFind.mockResolvedValueOnce(null);

    const result = await confirmMismanAttendance("ka_1");
    expect(result).toEqual({ error: "Event was cancelled" });
    expect(mockAttCreate).not.toHaveBeenCalled();
  });
});

// ── confirmAttendance: cancelled event guard ──

describe("confirmAttendance — cancelled event", () => {
  it("returns error when event is cancelled", async () => {
    mockAttFind.mockResolvedValueOnce({
      id: "att_1", userId: "user_1", status: "INTENDING",
      participationLevel: "RUN",
      event: { date: utcNoonDate(-1), status: "CANCELLED" },
    } as never);

    const result = await confirmAttendance("att_1");
    expect(result).toEqual({ error: "Event was cancelled" });
    expect(mockAttUpdate).not.toHaveBeenCalled();
  });
});

// ── getPendingConfirmations: cancelled event filtering ──

describe("getPendingConfirmations — cancelled event filtering", () => {
  it("excludes cancelled events from pending confirmations", async () => {
    vi.mocked(prisma.kennelHasherLink.findMany).mockResolvedValueOnce([
      { kennelHasherId: "kh_1" },
    ] as never);

    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([
      {
        id: "ka_1",
        kennelHasherId: "kh_1",
        eventId: "evt_1",
        haredThisTrail: false,
        event: {
          id: "evt_1",
          date: new Date("2026-02-10"),
          title: "Active Hash",
          runNumber: 100,
          status: "CONFIRMED",
          kennel: { shortName: "NYCH3" },
        },
      },
    ] as never);

    vi.mocked(prisma.attendance.findMany).mockResolvedValueOnce([] as never);

    const result = await getPendingConfirmations();
    // The query itself filters cancelled events, so we just verify
    // the where clause was called correctly
    expect(vi.mocked(prisma.kennelAttendance.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event: { status: { not: "CANCELLED" } },
        }),
      }),
    );
    expect(result.data).toHaveLength(1);
  });
});

// ── declineMismanAttendance ──

describe("declineMismanAttendance", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await declineMismanAttendance("ka_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when misman record not found", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce(null);
    const result = await declineMismanAttendance("ka_missing");
    expect(result).toEqual({ error: "Attendance record not found" });
  });

  it("returns error when no confirmed link to hasher", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "other_user", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    const result = await declineMismanAttendance("ka_1");
    expect(result).toEqual({ error: "Not authorized — no confirmed link to this hasher" });
  });

  it("creates DECLINED attendance record", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "user_1", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    mockAttFind.mockResolvedValueOnce(null);
    mockAttCreate.mockResolvedValueOnce({ id: "att_declined" } as never);

    const result = await declineMismanAttendance("ka_1");
    expect(result).toEqual({ success: true });
    expect(mockAttCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        eventId: "evt_1",
        status: "DECLINED",
        participationLevel: "RUN",
      }),
    });
  });

  it("is idempotent when logbook entry already exists", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "user_1", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    mockAttFind.mockResolvedValueOnce({ id: "att_existing" } as never);

    const result = await declineMismanAttendance("ka_1");
    expect(result).toEqual({ success: true });
    expect(mockAttCreate).not.toHaveBeenCalled();
  });

  it("returns success without creating when user already confirmed", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "user_1", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    mockAttFind.mockResolvedValueOnce({
      id: "att_existing",
      status: "CONFIRMED",
    } as never);

    const result = await declineMismanAttendance("ka_1");
    expect(result).toEqual({ success: true });
    expect(mockAttCreate).not.toHaveBeenCalled();
  });

  it("handles P2002 race condition gracefully", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
      eventId: "evt_1",
      haredThisTrail: false,
      recordedBy: "misman_1",
      kennelHasher: {
        userLink: { userId: "user_1", status: "CONFIRMED" },
      },
      event: { status: "CONFIRMED" },
    } as never);

    // No existing attendance — will attempt create
    mockAttFind.mockResolvedValueOnce(null);

    // Simulate concurrent insert winning the race
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "0.0.0" },
    );
    mockAttCreate.mockRejectedValueOnce(p2002);

    const result = await declineMismanAttendance("ka_1");
    expect(result).toEqual({ success: true });
  });
});
