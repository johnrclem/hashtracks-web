"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface SourceInfo {
  id: string;
  name: string;
  type: string;
  healthStatus: string;
  enabled: boolean;
}

interface KennelCoverage {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
  eventCount: number;
  sources: SourceInfo[];
}

interface CoverageTableProps {
  kennels: KennelCoverage[];
}

function healthColor(status: string, enabled: boolean): string {
  if (!enabled) return "bg-gray-100 text-gray-500 border-gray-200";
  switch (status) {
    case "HEALTHY":   return "bg-green-50 text-green-700 border-green-200";
    case "DEGRADED":  return "bg-amber-50 text-amber-700 border-amber-200";
    case "FAILING":   return "bg-red-50 text-red-700 border-red-200";
    case "STALE":     return "bg-orange-50 text-orange-700 border-orange-200";
    default:          return "bg-gray-100 text-gray-500 border-gray-200";
  }
}

// Per-region summary
interface RegionStats {
  total: number;
  covered: number;
  sourceCount: number;
  healthCounts: Record<string, number>;
}

function buildRegionStats(kennels: KennelCoverage[]): Map<string, RegionStats> {
  const map = new Map<string, RegionStats>();
  for (const k of kennels) {
    const s = map.get(k.region) ?? { total: 0, covered: 0, sourceCount: 0, healthCounts: {} };
    s.total++;
    if (k.sources.length > 0) s.covered++;
    s.sourceCount += k.sources.length;
    for (const src of k.sources) {
      const status = src.enabled ? src.healthStatus : "DISABLED";
      s.healthCounts[status] = (s.healthCounts[status] ?? 0) + 1;
    }
    map.set(k.region, s);
  }
  return map;
}

export function CoverageTable({ kennels }: CoverageTableProps) {
  const [filter, setFilter] = useState<"all" | "uncovered" | "covered">("all");
  const [search, setSearch] = useState("");

  const covered    = kennels.filter((k) => k.sources.length > 0);
  const uncovered  = kennels.filter((k) => k.sources.length === 0);
  const wellCovered = kennels.filter((k) => k.sources.length >= 2);
  const pct = kennels.length ? Math.round((covered.length / kennels.length) * 100) : 0;

  const regionStats = buildRegionStats(kennels);
  const regions = [...regionStats.entries()].sort(([, a], [, b]) => (a.covered - a.total) - (b.covered - b.total));

  const filtered = kennels.filter((k) => {
    if (filter === "uncovered" && k.sources.length > 0) return false;
    if (filter === "covered"   && k.sources.length === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      return k.shortName.toLowerCase().includes(q) || k.fullName.toLowerCase().includes(q) || k.region.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Kennels", value: kennels.length, color: "text-foreground" },
          { label: "Covered",       value: covered.length,   color: "text-green-700" },
          { label: "Uncovered",     value: uncovered.length, color: "text-amber-700" },
          { label: "% Coverage",    value: `${pct}%`,        color: pct >= 75 ? "text-green-700" : pct >= 50 ? "text-amber-700" : "text-red-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Region breakdown */}
      <div>
        <h3 className="mb-2 text-sm font-semibold">By Region</h3>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Region</th>
                <th className="px-3 py-2 text-right font-medium">Kennels</th>
                <th className="px-3 py-2 text-right font-medium">Covered</th>
                <th className="px-3 py-2 text-right font-medium">Sources</th>
                <th className="px-3 py-2 text-left font-medium">Health</th>
              </tr>
            </thead>
            <tbody>
              {regions.map(([region, s]) => (
                <tr key={region} className="border-t">
                  <td className="px-3 py-2 font-medium">{region}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.total}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={s.covered < s.total ? "text-amber-700 font-medium" : "text-green-700"}>
                      {s.covered}/{s.total}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.sourceCount}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(s.healthCounts).map(([status, count]) => (
                        <span key={status} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${healthColor(status, status !== "DISABLED")}`}>
                          {count} {status.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Well-covered kennels */}
      {wellCovered.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-green-700">Well-Covered (2+ sources)</h3>
          <div className="flex flex-wrap gap-1.5">
            {wellCovered.map((k) => (
              <span key={k.id} className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs text-green-800">
                {k.shortName}
                <span className="text-green-600">×{k.sources.length}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Kennel table with filter + search */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">All Kennels</h3>
          <div className="flex rounded-md border text-xs overflow-hidden">
            {(["all", "covered", "uncovered"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 capitalize transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <Input
            placeholder="Search kennels…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-48 text-xs"
          />
          <span className="text-xs text-muted-foreground">{filtered.length} kennel{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Kennel</th>
                <th className="px-3 py-2 text-left font-medium">Region</th>
                <th className="px-3 py-2 text-right font-medium">Events</th>
                <th className="px-3 py-2 text-left font-medium">Sources</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{k.shortName}</div>
                    <div className="text-xs text-muted-foreground">{k.fullName}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{k.region}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{k.eventCount.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {k.sources.length === 0 ? (
                      <Link
                        href="/admin/sources/new"
                        className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 hover:underline"
                      >
                        + Add Source
                      </Link>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {k.sources.map((s) => (
                          <Badge
                            key={s.id}
                            variant="outline"
                            className={`text-xs ${healthColor(s.healthStatus, s.enabled)}`}
                          >
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    No kennels match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
