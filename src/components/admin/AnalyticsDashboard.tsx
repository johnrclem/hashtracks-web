"use client";

import {
  Users,
  UserPlus,
  Activity,
  CheckCircle,
  Hash,
  HeartPulse,
  Database,
  AlertTriangle,
  TrendingUp,
  Globe,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import type {
  CommunityHealthMetrics,
  UserEngagementMetrics,
  OperationalHealthMetrics,
} from "@/app/admin/analytics/actions";

interface Props {
  community: CommunityHealthMetrics;
  engagement: UserEngagementMetrics;
  operational: OperationalHealthMetrics;
}

import { StatCard, SectionHeader } from "./dashboard-shared";

// ── Chart Tooltip ─────────────────────────────────────────────────────

const REGION_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#a855f7", "#eab308", "#22d3ee", "#f43f5e",
  "#64748b", "#0ea5e9", "#d946ef", "#fb923c", "#4ade80",
];

// ── Dashboard Component ───────────────────────────────────────────────

export function AnalyticsDashboard({
  community,
  engagement,
  operational,
}: Props) {
  const healthPct =
    operational.totalEnabledSources > 0
      ? Math.round(
          (operational.totalHealthySources / operational.totalEnabledSources) *
            100,
        )
      : 0;

  const activationRate =
    engagement.totalUsers > 0
      ? Math.round(
          (engagement.usersWithCheckins / engagement.totalUsers) * 100,
        )
      : 0;

  const pieData = [
    { name: "With check-ins", value: engagement.usersWithCheckins, fill: "#10b981" },
    { name: "No check-ins", value: engagement.usersWithoutCheckins, fill: "#334155" },
  ];

  return (
    <div className="space-y-10">
      {/* ── Community Health ───────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={Globe}
          title="Community Health"
          color="bg-blue-500/10 text-blue-500"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Active Kennels"
            value={community.totalActiveKennels}
            icon={Hash}
            color="blue"
          />
          <StatCard
            label="Total Check-ins"
            value={engagement.usersWithCheckins}
            icon={CheckCircle}
            color="green"
          />
          <StatCard
            label="Regions Active"
            value={community.activeKennelsByRegion.length}
            icon={Globe}
            color="purple"
          />
          <StatCard
            label="Top Kennel"
            value={community.topKennels[0]?.shortName ?? "—"}
            icon={TrendingUp}
            color="amber"
            subtitle={
              community.topKennels[0]
                ? `${community.topKennels[0].attendanceCount} check-ins`
                : undefined
            }
          />
        </div>

        {/* Attendance Trends */}
        {community.attendanceTrends.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Check-in Trends
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={community.attendanceTrends}>
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
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#3b82f6" }}
                  activeDot={{ r: 5 }}
                  name="Check-ins"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Active Kennels by Region */}
        {community.activeKennelsByRegion.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Events by Region
            </h3>
            <ResponsiveContainer width="100%" height={Math.max(200, community.activeKennelsByRegion.length * 28)}>
              <BarChart
                data={community.activeKennelsByRegion.slice(0, 15)}
                layout="vertical"
                margin={{ left: 100 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="region"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="eventCount" name="Events" radius={[0, 4, 4, 0]}>
                  {community.activeKennelsByRegion
                    .slice(0, 15)
                    .map((_, i) => (
                      <Cell
                        key={i}
                        fill={REGION_COLORS[i % REGION_COLORS.length]}
                        opacity={0.85}
                      />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top Kennels Table */}
        {community.topKennels.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border/50">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Top Kennels by Check-ins
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Kennel
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Region
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Check-ins
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Subscribers
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {community.topKennels.slice(0, 10).map((k) => (
                    <tr
                      key={k.kennelId}
                      className="hover:bg-accent/30 transition-colors"
                    >
                      <td className="px-5 py-2.5 font-medium">
                        {k.shortName}
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">
                        {k.region ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {k.attendanceCount}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {k.subscriptionCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── User Engagement ────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={Users}
          title="User Engagement"
          color="bg-green-500/10 text-green-500"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Total Users"
            value={engagement.totalUsers}
            icon={Users}
            color="blue"
          />
          <StatCard
            label="New This Week"
            value={engagement.newUsersThisWeek}
            icon={UserPlus}
            color="green"
          />
          <StatCard
            label="Active 30d"
            value={engagement.activeUsers30d}
            icon={Activity}
            color="orange"
          />
          <StatCard
            label="Activation Rate"
            value={`${activationRate}%`}
            icon={CheckCircle}
            color={activationRate >= 50 ? "emerald" : "amber"}
            subtitle={`${engagement.usersWithCheckins} users with 1+ check-in`}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Activation Donut */}
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              User Activation
            </h3>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="ml-4 space-y-2">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: d.fill }}
                    />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-mono font-medium ml-auto tabular-nums">
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Subscription Distribution */}
          {engagement.subscriptionDistribution.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card p-5">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Kennels per User
              </h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={engagement.subscriptionDistribution.slice(0, 10)}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="count"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    label={{
                      value: "# kennels",
                      position: "insideBottomRight",
                      offset: -5,
                      style: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
                    }}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={35}
                    label={{
                      value: "users",
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="users"
                    fill="#10b981"
                    opacity={0.8}
                    radius={[4, 4, 0, 0]}
                    name="Users"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Misman Adoption */}
        <div className="rounded-xl border border-border/50 bg-card p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Misman Adoption
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{
                    width: `${engagement.totalVisibleKennels > 0 ? Math.round((engagement.mismanKennelCount / engagement.totalVisibleKennels) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
            <span className="text-sm font-mono tabular-nums text-muted-foreground">
              {engagement.mismanKennelCount} / {engagement.totalVisibleKennels} kennels
            </span>
          </div>
        </div>
      </section>

      {/* ── Operational Health ─────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={BarChart3}
          title="Operational Health"
          color="bg-orange-500/10 text-orange-500"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Enabled Sources"
            value={operational.totalEnabledSources}
            icon={Database}
            color="teal"
          />
          <StatCard
            label="Healthy"
            value={operational.totalHealthySources}
            icon={HeartPulse}
            color="emerald"
          />
          <StatCard
            label="Health Rate"
            value={`${healthPct}%`}
            icon={HeartPulse}
            color={healthPct >= 80 ? "emerald" : "red"}
          />
          <StatCard
            label="Stale Sources"
            value={operational.staleSources.length}
            icon={AlertTriangle}
            color={operational.staleSources.length > 5 ? "red" : "amber"}
          />
        </div>

        {/* Scrape Success Rate */}
        {operational.scrapeSuccessRates.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Scrape Success Rate (7 days)
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={operational.scrapeSuccessRates}>
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
                  tickFormatter={(v: string) => v.slice(5)} // MM-DD
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={35}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => [`${v}%`, "Success rate"]}
                />
                <Line
                  type="monotone"
                  dataKey="successRate"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#10b981" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Source Health by Region */}
        {operational.sourceHealthByRegion.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Source Health by Region
            </h3>
            <ResponsiveContainer width="100%" height={Math.max(200, operational.sourceHealthByRegion.length * 28)}>
              <BarChart
                data={operational.sourceHealthByRegion.slice(0, 15)}
                layout="vertical"
                margin={{ left: 100 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="region"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="healthy"
                  stackId="health"
                  fill="#10b981"
                  name="Healthy"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="degraded"
                  stackId="health"
                  fill="#f59e0b"
                  name="Degraded"
                />
                <Bar
                  dataKey="failing"
                  stackId="health"
                  fill="#ef4444"
                  name="Failing"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Stale Sources Table */}
        {operational.staleSources.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border/50">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Stale Sources (7+ days without successful scrape)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Source
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Region
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Last Success
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {operational.staleSources.map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-accent/30 transition-colors"
                    >
                      <td className="px-5 py-2.5 font-medium">{s.name}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">
                        {s.region ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right text-muted-foreground font-mono text-xs tabular-nums">
                        {s.lastSuccess
                          ? new Date(s.lastSuccess).toLocaleDateString()
                          : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
