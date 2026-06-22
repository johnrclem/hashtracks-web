import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/profile/UserAvatar";
import type { RosterEntry } from "@/lib/roster";

function hareLabel(role: string | null): string {
  if (role === "CO_HARE") return "Co-Hare";
  if (role === "LIVE_HARE") return "Live Hare";
  return "Hare";
}

/**
 * "Who was there" roster for a PAST event (#110). Shows hares (always) plus any
 * hashers who opted into public attendance and checked in. The caller has
 * already applied the privacy filter — this component only renders.
 */
export function PastEventRoster({ entries }: Readonly<{ entries: RosterEntry[] }>) {
  if (entries.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Who was there</h2>
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3"
          >
            <UserAvatar src={entry.avatarSrc} alt={`${entry.name} avatar`} size={28} />
            <span className="text-sm">{entry.name}</span>
            {entry.isHare && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {hareLabel(entry.hareRole)}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
