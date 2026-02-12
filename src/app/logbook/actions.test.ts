import { describe, it, expect, vi, beforeEach } from "vitest";

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
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkIn, rsvp, confirmAttendance, deleteAttendance } from "./actions";

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
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
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
