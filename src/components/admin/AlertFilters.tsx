"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface AlertFiltersProps {
  current: string;
  counts: {
    open: number;
    acknowledged: number;
    snoozed: number;
    resolved: number;
  };
}

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "OPEN", label: "Open" },
  { key: "ACKNOWLEDGED", label: "Acknowledged" },
  { key: "SNOOZED", label: "Snoozed" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "all", label: "All" },
];

function countForFilter(key: string, counts: AlertFiltersProps["counts"]): number | null {
  if (key === "active") return counts.open + counts.acknowledged;
  if (key === "OPEN") return counts.open;
  if (key === "ACKNOWLEDGED") return counts.acknowledged;
  if (key === "SNOOZED") return counts.snoozed;
  if (key === "RESOLVED") return counts.resolved;
  if (key === "all") return counts.open + counts.acknowledged + counts.snoozed + counts.resolved;
  return null;
}

export function AlertFilters({ current, counts }: AlertFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleClick(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "active") {
      params.delete("status");
    } else {
      params.set("status", key);
    }
    router.push(`/admin/alerts?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-0.5 rounded-lg bg-muted/50 p-1">
      {FILTERS.map((f) => {
        const count = countForFilter(f.key, counts);
        const isActive = current === f.key;
        return (
          <button
            key={f.key}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleClick(f.key)}
          >
            {f.label}
            {count != null && count > 0 && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
