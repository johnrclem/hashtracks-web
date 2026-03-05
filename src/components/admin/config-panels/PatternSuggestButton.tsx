"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  suggestFieldPatterns,
  type SuggestableField,
  type FieldPatternSuggestion,
} from "@/app/admin/sources/gemini-field-suggestions-action";

interface PatternSuggestButtonProps {
  sampleDescriptions: string[];
  field: SuggestableField;
  onAccept: (pattern: string) => void;
  geminiAvailable?: boolean;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950";
  if (c >= 0.5) return "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950";
  return "border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900";
}

export function PatternSuggestButton({
  sampleDescriptions,
  field,
  onAccept,
  geminiAvailable,
}: PatternSuggestButtonProps) {
  const [suggestions, setSuggestions] = useState<FieldPatternSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (!geminiAvailable || sampleDescriptions.length === 0) return null;

  function handleSuggest() {
    setError(null);
    startTransition(async () => {
      const result = await suggestFieldPatterns(sampleDescriptions, [field]);
      if (result.error) {
        setError(result.error);
      } else if (result.suggestions) {
        setSuggestions(result.suggestions);
      }
    });
  }

  function handleAccept(pattern: string) {
    onAccept(pattern);
    setDismissed((prev) => new Set(prev).add(pattern));
  }

  function handleDismiss(pattern: string) {
    setDismissed((prev) => new Set(prev).add(pattern));
  }

  const visible = suggestions.filter((s) => !dismissed.has(s.pattern));

  return (
    <div className="space-y-2">
      {visible.length === 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSuggest}
          disabled={isPending}
          className="text-xs"
        >
          {isPending ? "Analyzing..." : "Suggest with AI"}
        </Button>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {visible.length > 0 && (
        <div className="space-y-1.5">
          {visible.map((s) => (
            <div
              key={s.pattern}
              className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${confidenceColor(s.confidence)}`}
            >
              <code className="flex-1 truncate font-mono" title={s.pattern}>
                {s.pattern}
              </code>
              {s.example && (
                <span className="shrink-0 text-muted-foreground" title="Example extraction">
                  &rarr; {s.example}
                </span>
              )}
              <span
                className="shrink-0 text-muted-foreground"
                title={s.reason}
              >
                {Math.round(s.confidence * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-green-600 hover:text-green-800"
                onClick={() => handleAccept(s.pattern)}
                title="Add pattern"
              >
                &#x2713;
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDismiss(s.pattern)}
                title="Dismiss"
              >
                &times;
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
