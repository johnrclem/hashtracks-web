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
  { value: "roster-groups", href: "/admin/roster-groups", label: "Roster Groups" },
  { value: "events", href: "/admin/events", label: "Events" },
  { value: "alerts", href: "/admin/alerts", label: "Alerts" },
] as const;

export function AdminNavTabs({
  openAlertCount,
  pendingMismanCount,
  newDiscoveryCount,
}: {
  openAlertCount: number;
  pendingMismanCount: number;
  newDiscoveryCount: number;
}) {
  const pathname = usePathname();

  const activeTab =
    TAB_ROUTES.find((t) => pathname === t.href || pathname.startsWith(t.href + "/"))?.value ??
    "requests";

  return (
    <Tabs value={activeTab}>
      <div className="overflow-x-auto -mx-1 px-1">
        <TabsList className="inline-flex w-max">
          {TAB_ROUTES.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} asChild>
              <Link
                href={tab.href}
                className={
                  tab.value === "misman" || tab.value === "alerts" || tab.value === "discovery"
                    ? "flex items-center gap-1"
                    : undefined
                }
              >
                {tab.label}
                {tab.value === "misman" && pendingMismanCount > 0 && (
                  <Badge variant="destructive" className="ml-1 text-xs">
                    {pendingMismanCount}
                  </Badge>
                )}
                {tab.value === "discovery" && newDiscoveryCount > 0 && (
                  <Badge variant="destructive" className="ml-1 text-xs">
                    {newDiscoveryCount}
                  </Badge>
                )}
                {tab.value === "alerts" && openAlertCount > 0 && (
                  <Badge variant="destructive" className="ml-1 text-xs">
                    {openAlertCount}
                  </Badge>
                )}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
