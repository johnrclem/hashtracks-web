// Shared helpers for legacy MS-Office/FrontPage hash-club hareline tables
// (Herts H3, F.U.K Full Moon H3) — same platform, different column layouts,
// so the row parsers stay separate but these small pieces are common.

/** "11:00Hrs" -> "11:00"; "Noon" -> "12:00"; "7pm"/"7:00pm" -> "19:00". */
export function parseHrsTime(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (/noon/i.test(text)) return "12:00";
  const hhmm = /(\d{1,2}):(\d{2})/.exec(text);
  if (hhmm) {
    const h = Number.parseInt(hhmm[1], 10);
    const m = Number.parseInt(hhmm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  const ampm = /(\d{1,2})\s*(am|pm)/i.exec(text);
  if (ampm) {
    let h = Number.parseInt(ampm[1], 10);
    if (/pm/i.test(ampm[2]) && h !== 12) h += 12;
    if (/am/i.test(ampm[2]) && h === 12) h = 0;
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }
  return undefined;
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
