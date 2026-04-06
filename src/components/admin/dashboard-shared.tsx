import type { LucideIcon } from "lucide-react";

const COLOR_MAP: Record<string, { text: string; bg: string }> = {
  blue: { text: "text-blue-500", bg: "bg-blue-500/[0.08]" },
  green: { text: "text-green-500", bg: "bg-green-500/[0.08]" },
  orange: { text: "text-orange-500", bg: "bg-orange-500/[0.08]" },
  purple: { text: "text-purple-500", bg: "bg-purple-500/[0.08]" },
  amber: { text: "text-amber-500", bg: "bg-amber-500/[0.08]" },
  teal: { text: "text-teal-500", bg: "bg-teal-500/[0.08]" },
  red: { text: "text-red-500", bg: "bg-red-500/[0.08]" },
  emerald: { text: "text-emerald-500", bg: "bg-emerald-500/[0.08]" },
};

export function StatCard({
  label,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color: string;
  subtitle?: string;
}) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.blue;
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.bg}`}
        >
          <Icon className={`h-4.5 w-4.5 ${c.text}`} />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold tracking-tight tabular-nums">
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        </div>
      </div>
      {subtitle && <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function SectionHeader({
  icon: Icon,
  title,
  color,
}: {
  icon: LucideIcon;
  title: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-7 w-7 items-center justify-center rounded-md ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
    </div>
  );
}
