/**
 * Get today's date at UTC noon as a timestamp (milliseconds).
 * Used for attendance date comparisons — events are stored as UTC noon
 * to avoid DST issues (PRD Appendix F.4).
 */
export function getTodayUtcNoon(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
}

/**
 * Parse a "YYYY-MM-DD" string into a UTC noon Date.
 * Used when creating Event records from scraped date strings.
 */
export function parseUtcNoonDate(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  return new Date(
    Date.UTC(
      parseInt(yearStr, 10),
      parseInt(monthStr, 10) - 1,
      parseInt(dayStr, 10),
      12, 0, 0,
    ),
  );
}
