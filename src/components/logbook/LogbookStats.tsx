import Link from "next/link";
import { participationLevelLabel } from "@/lib/format";

interface KennelStat {
  kennelId: string;
  shortName: string;
  fullName: string;
  slug: string;
  region: string;
  count: number;
}

interface MilestoneInfo {
  target: number;
  label: string;
  reached: boolean;
  eventTitle?: string | null;
  eventDate?: string;
  kennelShortName?: string;
}

interface LogbookStatsProps {
  totalRuns: number;
  totalHares: number;
  byKennel: KennelStat[];
  byRegion: { region: string; count: number }[];
  byLevel: { level: string; count: number }[];
  milestones: MilestoneInfo[];
}

export function LogbookStats({
  totalRuns,
  totalHares,
  byKennel,
  byRegion,
  byLevel,
  milestones,
}: LogbookStatsProps) {
  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Runs" value={totalRuns} />
        <StatCard label="Times Hared" value={totalHares} />
        <StatCard label="Kennels" value={byKennel.length} />
      </div>

      {/* Milestones */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Milestones</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {milestones.map((m) => (
            <div
              key={m.target}
              className={`rounded-lg border px-4 py-3 ${
                m.reached ? "border-green-500/30 bg-green-50 dark:bg-green-950/20" : "opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">
                  {m.reached ? m.target : `${m.target}`}
                </span>
                {m.label && (
                  <span className="text-xs text-muted-foreground">{m.label}</span>
                )}
              </div>
              {m.reached ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.kennelShortName} — {m.eventDate}
                  {m.eventTitle ? ` — ${m.eventTitle}` : ""}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.target - totalRuns} more to go
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* By Kennel */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">By Kennel</h2>
        <div className="space-y-1">
          {byKennel.map((k) => (
            <div
              key={k.kennelId}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <Link
                href={`/kennels/${k.slug}`}
                className="font-medium text-primary hover:underline"
              >
                {k.shortName}
              </Link>
              <span className="text-muted-foreground">
                {k.count} {k.count === 1 ? "run" : "runs"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* By Region */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">By Region</h2>
        <div className="space-y-1">
          {byRegion.map((r) => (
            <div
              key={r.region}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{r.region}</span>
              <span className="text-muted-foreground">
                {r.count} {r.count === 1 ? "run" : "runs"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* By Level */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">By Participation Level</h2>
        <div className="space-y-1">
          {byLevel.map((l) => (
            <div
              key={l.level}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{participationLevelLabel(l.level)}</span>
              <span className="text-muted-foreground">
                {l.count} {l.count === 1 ? "time" : "times"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}
