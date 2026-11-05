// Shared helpers for legacy MS-Office/FrontPage hash-club hareline tables
// (Herts H3, F.U.K Full Moon H3) — same platform, different column layouts,
// so the row parsers stay separate but these small pieces are common.

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "11:00" / "19:30Hrs" / "7:00pm" -> "HH:MM", or undefined when absent / out of range. */
function parseColonTime(text: string): string | undefined {
  const hhmm = /(\d{1,2}):(\d{2}) ?(am|pm)?/i.exec(text);
  if (!hhmm) return undefined;
  let h = Number.parseInt(hhmm[1], 10);
  const m = Number.parseInt(hhmm[2], 10);
  const suffix = hhmm[3]?.toLowerCase();
  if (suffix && (h < 1 || h > 12)) return undefined;
  if (suffix) h = (h % 12) + (suffix === "pm" ? 12 : 0);
  return h <= 23 && m <= 59 ? `${pad2(h)}:${pad2(m)}` : undefined;
}

/** "7pm" / "12am" -> "HH:00", or undefined when absent / not a 1-12 clock hour. */
function parseAmPmTime(text: string): string | undefined {
  const ampm = /(\d{1,2})\s*(am|pm)/i.exec(text);
  const raw = ampm ? Number.parseInt(ampm[1], 10) : Number.NaN;
  if (!ampm || raw < 1 || raw > 12) return undefined;
  const h = (raw % 12) + (ampm[2].toLowerCase() === "pm" ? 12 : 0);
  return `${pad2(h)}:00`;
}

/** "11:00Hrs" -> "11:00"; "Noon" -> "12:00"; "7pm"/"7:00pm" -> "19:00". */
export function parseHrsTime(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (/noon/i.test(text)) return "12:00";
  return parseColonTime(text) ?? parseAmPmTime(text);
}

// Known placeholder phrases. Real cells sometimes stack more than one in
// separate <p> lines within the same <td> (e.g. FUKFM "TBC" + "Limited
// Numbers" -> "TBC Limited Numbers" after whitespace-collapse) — strip each
// occurrence procedurally rather than trying to match every combination in
// one regex (keeps things Sonar S5852/S5843-safe: no nested \s* in alternation).
const PLACEHOLDER_PHRASES = ["hares required", "invite only!", "invite only", "limited numbers", "tbc", "tba"];

/** Placeholder cell values ("TBC", "Hares Required", "TBC Limited Numbers", ...) that should map to undefined, not a literal string. */
export function isPlaceholderCell(text: string | undefined): boolean {
  if (!text) return true;
  let remaining = text.toLowerCase();
  for (const phrase of PLACEHOLDER_PHRASES) {
    remaining = remaining.split(phrase).join(" ");
  }
  return remaining.trim() === "";
}
