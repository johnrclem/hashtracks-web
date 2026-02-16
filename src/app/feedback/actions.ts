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

export async function submitFeedback(
  _prevState: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const token = process.env.GITHUB_TOKEN;
  if (!token) return { error: "Feedback system not configured" };

  const category = (formData.get("category") as string)?.trim() || "other";
  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const pageUrl = (formData.get("pageUrl") as string)?.trim();

  if (!title) return { error: "Title is required" };
  if (!description) return { error: "Description is required" };

  const issueTitle = `[Feedback] ${title}`;
  const heading = CATEGORY_HEADINGS[category] || "Feedback";
  const issueBody = `## ${heading}

${description}

---
**Submitted by:** ${user.hashName || user.email}
**Page:** ${pageUrl || "N/A"}
**Date:** ${new Date().toISOString()}

*Submitted via HashTracks in-app feedback*`;

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
      const errBody = await res.text();
      console.error("GitHub API error:", res.status, errBody.slice(0, 200));
      return { error: "Failed to submit feedback. Please try again." };
    }

    const issue = await res.json();
    return { success: true, issueUrl: issue.html_url as string };
  } catch (err) {
    console.error("Feedback submission error:", err);
    return {
      error: "Failed to submit feedback. Please try again.",
    };
  }
}
