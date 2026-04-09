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
      expect(resolveStream(["audit", "alert", label])).toEqual({
        stream: expected,
        conflict: false,
      });
    });

    it("falls back to UNKNOWN when no sub-label is present", () => {
      expect(resolveStream(["audit", "alert"])).toEqual({
        stream: AuditStream.UNKNOWN,
        conflict: false,
      });
    });

    it("reports conflict + UNKNOWN when two stream labels are present", () => {
      // Previously the first match won (order-dependent); now we refuse to
      // guess and surface the misconfiguration to the sync caller.
      expect(
        resolveStream(["audit:chrome-kennel", "audit", "audit:automated"]),
      ).toEqual({ stream: AuditStream.UNKNOWN, conflict: true });
    });

    it("does not flag conflict when only one stream sub-label is present", () => {
      expect(resolveStream(["audit", "audit:chrome-event"])).toEqual({
        stream: AuditStream.CHROME_EVENT,
        conflict: false,
      });
    });
  });

  describe("resolveKennel", () => {
    const KNOWN = new Set(["agnews", "nych3", "philly-h3"]);

    it("returns the kennelCode when the label maps to a known kennel", () => {
      expect(resolveKennel(["audit", "kennel:agnews"], KNOWN)).toBe("agnews");
    });

    it("returns null when no kennel label is present", () => {
      expect(resolveKennel(["audit", "alert"], KNOWN)).toBeNull();
    });

    it("returns null when the label references an unknown kennel", () => {
      // Typo guard — previously this would be written into AuditIssue.kennelCode
      // as a broken FK and drop the issue from the mirror.
      expect(resolveKennel(["kennel:agnws"], KNOWN)).toBeNull();
    });

    it("returns null when the label is well-formed but the kennel was deleted", () => {
      expect(resolveKennel(["kennel:deleted-kennel"], KNOWN)).toBeNull();
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
