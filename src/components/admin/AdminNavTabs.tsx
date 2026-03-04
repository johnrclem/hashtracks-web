"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

const TAB_ROUTES = [
  { value: "requests", href: "/admin/requests", label: "Requests" },
  { value: "misman", href: "/admin/misman", label: "Misman" },
  { value: "kennels", href: "/admin/kennels", label: "Kennels" },
  { value: "regions", href: "/admin/regions", label: "Regions" },
  { value: "sources", href: "/admin/sources", label: "Sources" },
  { value: "discovery", href: "/admin/discovery", label: "Discovery" },
  { value: "research", href: "/admin/research", label: "Research" },
  { value: "roster-groups", href: "/admin/roster-groups", label: "Roster Groups" },
  { value: "events", href: "/admin/events", label: "Events" },
  { value: "alerts", href: "/admin/alerts", label: "Alerts" },
] as const;

/** Map of tab value → badge count. Only tabs with count > 0 show a badge. */
export type BadgeCounts = Partial<Record<(typeof TAB_ROUTES)[number]["value"], number>>;

export function AdminNavTabs({ badgeCounts }: { badgeCounts: BadgeCounts }) {
  const pathname = usePathname();

  const activeTab =
    TAB_ROUTES.find((t) => pathname === t.href || pathname.startsWith(t.href + "/"))?.value ??
    "requests";

  return (
    <Tabs value={activeTab}>
      <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max">
          {TAB_ROUTES.map((tab) => {
            const count = badgeCounts[tab.value] ?? 0;
            return (
              <TabsTrigger key={tab.value} value={tab.value} asChild>
                <Link
                  href={tab.href}
                  className={count > 0 ? "flex items-center gap-1" : undefined}
                >
                  {tab.label}
                  {count > 0 && (
                    <Badge variant="destructive" className="ml-1 text-xs">
                      {count}
                    </Badge>
                  )}
                </Link>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
    </Tabs>
  );
}
