"use client";

import { useState, useTransition } from "react";
import { Lightbulb, Loader2, Sparkles, GitMerge, Scissors, Pencil, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getRegionSuggestions,
  type RegionSuggestion,
  type SuggestionType,
} from "@/app/admin/regions/actions";
import type { RegionRow } from "./RegionTable";

const SUGGESTION_CONFIG: Record<SuggestionType, {
  icon: React.ReactNode;
  color: string;
  actionLabel: string;
}> = {
  merge: { icon: <GitMerge className="h-4 w-4" />, color: "text-blue-600", actionLabel: "Open Merge" },
  split: { icon: <Scissors className="h-4 w-4" />, color: "text-purple-600", actionLabel: "Edit Region" },
  rename: { icon: <Pencil className="h-4 w-4" />, color: "text-amber-600", actionLabel: "Edit Region" },
  reassign: { icon: <ArrowRight className="h-4 w-4" />, color: "text-green-600", actionLabel: "Edit Region" },
};

const CONFIDENCE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
};

export function RegionSuggestionsPanel({
  regions: _regions,
  onAction,
}: Readonly<{
  regions?: RegionRow[];
  onAction?: (type: SuggestionType, regionIds: string[]) => void;
}> = {}) {
  const [suggestions, setSuggestions] = useState<RegionSuggestion[] | null>(null);
  const [source, setSource] = useState<"ai" | "rules" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAnalyze() {
    startTransition(async () => {
      const result = await getRegionSuggestions();
      setSuggestions(result.suggestions);
      setSource(result.source);
      setError(result.error ?? null);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Region Suggestions</h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleAnalyze}
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Analyze Regions
            </>
          )}
        </Button>
      </div>

      {suggestions === null && !isPending && (
        <p className="text-xs text-muted-foreground">
          Click &ldquo;Analyze Regions&rdquo; to get suggestions for merging,
          splitting, or renaming regions based on current kennel assignments.
        </p>
      )}

      {error && (
        <p className="text-xs text-amber-600">
          AI unavailable ({error}). Showing rule-based suggestions.
        </p>
      )}

      {source && (
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {source === "ai" ? "AI + Rules" : "Rules only"}
          </Badge>
          {suggestions !== null && (
            <span className="text-xs text-muted-foreground">
              {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {suggestions !== null && suggestions.length === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
          <p className="text-sm text-green-800 dark:text-green-200">
            Regions look well organized. No suggestions at this time.
          </p>
        </div>
      )}

      {suggestions !== null && suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((s) => (
            <div
              key={`${s.type}-${s.regionIds.join("-")}`}
              className="rounded-lg border p-3 space-y-1.5"
            >
              <div className="flex items-start gap-2">
                <span className={SUGGESTION_CONFIG[s.type].color}>
                  {SUGGESTION_CONFIG[s.type].icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.title}</span>
                    <Badge
                      variant={CONFIDENCE_VARIANTS[s.confidence]}
                      className="text-[10px] shrink-0"
                    >
                      {s.confidence}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.description}
                  </p>
                  {onAction && s.regionIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 text-xs"
                      onClick={() => onAction(s.type, s.regionIds)}
                    >
                      {SUGGESTION_CONFIG[s.type].actionLabel}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
