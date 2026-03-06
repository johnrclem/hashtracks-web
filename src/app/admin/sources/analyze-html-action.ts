"use server";

import { getAdminUser } from "@/lib/auth";
import {
  analyzeUrlForProposal,
  refineAnalysis,
} from "@/pipeline/html-analysis";
import type { HtmlAnalysisResult } from "@/pipeline/html-analysis";
import type { GenericHtmlConfig } from "@/adapters/html-scraper/generic";

// Re-export types for existing consumers
export type { HtmlAnalysisResult } from "@/pipeline/html-analysis";
export type { ContainerCandidate } from "@/app/admin/sources/html-analysis-utils";

/**
 * Analyze an HTML page to find event containers and suggest a GenericHtmlConfig.
 * Uses Cheerio heuristics + optional Gemini AI for column mapping.
 * Requires admin auth.
 */
export async function analyzeHtmlStructure(
  url: string,
): Promise<HtmlAnalysisResult> {
  const admin = await getAdminUser();
  if (!admin) {
    return { candidates: [], suggestedConfig: null, explanation: "", confidence: null, error: "Not authorized" };
  }

  return analyzeUrlForProposal(url);
}

/**
 * Refine AI analysis with admin feedback/corrections.
 * Sends current config + hints back to Gemini for a second pass.
 * Requires admin auth.
 */
export async function refineHtmlAnalysis(
  url: string,
  currentConfig: Partial<GenericHtmlConfig>,
  feedbackHints: string,
): Promise<HtmlAnalysisResult> {
  const admin = await getAdminUser();
  if (!admin) {
    return { candidates: [], suggestedConfig: null, explanation: "", confidence: null, error: "Not authorized" };
  }

  return refineAnalysis(url, currentConfig, feedbackHints);
}
