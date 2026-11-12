import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1", clerkId: "clerk_admin", email: "admin@test.com" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/pipeline/kennel-evidence", () => ({ refreshKennelEvidence: vi.fn() }));

const tx = {
  $queryRaw: vi.fn(),
  kennel: { findUnique: vi.fn() },
  source: { findMany: vi.fn(), updateMany: vi.fn() },
  scheduleRule: { findMany: vi.fn(), updateMany: vi.fn() },
  kennelConfirmation: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refreshKennelEvidence } from "@/pipeline/kennel-evidence";
import { revalidatePath, revalidateTag } from "next/cache";
import { confirmKennelRunning, stopKennel, restartKennel } from "./status-actions";

const goodInput = { observedOn: "2026-11-01", note: "Hare posted on their Facebook page" };
const noEvidence = { id: "k1", lastRunSeenAt: null, lastConfirmedAt: null, nextRunPostedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  vi.mocked(getAdminUser).mockResolvedValue(mockAdmin as never);
  vi.mocked(prisma.kennel.findUnique).mockResolvedValue({ id: "k1", slug: "k-h3", region: "Nowhere" } as never);
  tx.kennel.findUnique.mockResolvedValue(noEvidence);
  tx.kennelConfirmation.findFirst.mockResolvedValue(null);
  tx.source.findMany.mockResolvedValue([]);
  tx.scheduleRule.findMany.mockResolvedValue([]);
});

describe("kennel status actions", () => {
  it("non-admins are rejected", async () => {
    vi.mocked(getAdminUser).mockResolvedValue(null as never);
    expect(await confirmKennelRunning("k1", goodInput)).toEqual({ error: "Not authorized" });
    expect(await stopKennel("k1", goodInput)).toEqual({ error: "Not authorized" });
    expect(await restartKennel("k1")).toEqual({ error: "Not authorized" });
    expect(tx.kennelConfirmation.create).not.toHaveBeenCalled();
  });

  it("rejects a future observedOn, a note under 3 or over 500 characters, and a non-http(s) url", async () => {
    const bad = [
      { ...goodInput, observedOn: "2026-11-14" },
      { ...goodInput, observedOn: "not-a-date" },
      { ...goodInput, note: "  ab " },
      { ...goodInput, note: "x".repeat(501) },
      { ...goodInput, url: "javascript:alert(1)" },
      { ...goodInput, url: "ftp://example.com/x" },
    ];
    for (const input of bad) {
      expect(await confirmKennelRunning("k1", input)).toHaveProperty("error");
      expect(await stopKennel("k1", input)).toHaveProperty("error");
    }
    expect(tx.kennelConfirmation.create).not.toHaveBeenCalled();
  });

  it("confirmKennelRunning stores a RUNNING confirmation at UTC noon and refreshes that kennel", async () => {
    const result = await confirmKennelRunning("k1", { ...goodInput, url: "https://example.com/post" });
    expect(result).toEqual({ success: true });
    expect(tx.kennelConfirmation.create).toHaveBeenCalledWith({
      data: {
        kennelId: "k1",
        kind: "RUNNING",
        observedAt: new Date("2026-11-01T12:00:00Z"),
        note: goodInput.note,
        url: "https://example.com/post",
        createdById: "admin_1",
      },
    });
    expect(refreshKennelEvidence).toHaveBeenCalledWith(["k1"], expect.any(Date));
    expect(revalidatePath).toHaveBeenCalledWith("/admin/kennels");
    expect(revalidateTag).toHaveBeenCalled();
  });

  it("stopKennel refuses when HashTracks saw a run after observedOn", async () => {
    tx.kennel.findUnique.mockResolvedValue({ ...noEvidence, lastRunSeenAt: new Date("2026-11-03T12:00:00Z") });
    const result = await stopKennel("k1", goodInput);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("saw a run on Nov 3");
    expect(tx.kennelConfirmation.create).not.toHaveBeenCalled();
    expect(refreshKennelEvidence).not.toHaveBeenCalled();
  });

  it("stopKennel also refuses on a later confirmation or posted run, but allows same-day evidence", async () => {
    tx.kennel.findUnique.mockResolvedValue({ ...noEvidence, lastConfirmedAt: new Date("2026-11-05T12:00:00Z") });
    expect(await stopKennel("k1", goodInput)).toHaveProperty("error");
    tx.kennel.findUnique.mockResolvedValue({ ...noEvidence, nextRunPostedAt: new Date("2026-11-20T12:00:00Z") });
    expect(await stopKennel("k1", goodInput)).toHaveProperty("error");
    tx.kennel.findUnique.mockResolvedValue({ ...noEvidence, lastRunSeenAt: new Date("2026-11-01T12:00:00Z") });
    expect(await stopKennel("k1", goodInput)).toMatchObject({ success: true });
  });

  it("stopKennel disables only STATIC_SCHEDULE sources linked to this kennel alone, and deactivates its active rules, recording both id lists", async () => {
    tx.source.findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    tx.scheduleRule.findMany.mockResolvedValue([{ id: "r1" }]);
    const result = await stopKennel("k1", goodInput);
    expect(result).toEqual({ success: true, disabledSources: 2, deactivatedRules: 1 });
    expect(tx.source.findMany).toHaveBeenCalledWith({
      where: {
        type: "STATIC_SCHEDULE",
        enabled: true,
        kennels: { some: { kennelId: "k1" } },
        NOT: { kennels: { some: { kennelId: { not: "k1" } } } },
      },
      select: { id: true },
    });
    expect(tx.scheduleRule.findMany).toHaveBeenCalledWith({
      where: { kennelId: "k1", isActive: true },
      select: { id: true },
    });
    expect(tx.source.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["s1", "s2"] } }, data: { enabled: false } });
    expect(tx.scheduleRule.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["r1"] } }, data: { isActive: false } });
    expect(tx.kennelConfirmation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "STOPPED",
        observedAt: new Date("2026-11-01T12:00:00Z"),
        disabledSourceIds: ["s1", "s2"],
        deactivatedRuleIds: ["r1"],
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(refreshKennelEvidence).toHaveBeenCalledWith(["k1"], expect.any(Date));
  });

  it("restartKennel re-enables the union of all open stops' sources and rules and reverts each", async () => {
    tx.kennelConfirmation.findMany.mockResolvedValue([
      { id: "c2", disabledSourceIds: [], deactivatedRuleIds: [] },
      { id: "c1", disabledSourceIds: ["s1"], deactivatedRuleIds: ["r1", "r2"] },
    ]);
    const result = await restartKennel("k1");
    expect(result).toEqual({ success: true, enabledSources: 1, reactivatedRules: 2 });
    expect(tx.kennelConfirmation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kennelId: "k1", kind: "STOPPED", revertedAt: null } }),
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.source.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["s1"] } }, data: { enabled: true } });
    expect(tx.scheduleRule.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["r1", "r2"] } }, data: { isActive: true } });
    expect(tx.kennelConfirmation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c2", "c1"] } },
      data: { revertedAt: expect.any(Date) },
    });
    expect(refreshKennelEvidence).toHaveBeenCalledWith(["k1"], expect.any(Date));
  });

  it("stopKennel refuses while an un-reverted stop exists, and locks the kennel row first", async () => {
    tx.kennelConfirmation.findFirst.mockResolvedValue({ id: "c1" });
    const result = await stopKennel("k1", goodInput);
    expect(result).toEqual({ error: "Already stopped — restart it first." });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.kennelConfirmation.create).not.toHaveBeenCalled();
    expect(refreshKennelEvidence).not.toHaveBeenCalled();
  });

  it("a failed evidence refresh after the write still reports success and is logged", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      vi.mocked(refreshKennelEvidence).mockRejectedValueOnce(new Error("connection reset"));
    }
    tx.kennelConfirmation.findMany.mockResolvedValue([
      { id: "c1", disabledSourceIds: ["s1"], deactivatedRuleIds: [] },
    ]);

    expect(await confirmKennelRunning("k1", goodInput)).toEqual({ success: true });
    expect(await stopKennel("k1", goodInput)).toEqual({ success: true, disabledSources: 0, deactivatedRules: 0 });
    expect(await restartKennel("k1")).toEqual({ success: true, enabledSources: 1, reactivatedRules: 0 });

    expect(refreshKennelEvidence).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("evidence refresh failed"),
      { kennelId: "k1" },
      expect.any(Error),
    );
    // The actions still finish: audit + cache busts run after the refresh.
    expect(revalidatePath).toHaveBeenCalledWith("/admin/kennels");
    consoleError.mockRestore();
  });

  it("restartKennel errors when there is no un-reverted stop", async () => {
    tx.kennelConfirmation.findMany.mockResolvedValue([]);
    const result = await restartKennel("k1");
    expect(result).toHaveProperty("error");
    expect(tx.source.updateMany).not.toHaveBeenCalled();
    expect(refreshKennelEvidence).not.toHaveBeenCalled();
  });
});
