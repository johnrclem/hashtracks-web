"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  Users,
  Clock,
  Upload,
  Settings,
} from "lucide-react";

const tabs = [
  { href: "attendance", label: "Attendance", icon: ClipboardCheck },
  { href: "roster", label: "Roster", icon: Users },
  { href: "history", label: "History", icon: Clock },
  { href: "import", label: "Import", icon: Upload },
  { href: "settings", label: "Settings", icon: Settings },
];

export function MismanKennelNav({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-0.5 rounded-lg bg-muted/50 p-1">
      {tabs.map((tab) => {
        const tabPath = `/misman/${slug}/${tab.href}`;
        const isActive = pathname.startsWith(tabPath);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tabPath}
            className={`relative flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{tab.label}</span>
            {isActive && (
              <span className="sm:hidden absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-orange-500" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
