"use server";

import { getOrCreateUser } from "@/lib/auth";

type FeedbackState = {
  success?: boolean;
  error?: string;
  issueUrl?: string;
} | null;

const CATEGORY_LABELS: Record<string, string> = {
  bug: "bug",
  feature: "enhancement",
  question: "question",
  other: "feedback",
};

const CATEGORY_HEADINGS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  question: "Question",
  other: "Feedback",
};

// ── Rate limiting ─────────────────────────────────────────────────────
// Per-user, in-memory sliding window. Prevents a single user from flooding
// the GitHub issue tracker via the feedback form (the action creates a
// public issue + burns the server's GITHUB_TOKEN rate limit quota).
//
// Limits are intentionally generous for legitimate bug-reporting bursts
// but block automated spam. For multi-instance deployments, this Map is
// per-instance — that's an accepted defense-in-depth trade-off for now
// since each instance still enforces the limit independently.
const HOURLY_LIMIT = 5;
const DAILY_LIMIT = 20;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const feedbackTimestamps = new Map<string, number[]>();

function checkFeedbackRateLimit(
  userId: string,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const existing = feedbackTimestamps.get(userId) ?? [];
  // Keep only timestamps within the last 24 hours
  const recent = existing.filter((t) => now - t < ONE_DAY_MS);

  const lastHour = recent.filter((t) => now - t < ONE_HOUR_MS);
  if (lastHour.length >= HOURLY_LIMIT) {
    const oldest = Math.min(...lastHour);
    return { allowed: false, retryAfterMs: ONE_HOUR_MS - (now - oldest) };
  }
  if (recent.length >= DAILY_LIMIT) {
    const oldest = Math.min(...recent);
    return { allowed: false, retryAfterMs: ONE_DAY_MS - (now - oldest) };
  }

  recent.push(now);
  feedbackTimestamps.set(userId, recent);
  return { allowed: true };
}

export async function submitFeedback(
  _prevState: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const rate = checkFeedbackRateLimit(user.id);
  if (!rate.allowed) {
    const minutes = Math.max(1, Math.ceil(rate.retryAfterMs / 60_000));
    return {
      error: `Too many feedback submissions. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return { error: "Feedback system not configured" };

  const category = (formData.get("category") as string)?.trim() || "other";
  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const pageUrl = (formData.get("pageUrl") as string)?.trim();

  if (!title) return { error: "Title is required" };
  if (title.length > 200) return { error: "Title is too long (max 200 characters)" };
  if (!description) return { error: "Description is required" };
  if (description.length > 5000) return { error: "Description is too long (max 5,000 characters)" };

  // Sanitize @claude mentions to prevent accidental workflow triggering (matches auto-issue.ts pattern)
  const sanitize = (s: string) => s.replaceAll("@claude", "@\u200Bclaude");

  const issueTitle = sanitize(`[Feedback] ${title}`);
  const heading = CATEGORY_HEADINGS[category] || "Feedback";
  const issueBody = sanitize(`## ${heading}

${description}

---
**Submitted by:** ${user.hashName || user.email}
**Page:** ${pageUrl || "N/A"}
**Date:** ${new Date().toISOString()}

*Submitted via HashTracks in-app feedback*`);

  const labels = ["user-feedback", CATEGORY_LABELS[category] || "feedback"];

  try {
    const res = await fetch(
      "https://api.github.com/repos/johnrclem/hashtracks-web/issues",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: issueTitle, body: issueBody, labels }),
      },
    );

    if (!res.ok) {
      // Log only the status — GitHub error bodies can contain token scope
      // hints or other details we don't want captured by Sentry/PostHog.
      console.error("GitHub API error:", res.status);
      return { error: "Failed to submit feedback. Please try again." };
    }

    const issue = await res.json();

    const { captureServerEvent } = await import("@/lib/analytics-server");
    await captureServerEvent(user.id, "feedback_submitted", { category });

    return { success: true, issueUrl: issue.html_url as string };
  } catch (err) {
    console.error("Feedback submission error:", err);
    return {
      error: "Failed to submit feedback. Please try again.",
    };
  }
}
