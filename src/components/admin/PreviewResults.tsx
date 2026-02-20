"use client";

import { Badge } from "@/components/ui/badge";
import type { PreviewData } from "@/app/admin/sources/preview-action";
import { useState } from "react";

interface PreviewResultsProps {
  data: PreviewData;
}

export function PreviewResults({ data }: PreviewResultsProps) {
  const [showErrors, setShowErrors] = useState(false);
  const uniqueTags = new Set(data.events.map((e) => e.kennelTag));

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          Found {data.totalCount} event{data.totalCount !== 1 ? "s" : ""}
        </span>
        <span className="text-muted-foreground">
          ({uniqueTags.size} kennel tag{uniqueTags.size !== 1 ? "s" : ""})
        </span>
        {data.totalCount > data.events.length && (
          <span className="text-xs text-muted-foreground">
            — showing first {data.events.length}
          </span>
        )}
        {data.unmatchedTags.length > 0 && (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            {data.unmatchedTags.length} unmatched
          </Badge>
        )}
        {data.errors.length > 0 && (
          <Badge variant="destructive">{data.errors.length} errors</Badge>
        )}
      </div>

      {/* Fill rates */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Title: {data.fillRates.title}%</span>
        <span>Location: {data.fillRates.location}%</span>
        <span>Hares: {data.fillRates.hares}%</span>
        <span>Time: {data.fillRates.startTime}%</span>
        <span>Run#: {data.fillRates.runNumber}%</span>
      </div>

      {/* Event table */}
      {data.events.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto rounded border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left">
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Kennel</th>
                <th className="px-2 py-1.5 font-medium">Title</th>
                <th className="hidden px-2 py-1.5 font-medium sm:table-cell">
                  Location
                </th>
                <th className="hidden px-2 py-1.5 font-medium md:table-cell">
                  Hares
                </th>
                <th className="px-2 py-1.5 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event, i) => (
                <tr key={`${event.date}-${event.kennelTag}-${i}`} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-2 py-1">
                    {event.date}
                  </td>
                  <td className="px-2 py-1">
                    <Badge
                      variant="outline"
                      className={
                        event.resolved
                          ? "border-green-300 text-green-700"
                          : "border-amber-300 text-amber-700"
                      }
                    >
                      {event.kennelTag}
                    </Badge>
                  </td>
                  <td className="max-w-[200px] truncate px-2 py-1">
                    {event.title || "—"}
                  </td>
                  <td className="hidden max-w-[150px] truncate px-2 py-1 sm:table-cell">
                    {event.location || "—"}
                  </td>
                  <td className="hidden max-w-[120px] truncate px-2 py-1 md:table-cell">
                    {event.hares || "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {event.startTime || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Unmatched tags */}
      {data.unmatchedTags.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-700">
            Unmatched kennel tags:
          </p>
          <div className="flex flex-wrap gap-1">
            {data.unmatchedTags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="border-amber-300 text-amber-700"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {data.errors.length > 0 && (
        <div className="space-y-1">
          {data.errors.length <= 3 ? (
            <ul className="list-inside list-disc text-xs text-destructive">
              {data.errors.map((err, i) => (
                <li key={`${i}-${err.slice(0, 40)}`}>{err}</li>
              ))}
            </ul>
          ) : (
            <>
              <button
                type="button"
                className="text-xs text-destructive hover:underline"
                onClick={() => setShowErrors(!showErrors)}
              >
                {showErrors
                  ? "Hide errors"
                  : `Show all ${data.errors.length} errors`}
              </button>
              {showErrors && (
                <ul className="list-inside list-disc text-xs text-destructive">
                  {data.errors.map((err, i) => (
                    <li key={`${i}-${err.slice(0, 40)}`}>{err}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
