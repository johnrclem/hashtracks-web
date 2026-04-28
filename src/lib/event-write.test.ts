import { describe, it, expect, vi } from "vitest";
import { createEventWithKennel } from "./event-write";

describe("createEventWithKennel", () => {
  it("calls event.create once with a nested EventKennel write (one round-trip)", async () => {
    const tx = {
      event: {
        create: vi.fn().mockResolvedValue({ id: "evt-1", kennelId: "k-1" }),
      },
    };

    const result = await createEventWithKennel(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      { kennelId: "k-1", date: new Date(Date.UTC(2026, 0, 1, 12)), trustLevel: 5 },
    );

    expect(tx.event.create).toHaveBeenCalledOnce();
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kennelId: "k-1",
        eventKennels: { create: { kennelId: "k-1", isPrimary: true } },
      }),
    });
    expect(result).toEqual({ id: "evt-1", kennelId: "k-1" });
  });

  it("propagates Prisma create failure (caller's surrounding tx, if any, rolls back)", async () => {
    const tx = {
      event: {
        create: vi.fn().mockRejectedValue(
          new Error("partial unique index violation: another row has isPrimary=true"),
        ),
      },
    };

    await expect(
      createEventWithKennel(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx as any,
        { kennelId: "k-1", date: new Date(), trustLevel: 5 },
      ),
    ).rejects.toThrow(/partial unique index/);
  });
});
