"use client";

import { formatDateCompact, formatNights } from "@/lib/travel/format";
import type { LegState } from "./types";

export function SubmitBarSummary({ legs }: Readonly<{ legs: LegState[] }>) {
  if (legs.length === 1) {
    const leg = legs[0];
    if (!leg.startDate || !leg.endDate) return <>Ready when you are</>;
    return (
      <>
        {formatDateCompact(leg.startDate)} → {formatDateCompact(leg.endDate)} · {formatNights(leg.startDate, leg.endDate)}
      </>
    );
  }
  const firstStart = legs[0].startDate;
  const lastEnd = legs.at(-1)!.endDate;
  if (!firstStart || !lastEnd) return <>{legs.length} legs · pending dates</>;
  return (
    <>
      {legs.length} legs · {formatDateCompact(firstStart)} → {formatDateCompact(lastEnd)} · {formatNights(firstStart, lastEnd)}
    </>
  );
}
