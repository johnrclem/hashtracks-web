"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { suggestKennelPatterns } from "@/lib/source-detect";
import {
  getGeminiSuggestions,
  type GeminiPatternSuggestion,
} from "@/app/admin/sources/gemini-suggestions-action";

interface SuggestionChipsProps {
  /** Unmatched kennel tags from preview or open alerts */
  unmatchedTags: string[];
  /** Patterns already in the editor — used to filter already-covered tags */
  existingPatterns: [string, string][];
  /** Called when admin accepts a suggestion */
  onAccept: (pattern: [string, string]) => void;
  /** Sample event titles per unmatched tag — enables the AI Enhance button */
  sampleTitlesByTag?: Record<string, string[]>;
  /** Whether GEMINI_API_KEY is configured (passed from server) */
  geminiAvailable?: boolean;
}

export function SuggestionChips({
  unmatchedTags,
  existingPatterns,
  onAccept,
  sampleTitlesByTag,
  geminiAvailable,
}: SuggestionChipsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [aiSuggestions, setAiSuggestions] = useState<GeminiPatternSuggestion[] | null>(null);
  const [aiDismissed, setAiDismissed] = useState<Set<string>>(new Set());
  const [aiError, setAiError] = useState<string | null>(null);
  const [isEnhancing, startEnhance] = useTransition();

  // Reset AI state whenever the unmatched tag set changes (user re-ran "Test Config")
  const unmatchedKey = unmatchedTags.slice().sort().join(",");
  useEffect(() => {
    setAiSuggestions(null);
    setAiDismissed(new Set());
    setAiError(null);
  }, [unmatchedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = suggestKennelPatterns(
    unmatchedTags.filter((tag) => !existingPatterns.some(([, t]) => t === tag)),
  );
  const pending = suggestions.filter(([, tag]) => !dismissed.has(tag));

  // AI: filter out tags already covered by existing patterns or by accepted AI suggestions
  const pendingAi = (aiSuggestions ?? []).filter(
    (s) =>
      !aiDismissed.has(s.pattern) &&
      !existingPatterns.some(([, t]) => t === s.tag),
  );

  const showEnhanceButton =
    geminiAvailable &&
    sampleTitlesByTag &&
    Object.keys(sampleTitlesByTag).length > 0 &&
    unmatchedTags.length > 0 &&
    aiSuggestions === null; // hide once AI results loaded

  if (pending.length === 0 && !showEnhanceButton && pendingAi.length === 0 && !aiError) {
    return null;
  }

  function handleEnhance() {
    if (!sampleTitlesByTag) return;
    startEnhance(async () => {
      setAiError(null);
      const result = await getGeminiSuggestions(unmatchedTags, sampleTitlesByTag);
      if (result.error) {
        setAiError(result.error);
      } else {
        setAiSuggestions(result.suggestions ?? []);
      }
    });
  }

  function confidenceColor(confidence: number): string {
    if (confidence >= 0.8) return "border-green-300 bg-green-50 text-green-800";
    if (confidence >= 0.5) return "border-amber-300 bg-amber-50 text-amber-800";
    return "border-gray-200 bg-gray-50 text-gray-600";
  }

  return (
    <div className="space-y-2 pt-1">
      {/* Deterministic suggestions */}
      {pending.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-700">
            Suggested patterns for unmatched tags:
          </p>
          <div className="flex flex-wrap gap-1">
            {pending.map(([pattern, tag]) => (
              <div
                key={tag}
                className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
              >
                <span className="font-mono">{pattern}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-green-700 hover:text-green-900"
                  title="Accept"
                  onClick={() => {
                    onAccept([pattern, tag]);
                    setDismissed((prev) => new Set([...prev, tag]));
                  }}
                >
                  ✓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                  title="Dismiss"
                  onClick={() => setDismissed((prev) => new Set([...prev, tag]))}
                >
                  &times;
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI enhance button */}
      {showEnhanceButton && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isEnhancing}
          onClick={handleEnhance}
          className="h-7 gap-1.5 text-xs"
        >
          {isEnhancing ? "Thinking..." : "✨ Enhance with AI"}
        </Button>
      )}

      {/* AI error */}
      {aiError && (
        <p className="text-xs text-destructive">AI suggestion failed: {aiError}</p>
      )}

      {/* AI suggestions */}
      {pendingAi.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            ✨ AI suggestions:
          </p>
          <div className="flex flex-wrap gap-1">
            {pendingAi.map((s) => (
              <div
                key={s.pattern}
                className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${confidenceColor(s.confidence)}`}
                title={s.reason}
              >
                <span className="font-mono">{s.pattern}</span>
                <span className="opacity-60">→</span>
                <span>{s.tag}</span>
                <span className="opacity-50">{Math.round(s.confidence * 100)}%</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-green-700 hover:text-green-900"
                  title={`Accept: ${s.reason}`}
                  onClick={() => {
                    onAccept([s.pattern, s.tag]);
                    setAiDismissed((prev) => new Set([...prev, s.pattern]));
                  }}
                >
                  ✓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                  title="Dismiss"
                  onClick={() => setAiDismissed((prev) => new Set([...prev, s.pattern]))}
                >
                  &times;
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
