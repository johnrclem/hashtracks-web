"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  ClipboardCheck,
  Hash,
  Globe,
  Database,
  Sparkles,
  Search,
  Users,
  Calendar,
  Bell,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface TabRoute {
  value: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Description shown on the admin dashboard section guide. */
  description?: string;
}

export const TAB_ROUTES: TabRoute[] = [
  { value: "dashboard", href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { value: "requests", href: "/admin/requests", label: "Requests", icon: Inbox, description: "Review user requests to add new kennels to the platform." },
  { value: "misman", href: "/admin/misman", label: "Misman", icon: ClipboardCheck, description: "Approve misman access requests and manage invites." },
  { value: "kennels", href: "/admin/kennels", label: "Kennels", icon: Hash, description: "Add, edit, merge, and geocode kennel profiles." },
  { value: "regions", href: "/admin/regions", label: "Regions", icon: Globe, description: "Manage geographic regions and hierarchy (country/state/metro)." },
  { value: "sources", href: "/admin/sources", label: "Sources", icon: Database, description: "Monitor data sources, health status, and scrape configurations." },
  { value: "discovery", href: "/admin/discovery", label: "Discovery", icon: Sparkles, description: "Review AI-discovered kennels and match to existing records." },
  { value: "research", href: "/admin/research", label: "Research", icon: Search, description: "Run source research for coverage gaps, review proposals." },
  { value: "roster-groups", href: "/admin/roster-groups", label: "Roster Groups", icon: Users, description: "Create and manage shared roster groups across kennels." },
  { value: "events", href: "/admin/events", label: "Events", icon: Calendar, description: "Browse, filter, and manage canonical events." },
  { value: "alerts", href: "/admin/alerts", label: "Alerts", icon: Bell, description: "Monitor source health alerts and take repair actions." },
];

/** Map of tab value → badge count. Only tabs with count > 0 show a badge. */
export type BadgeCounts = Partial<Record<string, number>>;

export function AdminNavTabs({ badgeCounts }: Readonly<{ badgeCounts: BadgeCounts }>) {
  const pathname = usePathname();

  const activeTab =
    TAB_ROUTES.find((t) => {
      if (t.value === "dashboard") return pathname === "/admin";
      return pathname === t.href || pathname.startsWith(t.href + "/");
    })?.value ?? "dashboard";

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <nav className="inline-flex gap-0.5 rounded-lg bg-muted/50 p-1">
        {TAB_ROUTES.map((tab) => {
          const count = badgeCounts[tab.value] ?? 0;
          const isActive = activeTab === tab.value;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.value}
              href={tab.href}
              className={`relative flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{tab.label}</span>
              {count > 0 && (
                <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
                  {count}
                </span>
              )}
              {isActive && (
                <span className="sm:hidden absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-slate-500" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
