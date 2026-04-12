interface ConfidenceMeterProps {
  confidence: "high" | "medium" | "low";
}

/**
 * 3-segment signal-strength bar showing confidence level.
 * Server component — pure visual, no state.
 */
export function ConfidenceMeter({ confidence }: ConfidenceMeterProps) {
  const filled = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  const label =
    confidence === "high"
      ? "High confidence — strong historical activity and recent source validation"
      : confidence === "medium"
        ? "Medium confidence — recurring pattern with some variability"
        : "Low confidence — loose cadence, details uncertain";

  return (
    <div
      role="img"
      aria-label={label}
      className="inline-flex items-end gap-[3px] h-3.5"
    >
      {[1, 2, 3].map((level) => (
        <span
          key={level}
          className={`
            block w-1 rounded-[1px] transition-transform
            ${level <= filled
              ? "bg-[var(--tier-accent,oklch(0.56_0.165_235))]"
              : "bg-border"
            }
          `}
          style={{ height: `${level === 1 ? 50 : level === 2 ? 75 : 100}%` }}
        />
      ))}
    </div>
  );
}
