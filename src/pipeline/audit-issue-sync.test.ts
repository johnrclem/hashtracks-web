import { describe, it, expect } from "vitest";
import { AuditStream, AuditIssueEventType } from "@/generated/prisma/client";
import {
  extractLabelNames,
  resolveStream,
  resolveKennel,
  diffIssue,
} from "./audit-issue-sync";

describe("audit-issue-sync — pure helpers", () => {
  describe("extractLabelNames", () => {
    it("normalizes the GH labels union (objects + strings)", () => {
      expect(extractLabelNames([{ name: "audit" }, "alert", { name: "audit:automated" }])).toEqual([
        "audit",
        "alert",
        "audit:automated",
      ]);
    });
  });

  describe("resolveStream", () => {
    it.each([
      ["audit:automated", AuditStream.AUTOMATED],
      ["audit:chrome-event", AuditStream.CHROME_EVENT],
      ["audit:chrome-kennel", AuditStream.CHROME_KENNEL],
    ])("maps %s → %s", (label, expected) => {
      expect(resolveStream(["audit", "alert", label])).toBe(expected);
    });

    it("falls back to UNKNOWN when no sub-label is present", () => {
      expect(resolveStream(["audit", "alert"])).toBe(AuditStream.UNKNOWN);
    });

    it("ignores label order — first sub-label wins, others are no-ops", () => {
      expect(resolveStream(["audit:chrome-kennel", "audit", "audit:automated"])).toBe(
        AuditStream.CHROME_KENNEL,
      );
    });
  });

  describe("resolveKennel", () => {
    it("extracts the kennelCode from a kennel:<code> label", () => {
      expect(resolveKennel(["audit", "kennel:agnews"])).toBe("agnews");
    });

    it("returns null when no kennel label is present", () => {
      expect(resolveKennel(["audit", "alert"])).toBeNull();
    });
  });

  describe("diffIssue", () => {
    const NOW = new Date("2026-04-09T12:00:00Z");
    const OPENED_AT = new Date("2026-04-01T10:00:00Z");
    const CLOSED_AT = new Date("2026-04-05T10:00:00Z");

    it("emits OPENED for a brand-new still-open issue", () => {
      const events = diffIssue(
        null,
        {
          stream: AuditStream.CHROME_EVENT,
          state: "open",
          githubCreatedAt: OPENED_AT,
          githubClosedAt: null,
        },
        NOW,
      );
      expect(events).toEqual([
        {
          type: AuditIssueEventType.OPENED,
          stream: AuditStream.CHROME_EVENT,
          occurredAt: OPENED_AT,
          fromStream: null,
        },
      ]);
    });

    it("emits OPENED + CLOSED when an issue's full lifecycle elapses between syncs", () => {
      const events = diffIssue(
        null,
        {
          stream: AuditStream.AUTOMATED,
          state: "closed",
          githubCreatedAt: OPENED_AT,
          githubClosedAt: CLOSED_AT,
        },
        NOW,
      );
      expect(events.map((e) => e.type)).toEqual([
        AuditIssueEventType.OPENED,
        AuditIssueEventType.CLOSED,
      ]);
      expect(events[0].occurredAt).toBe(OPENED_AT);
      expect(events[1].occurredAt).toBe(CLOSED_AT);
    });

    it("emits CLOSED with github.closed_at when an open issue is closed", () => {
      const events = diffIssue(
        { stream: AuditStream.AUTOMATED, state: "open", githubClosedAt: null },
        {
          stream: AuditStream.AUTOMATED,
          state: "closed",
          githubCreatedAt: OPENED_AT,
          githubClosedAt: CLOSED_AT,
        },
        NOW,
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: AuditIssueEventType.CLOSED,
        occurredAt: CLOSED_AT,
      });
    });

    it("emits REOPENED with `now` (no GH timestamp available)", () => {
      const events = diffIssue(
        { stream: AuditStream.CHROME_KENNEL, state: "closed", githubClosedAt: CLOSED_AT },
        {
          stream: AuditStream.CHROME_KENNEL,
          state: "open",
          githubCreatedAt: OPENED_AT,
          githubClosedAt: null,
        },
        NOW,
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: AuditIssueEventType.REOPENED,
        occurredAt: NOW,
      });
    });

    it("emits RELABELED with fromStream set when an operator changes the sub-label", () => {
      const events = diffIssue(
        { stream: AuditStream.UNKNOWN, state: "open", githubClosedAt: null },
        {
          stream: AuditStream.CHROME_KENNEL,
          state: "open",
          githubCreatedAt: OPENED_AT,
          githubClosedAt: null,
        },
        NOW,
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: AuditIssueEventType.RELABELED,
        stream: AuditStream.CHROME_KENNEL,
        fromStream: AuditStream.UNKNOWN,
      });
    });

    it("emits both CLOSED and RELABELED when state and stream both change", () => {
      const events = diffIssue(
        { stream: AuditStream.UNKNOWN, state: "open", githubClosedAt: null },
        {
          stream: AuditStream.AUTOMATED,
          state: "closed",
          githubCreatedAt: OPENED_AT,
          githubClosedAt: CLOSED_AT,
        },
        NOW,
      );
      expect(events.map((e) => e.type).sort()).toEqual(
        [AuditIssueEventType.CLOSED, AuditIssueEventType.RELABELED].sort(),
      );
    });

    it("idempotent: no changes → no events", () => {
      const events = diffIssue(
        { stream: AuditStream.AUTOMATED, state: "open", githubClosedAt: null },
        {
          stream: AuditStream.AUTOMATED,
          state: "open",
          githubCreatedAt: OPENED_AT,
          githubClosedAt: null,
        },
        NOW,
      );
      expect(events).toEqual([]);
    });
  });
});
