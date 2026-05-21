import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { reportAuditFilerFailure } from "./audit-filer-telemetry";

const captureMessage = vi.mocked(Sentry.captureMessage);

beforeEach(() => {
  captureMessage.mockClear();
});

// The dedup map is module-scoped (intentional — production reuses it across
// requests within a serverless instance). To keep tests independent without
// reaching into module internals, each test below uses a status code that no
// other test reuses, so suppressions can't bleed across tests.
describe("reportAuditFilerFailure dedup", () => {
  it("captures the first failure and suppresses an identical repeat within the window", () => {
    reportAuditFilerFailure("chrome", "createIssue", { githubStatus: 500 });
    reportAuditFilerFailure("chrome", "createIssue", { githubStatus: 500 });
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  // Regression: pre-fix, both `{ error: "GITHUB_TOKEN not set" }` and
  // `{ error: new TypeError(...) }` collapsed to one `:noerr` bucket and
  // suppressed each other for 60s — defeating the dedup's whole point of
  // distinguishing auth-vs-connectivity outages.
  it("does NOT suppress a different failure mode in the same (origin,stage) bucket", () => {
    reportAuditFilerFailure("cron", "createIssue", { error: "GITHUB_TOKEN not set" });
    reportAuditFilerFailure("cron", "createIssue", { error: new TypeError("fetch failed") });
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("distinguishes failure modes across stages", () => {
    reportAuditFilerFailure("cron", "createIssue", { githubStatus: 502 });
    reportAuditFilerFailure("cron", "postComment", { githubStatus: 502 });
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("distinguishes failure modes across origins", () => {
    reportAuditFilerFailure("chrome", "createIssue", { githubStatus: 503 });
    reportAuditFilerFailure("cron", "createIssue", { githubStatus: 503 });
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("tags the event with origin / stage / github_status", () => {
    reportAuditFilerFailure("chrome", "postComment", {
      githubStatus: 422,
      issueNumber: 7,
    });
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("postComment"),
      expect.objectContaining({
        tags: expect.objectContaining({
          audit_filer: "chrome",
          stage: "postComment",
          github_status: "422",
        }),
      }),
    );
  });
});
