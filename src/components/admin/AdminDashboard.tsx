"use client";

import Link from "next/link";
import {
  Users,
  UserCheck,
  CheckSquare,
  Calendar,
  Hash,
  Database,
  HeartPulse,
  Bell,
} from "lucide-react";
import { AnimatedCounter } from "@/components/home/HeroAnimations";
import { TAB_ROUTES } from "./AdminNavTabs";
import type { LucideIcon } from "lucide-react";

interface AdminDashboardProps {
  stats: {
    totalUsers: number;
    activeUsers: number;
    upcomingEvents: number;
    visibleKennels: number;
    enabledSources: number;
    healthySources: number;
    totalCheckins: number;
    activeAlerts: number;
  };
}

interface StatCard {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

export function AdminDashboard({ stats }: AdminDashboardProps) {
  const healthPct =
    stats.enabledSources > 0
      ? Math.round((stats.healthySources / stats.enabledSources) * 100)
      : 0;

  const statCards: StatCard[] = [
    { label: "Users", value: stats.totalUsers, icon: Users, color: "text-blue-500", bgColor: "bg-blue-500/[0.08]" },
    { label: "Active 30d", value: stats.activeUsers, icon: UserCheck, color: "text-green-500", bgColor: "bg-green-500/[0.08]" },
    { label: "Check-ins", value: stats.totalCheckins, icon: CheckSquare, color: "text-orange-500", bgColor: "bg-orange-500/[0.08]" },
    { label: "Upcoming", value: stats.upcomingEvents, icon: Calendar, color: "text-purple-500", bgColor: "bg-purple-500/[0.08]" },
    { label: "Kennels", value: stats.visibleKennels, icon: Hash, color: "text-amber-500", bgColor: "bg-amber-500/[0.08]" },
    { label: "Sources", value: stats.enabledSources, icon: Database, color: "text-teal-500", bgColor: "bg-teal-500/[0.08]" },
    { label: "Health %", value: healthPct, icon: HeartPulse, color: healthPct >= 80 ? "text-emerald-500" : "text-red-500", bgColor: healthPct >= 80 ? "bg-emerald-500/[0.08]" : "bg-red-500/[0.08]" },
    { label: "Alerts", value: stats.activeAlerts, icon: Bell, color: "text-red-500", bgColor: "bg-red-500/[0.08]" },
  ];

  // Derive section guide from shared TAB_ROUTES (skip dashboard — that's this page)
  const sections = TAB_ROUTES.filter((t) => t.value !== "dashboard" && t.description);

  return (
    <div className="space-y-8">
      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-border/50 bg-card p-4 text-center"
          >
            <div className={`mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg ${card.bgColor}`}>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
            <div className="text-2xl font-bold tracking-tight">
              <AnimatedCounter target={card.value} />
              {card.label === "Health %" && <span className="text-lg">%</span>}
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {card.label}
            </div>
          </div>
        ))}
      </div>

      {/* Section guide */}
      <div>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Admin Sections
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map((section) => {
            const badge = section.value === "alerts" ? stats.activeAlerts : undefined;
            return (
              <Link
                key={section.href}
                href={section.href}
                className="group rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border hover:bg-accent/50"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    <section.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold group-hover:text-foreground">
                        {section.label}
                      </span>
                      {badge != null && badge > 0 && (
                        <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
                          {badge} open
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {section.description}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
