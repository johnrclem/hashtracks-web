"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Activity,
  Plus,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  createSuppression,
  deleteSuppression,
  getSuppressionImpact,
  type TrendPoint,
  type TopOffender,
  type RecentRun,
  type SuppressionRow,
} from "@/app/admin/audit/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatCard, SectionHeader } from "./dashboard-shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const GLOBAL_KENNEL_VALUE = "__global__";

interface KennelOption {
  kennelCode: string;
  shortName: string;
}

interface Props {
  trends: TrendPoint[];
  topOffenders: TopOffender[];
  recentRuns: RecentRun[];
  suppressions: SuppressionRow[];
  kennels: KennelOption[];
  knownRules: string[];
}

const CATEGORY_LINES: { key: keyof TrendPoint; label: string; color: string }[] = [
  { key: "hares", label: "Hares", color: "#ef4444" },
  { key: "title", label: "Title", color: "#f97316" },
  { key: "location", label: "Location", color: "#eab308" },
  { key: "event", label: "Event", color: "#22c55e" },
  { key: "description", label: "Description", color: "#3b82f6" },
];

// ── Dashboard ───────────────────────────────────────────────────────

export function AuditDashboard({
  trends,
  topOffenders,
  recentRuns,
  suppressions,
  kennels,
  knownRules,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ kennelCode: string | null; rule: string }>({
    kennelCode: null,
    rule: knownRules[0] ?? "",
  });

  const totalFindings = trends.reduce((sum, t) => sum + t.total, 0);
  const lastRunIssues = recentRuns[0]?.issuesFiled ?? 0;

  if (recentRuns.length === 0 && trends.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-10 text-center">
        <Activity className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">No audit runs yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          First scheduled run is daily at 7:07 AM ET.
        </p>
      </div>
    );
  }

  function openDialog(
    kennelCode: string | null = null,
    rule: string = knownRules[0] ?? "",
  ) {
    setPrefill({ kennelCode, rule });
    setDialogOpen(true);
  }

  return (
    <div className="space-y-10">
      {/* ── Overview ───────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={ShieldCheck}
          title="Data Quality Audit"
          color="bg-blue-500/10 text-blue-500"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Findings (last 30d)"
            value={totalFindings}
            icon={AlertTriangle}
            color="orange"
          />
          <StatCard
            label="Issues filed (last run)"
            value={lastRunIssues}
            icon={Activity}
            color="blue"
          />
          <StatCard
            label="Active suppressions"
            value={suppressions.length}
            icon={BadgeCheck}
            color="green"
          />
        </div>

        {trends.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Findings Over Time
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trends}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                {CATEGORY_LINES.map(line => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    name={line.label}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ── Top Offenders ──────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={TrendingUp}
          title="Top Offenders (last 14 days)"
          color="bg-orange-500/10 text-orange-500"
        />
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {topOffenders.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No findings in window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Kennel
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Rule
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Count
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Last Seen
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {topOffenders.map(o => (
                    <tr
                      key={`${o.kennelCode}::${o.rule}`}
                      className="hover:bg-accent/30 transition-colors"
                    >
                      <td className="px-5 py-2.5 font-medium">
                        <div className="flex items-center gap-2">
                          <span>{o.kennelShortName}</span>
                          {o.suppressed && (
                            <Badge variant="secondary" className="text-[10px]">
                              Suppressed
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">
                        {o.rule}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {o.count}
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground tabular-nums text-xs">
                        {o.lastSeen}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {!o.suppressed && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => openDialog(o.kennelCode, o.rule)}
                          >
                            Suppress
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Suppressions ───────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <SectionHeader
            icon={BadgeCheck}
            title="Active Suppressions"
            color="bg-green-500/10 text-green-500"
          />
          <Button size="sm" onClick={() => openDialog()}>
            <Plus className="h-3.5 w-3.5" />
            Add suppression
          </Button>
        </div>
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {suppressions.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No active suppressions.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Scope
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Rule
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Reason
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Created By
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {suppressions.map(s => (
                    <SuppressionRowView
                      key={s.id}
                      row={s}
                      onChanged={() => router.refresh()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Recent Runs ────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={Activity}
          title="Recent Audit Runs (last 14 days)"
          color="bg-purple-500/10 text-purple-500"
        />
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {recentRuns.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No runs in window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Date
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Events Scanned
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Findings
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Groups
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Issues Filed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {recentRuns.map(r => (
                    <tr key={r.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-5 py-2.5 text-muted-foreground tabular-nums text-xs">
                        {new Date(r.createdAt).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.eventsScanned}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.findingsCount}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.groupsCount}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.issuesFiled}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {dialogOpen && (
        <SuppressionDialog
          key={`${prefill.kennelCode ?? ""}::${prefill.rule}`}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          kennels={kennels}
          knownRules={knownRules}
          initialKennelCode={prefill.kennelCode}
          initialRule={prefill.rule}
          onCreated={() => {
            setDialogOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Suppression Row + Delete Confirmation ───────────────────────────

function SuppressionRowView({
  row,
  onChanged,
}: {
  row: SuppressionRow;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const isGlobal = row.kennelCode === null;
  const scopeLabel = isGlobal ? "Global" : (row.kennelShortName ?? row.kennelCode);

  function handleDelete() {
    startTransition(async () => {
      await deleteSuppression(row.id);
      onChanged();
    });
  }

  return (
    <tr className="hover:bg-accent/30 transition-colors">
      <td className="px-5 py-2.5 font-medium">
        {isGlobal ? <Badge variant="outline">Global</Badge> : scopeLabel}
      </td>
      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">
        {row.rule}
      </td>
      <td className="px-5 py-2.5 text-muted-foreground max-w-sm truncate">
        {row.reason}
      </td>
      <td className="px-5 py-2.5 text-muted-foreground text-xs">
        {row.createdBy ?? "—"}
      </td>
      <td className="px-5 py-2.5 text-right">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive hover:text-destructive"
            >
              Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove suppression?</AlertDialogTitle>
              <AlertDialogDescription>
                Findings matching <span className="font-mono">{row.rule}</span> for{" "}
                <span className="font-medium">{scopeLabel}</span> will be flagged again
                on the next audit run.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={handleDelete}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {pending ? "Removing…" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  );
}

// ── Suppression Dialog ──────────────────────────────────────────────

function SuppressionDialog({
  open,
  onOpenChange,
  kennels,
  knownRules,
  initialKennelCode,
  initialRule,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kennels: KennelOption[];
  knownRules: string[];
  initialKennelCode: string | null;
  initialRule: string;
  onCreated: () => void;
}) {
  const [kennelCode, setKennelCode] = useState<string | null>(initialKennelCode);
  const [rule, setRule] = useState(initialRule);
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<{ totalFindings: number; perDay: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const impactReqRef = useRef(0);

  useEffect(() => {
    void refreshImpact(initialKennelCode, initialRule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshImpact(nextKennel: string | null, nextRule: string) {
    if (!nextRule) return;
    setImpact(null);
    const reqId = ++impactReqRef.current;
    try {
      const result = await getSuppressionImpact(nextKennel, nextRule);
      if (reqId === impactReqRef.current) setImpact(result);
    } catch {
      if (reqId === impactReqRef.current) setImpact(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createSuppression({ kennelCode, rule, reason });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create suppression");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add suppression</DialogTitle>
          <DialogDescription>
            Skip findings matching this kennel + rule on future audit runs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="audit-suppression-kennel">Kennel</Label>
            <Select
              value={kennelCode ?? GLOBAL_KENNEL_VALUE}
              onValueChange={v => {
                const next = v === GLOBAL_KENNEL_VALUE ? null : v;
                setKennelCode(next);
                void refreshImpact(next, rule);
              }}
            >
              <SelectTrigger id="audit-suppression-kennel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL_KENNEL_VALUE}>Global (all kennels)</SelectItem>
                {kennels.map(k => (
                  <SelectItem key={k.kennelCode} value={k.kennelCode}>
                    {k.shortName}{" "}
                    <span className="text-xs text-muted-foreground">({k.kennelCode})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-suppression-rule">Rule</Label>
            <Select
              value={rule}
              onValueChange={v => {
                setRule(v);
                void refreshImpact(kennelCode, v);
              }}
            >
              <SelectTrigger id="audit-suppression-rule" className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {knownRules.map(r => (
                  <SelectItem key={r} value={r} className="font-mono text-xs">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-suppression-reason">Reason</Label>
            <Textarea
              id="audit-suppression-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              required
              minLength={10}
              rows={3}
              placeholder="Why is this finding accepted?"
            />
          </div>
          {impact && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Skips ~{impact.perDay} findings/day · {impact.totalFindings} in last 14 days.
            </div>
          )}
          {error && <div className="text-xs text-destructive">{error}</div>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || reason.trim().length < 10}
            >
              {pending ? "Saving…" : "Suppress"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
