"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { TAB_ROUTES, type BadgeCounts } from "./AdminNavTabs";
import { useState } from "react";

/** Group definitions for sidebar sections */
const NAV_GROUPS = [
  {
    label: "Overview",
    tabs: ["dashboard", "analytics"],
  },
  {
    label: "Data",
    tabs: ["sources", "kennels", "events", "regions"],
  },
  {
    label: "Operations",
    tabs: ["alerts", "discovery", "research"],
  },
  {
    label: "Access",
    tabs: ["requests", "misman", "roster-groups"],
  },
];

const tabMap = Object.fromEntries(TAB_ROUTES.map((t) => [t.value, t]));

export function AdminSidebar({
  badgeCounts,
}: Readonly<{ badgeCounts: BadgeCounts }>) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const activeTab =
    TAB_ROUTES.find((t) => {
      if (t.value === "dashboard") return pathname === "/admin";
      return pathname === t.href || pathname.startsWith(t.href + "/");
    })?.value ?? "dashboard";

  return (
    <aside
      className={`sticky top-4 flex h-[calc(100vh-2rem)] flex-col rounded-xl border border-border/50 bg-card transition-all duration-200 ${
        collapsed ? "w-[52px]" : "w-[220px]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06]">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight">Admin</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.tabs.map((tabValue) => {
                const tab = tabMap[tabValue];
                if (!tab) return null;
                const count = badgeCounts[tab.value] ?? 0;
                const isActive = activeTab === tab.value;
                const Icon = tab.icon;
                const isUrgent =
                  tab.value === "alerts" && count > 0;

                return (
                  <Link
                    key={tab.value}
                    href={tab.href}
                    title={collapsed ? tab.label : undefined}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all ${
                      isActive
                        ? "bg-accent text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive
                          ? "text-foreground"
                          : isUrgent
                            ? "text-red-500"
                            : "text-muted-foreground group-hover:text-foreground"
                      } transition-colors`}
                    />
                    {!collapsed && (
                      <>
                        <span className="truncate">{tab.label}</span>
                        {count > 0 && (
                          <span
                            className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                              isUrgent
                                ? "bg-red-500/15 text-red-500"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {count}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && count > 0 && (
                      <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${isUrgent ? "bg-red-500" : "bg-muted-foreground/40"}`} />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
