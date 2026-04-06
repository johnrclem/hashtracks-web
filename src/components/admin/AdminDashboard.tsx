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
  ShieldCheck,
  ArrowRight,
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
    auditFindings: number;
  };
}

interface StatCard {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  href: string;
  suffix?: string;
}

export function AdminDashboard({ stats }: AdminDashboardProps) {
  const healthPct =
    stats.enabledSources > 0
      ? Math.round((stats.healthySources / stats.enabledSources) * 100)
      : 0;

  const statCards: StatCard[] = [
    { label: "Users", value: stats.totalUsers, icon: Users, color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-500/20", href: "/admin/analytics" },
    { label: "Active 30d", value: stats.activeUsers, icon: UserCheck, color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-500/20", href: "/admin/analytics" },
    { label: "Check-ins", value: stats.totalCheckins, icon: CheckSquare, color: "text-orange-600", bgColor: "bg-orange-100 dark:bg-orange-500/20", href: "/admin/analytics" },
    { label: "Upcoming", value: stats.upcomingEvents, icon: Calendar, color: "text-purple-600", bgColor: "bg-purple-100 dark:bg-purple-500/20", href: "/admin/events" },
    { label: "Kennels", value: stats.visibleKennels, icon: Hash, color: "text-amber-600", bgColor: "bg-amber-100 dark:bg-amber-500/20", href: "/admin/kennels" },
    { label: "Sources", value: stats.enabledSources, icon: Database, color: "text-teal-600", bgColor: "bg-teal-100 dark:bg-teal-500/20", href: "/admin/sources" },
    { label: "Health", value: healthPct, icon: HeartPulse, color: healthPct >= 80 ? "text-emerald-600" : "text-red-600", bgColor: healthPct >= 80 ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-red-100 dark:bg-red-500/20", href: "/admin/sources", suffix: "%" },
    { label: "Alerts", value: stats.activeAlerts, icon: Bell, color: stats.activeAlerts > 0 ? "text-red-600" : "text-emerald-600", bgColor: stats.activeAlerts > 0 ? "bg-red-100 dark:bg-red-500/20" : "bg-emerald-100 dark:bg-emerald-500/20", href: "/admin/alerts" },
    { label: "Audit", value: stats.auditFindings, icon: ShieldCheck, color: stats.auditFindings > 0 ? "text-orange-600" : "text-emerald-600", bgColor: stats.auditFindings > 0 ? "bg-orange-100 dark:bg-orange-500/20" : "bg-emerald-100 dark:bg-emerald-500/20", href: "/admin/audit" },
  ];

  // Derive section guide from shared TAB_ROUTES (skip dashboard — that's this page)
  const sections = TAB_ROUTES.filter((t) => t.value !== "dashboard" && t.description);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform overview and quick links.
        </p>
      </div>

      {/* Stats grid — bold, colored, clickable */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-3">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="group rounded-xl border border-border/50 bg-card p-4 transition-all hover:border-border hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-[18px] w-[18px] ${card.color}`} />
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 transition-all group-hover:text-muted-foreground group-hover:translate-x-0.5" />
            </div>
            <div className={`mt-3 text-2xl font-bold tracking-tight ${card.color}`}>
              <AnimatedCounter target={card.value} />
              {card.suffix && <span className="text-lg">{card.suffix}</span>}
            </div>
            <div className="mt-0.5 text-xs font-medium text-muted-foreground">
              {card.label}
            </div>
          </Link>
        ))}
      </div>

      {/* Section guide */}
      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick Links
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sections.map((section) => {
            const badge =
              section.value === "alerts"
                ? stats.activeAlerts
                : undefined;
            return (
              <Link
                key={section.href}
                href={section.href}
                className="group flex items-start gap-3 rounded-xl border border-border/50 bg-card p-3.5 transition-all hover:border-border hover:shadow-sm"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                  <section.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold group-hover:text-foreground">
                      {section.label}
                    </span>
                    {badge != null && badge > 0 && (
                      <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {section.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
