"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchRoster } from "@/app/misman/[slug]/roster/actions";

interface HasherResult {
  id: string;
  hashName: string | null;
  nerdName: string | null;
  attendanceCount: number;
}

interface HasherSearchProps {
  kennelId: string;
  attendedHasherIds: Set<string>;
  onSelect: (hasherId: string) => void;
  onQuickAdd: (data: { hashName?: string; nerdName?: string }) => void;
  disabled?: boolean;
}

export function HasherSearch({
  kennelId,
  attendedHasherIds,
  onSelect,
  onQuickAdd,
  disabled,
}: HasherSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HasherResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Search as user types (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const result = await searchRoster(kennelId, query.trim());
      if (result.data) {
        setResults(result.data);
        setShowResults(true);
      }
      setLoading(false);
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, kennelId]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(hasherId: string) {
    onSelect(hasherId);
    setQuery("");
    setShowResults(false);
  }

  function handleQuickAdd() {
    const trimmed = query.trim();
    if (!trimmed) return;
    onQuickAdd({ hashName: trimmed });
    setQuery("");
    setShowResults(false);
  }

  // Filter out already-attended hashers
  const filtered = results.filter((r) => !attendedHasherIds.has(r.id));

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <Input
          placeholder="Search roster or type new name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && setShowResults(true)}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleQuickAdd}
          disabled={disabled || !query.trim()}
        >
          + New
        </Button>
      </div>

      {/* Dropdown results */}
      {showResults && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border bg-background shadow-lg max-h-64 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Searching...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {results.length > 0
                ? "All matches already added"
                : "No roster matches"}
              {query.trim() && (
                <button
                  className="block mt-1 text-primary hover:underline"
                  onClick={handleQuickAdd}
                >
                  Add &ldquo;{query.trim()}&rdquo; as new hasher
                </button>
              )}
            </div>
          ) : (
            filtered.map((h) => (
              <button
                key={h.id}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center justify-between"
                onClick={() => handleSelect(h.id)}
              >
                <div>
                  <span className="font-medium">
                    {h.hashName || h.nerdName}
                  </span>
                  {h.hashName && h.nerdName && (
                    <span className="ml-2 text-muted-foreground">
                      ({h.nerdName})
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {h.attendanceCount} runs
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
