/**
 * Amber mono "tell-the-user-you-helped" badge used by Travel Mode when the
 * service made a non-obvious revision: expanding the radius, snapping to a
 * tier, auto-promoting Possible activity over an empty Confirmed list.
 * Single component so the three call sites can't drift in styling.
 */
export function TravelHintBadge({
  glyph,
  label,
  ariaLabel,
}: {
  glyph: "◆" | "◇";
  label: string;
  ariaLabel: string;
}) {
  return (
    <p
      className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400"
      aria-label={ariaLabel}
    >
      {glyph} {label}
    </p>
  );
}
