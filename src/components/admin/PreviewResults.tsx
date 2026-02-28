"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { PreviewData } from "@/app/admin/sources/preview-action";
import type { ErrorDetails } from "@/adapters/types";
import { createInlineAlias } from "@/app/admin/sources/inline-alias-action";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface PreviewResultsProps {
  data: PreviewData;
  /** All kennels for the alias link popover */
  allKennels?: { id: string; shortName: string; fullName: string }[];
  /** Called after an alias is created so the parent can re-run preview */
  onAliasCreated?: () => void;
}



function categorizeErrors(errors: string[]): {
  fetch: string[];
  parse: string[];
  merge: string[];
} {
  const fetch: string[] = [];
  const parse: string[] = [];
  const merge: string[] = [];

  for (const err of errors) {
    const lower = err.toLowerCase();
    if (
      lower.includes("fetch") ||
      lower.includes("http") ||
      lower.includes("connection") ||
      lower.includes("timeout") ||
      lower.includes("network")
    ) {
      fetch.push(err);
    } else if (
      lower.includes("parse") ||
      lower.includes("row") ||
      lower.includes("extract") ||
      lower.includes("decode")
    ) {
      parse.push(err);
    } else if (
      lower.includes("merge") ||
      lower.includes("duplicate") ||
      lower.includes("fingerprint") ||
      lower.includes("kennel")
    ) {
      merge.push(err);
    } else {
      parse.push(err);
    }
  }

  return { fetch, parse, merge };
}

function ErrorSummary({ errors, errorDetails }: { errors: string[]; errorDetails?: ErrorDetails }) {
  if (
    errorDetails &&
    ((errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0 ||
      (errorDetails.merge?.length ?? 0) > 0)
  ) {
    const fetchErrors = errorDetails.fetch ?? [];
    const parseErrors = errorDetails.parse ?? [];
    const mergeErrors = errorDetails.merge ?? [];

    return (
      <div className="space-y-1 text-xs">
        <div className="font-medium text-destructive">
          {[
            fetchErrors.length > 0 && `Fetch: ${fetchErrors.length}`,
            parseErrors.length > 0 && `Parse: ${parseErrors.length}`,
            mergeErrors.length > 0 && `Merge: ${mergeErrors.length}`,
          ]
            .filter(Boolean)
            .join(" | ")}
        </div>

        {fetchErrors.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Fetch Errors ({fetchErrors.length})
            </summary>
            <div className="mt-1 ml-2 space-y-1">
              {fetchErrors.map((err, i) => (
                <div key={i} className="text-muted-foreground">
                  {err.url && <span className="break-all font-mono text-[10px]">{err.url}</span>}
                  {err.status && (
                    <Badge variant="outline" className="ml-1 py-0 text-[10px]">
                      {err.status}
                    </Badge>
                  )}
                  <p className="break-all">{err.message}</p>
                </div>
              ))}
            </div>
          </details>
        )}

        {parseErrors.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Parse Errors ({parseErrors.length})
            </summary>
            <div className="mt-1 ml-2 space-y-1.5">
              {parseErrors.map((err, i) => (
                <div key={i} className="border-l-2 border-muted pl-2 text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px]">Row {err.row}</span>
                    {err.section && (
                      <Badge variant="outline" className="py-0 text-[10px]">
                        {err.section}
                      </Badge>
                    )}
                    {err.field && (
                      <Badge variant="secondary" className="py-0 text-[10px]">
                        {err.field}
                      </Badge>
                    )}
                  </div>
                  <p className="break-all">{err.error}</p>
                  {err.partialData && Object.keys(err.partialData).length > 0 && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-[10px]">Partial data</summary>
                      <pre className="mt-0.5 overflow-x-auto text-[10px]">{JSON.stringify(err.partialData, null, 1)}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {mergeErrors.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Merge Errors ({mergeErrors.length})
            </summary>
            <div className="mt-1 ml-2 space-y-1">
              {mergeErrors.map((err, i) => (
                <div key={i} className="text-muted-foreground">
                  {err.fingerprint && (
                    <span className="font-mono text-[10px]">{err.fingerprint.substring(0, 12)}...</span>
                  )}
                  <span className="ml-1 break-all">{err.reason}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  const categorized = categorizeErrors(errors);
  const hasFetch = categorized.fetch.length > 0;
  const hasParse = categorized.parse.length > 0;
  const hasMerge = categorized.merge.length > 0;

  return (
    <div className="space-y-1 text-xs">
      <div className="font-medium text-destructive">
        {[
          hasFetch && `Fetch: ${categorized.fetch.length}`,
          hasParse && `Parse: ${categorized.parse.length}`,
          hasMerge && `Merge: ${categorized.merge.length}`,
        ]
          .filter(Boolean)
          .join(" | ")}
      </div>

      {hasFetch && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Fetch Errors ({categorized.fetch.length})
          </summary>
          <ul className="mt-1 ml-4 space-y-1">
            {categorized.fetch.map((err, i) => (
              <li key={i} className="break-all text-muted-foreground">
                {err}
              </li>
            ))}
          </ul>
        </details>
      )}

      {hasParse && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Parse Errors ({categorized.parse.length})
          </summary>
          <ul className="mt-1 ml-4 space-y-1">
            {categorized.parse.map((err, i) => (
              <li key={i} className="break-all text-muted-foreground">
                {err}
              </li>
            ))}
          </ul>
        </details>
      )}

      {hasMerge && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Merge Errors ({categorized.merge.length})
          </summary>
          <ul className="mt-1 ml-4 space-y-1">
            {categorized.merge.map((err, i) => (
              <li key={i} className="break-all text-muted-foreground">
                {err}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function PreviewResults({ data, allKennels, onAliasCreated }: PreviewResultsProps) {
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [linkingTag, setLinkingTag] = useState<string | null>(null);
  const [, startLinking] = useTransition();
  const uniqueTags = new Set(data.events.map((e) => e.kennelTag));
  const structuredErrorCount =
    (data.errorDetails?.fetch?.length ?? 0) +
    (data.errorDetails?.parse?.length ?? 0) +
    (data.errorDetails?.merge?.length ?? 0);
  const totalErrors = data.errors.length || structuredErrorCount;
  const hasErrors = totalErrors > 0;

  function handleLinkTag(tag: string, kennelId: string) {
    setOpenTag(null);
    setLinkingTag(tag);
    startLinking(async () => {
      const result = await createInlineAlias(tag, kennelId);
      setLinkingTag(null);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Alias "${tag}" created — re-running preview…`);
        onAliasCreated?.();
      }
    });
  }

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
        {hasErrors && <Badge variant="destructive">{totalErrors} errors</Badge>}
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
              <div key={tag} className="flex items-center gap-0.5">
                <Badge
                  variant="outline"
                  className={`border-amber-300 text-amber-700 ${linkingTag === tag ? "opacity-50" : ""}`}
                >
                  {tag}
                </Badge>
                {allKennels && allKennels.length > 0 && (
                  <Popover
                    open={openTag === tag}
                    onOpenChange={(v) => setOpenTag(v ? tag : null)}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-[10px] text-amber-600 hover:text-amber-900"
                        disabled={linkingTag === tag}
                        title={`Link "${tag}" to a kennel`}
                      >
                        {linkingTag === tag ? "…" : "→ Link"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search kennels…" className="text-xs" />
                        <CommandList>
                          <CommandEmpty>No kennels found.</CommandEmpty>
                          <CommandGroup>
                            {allKennels.map((kennel) => (
                              <CommandItem
                                key={kennel.id}
                                value={`${kennel.shortName} ${kennel.fullName}`}
                                onSelect={() => handleLinkTag(tag, kennel.id)}
                              >
                                <span className="font-medium text-xs">{kennel.shortName}</span>
                                <span className="ml-1 text-[10px] text-muted-foreground truncate">
                                  — {kennel.fullName}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {(data.errors.length > 0 || data.errorDetails) && (
        <ErrorSummary errors={data.errors} errorDetails={data.errorDetails} />
      )}

      {/* Diagnostics */}
      {data.diagnosticContext && Object.keys(data.diagnosticContext).length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Diagnostics
          </summary>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {Object.entries(data.diagnosticContext).map(([key, value]) => (
              <div key={key}>
                <span className="font-medium">{key}:</span>{" "}
                {typeof value === "object" ? JSON.stringify(value) : String(value)}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
