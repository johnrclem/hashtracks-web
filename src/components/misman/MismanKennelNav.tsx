"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "attendance", label: "Attendance" },
  { href: "roster", label: "Roster" },
  { href: "history", label: "History" },
  { href: "import", label: "Import" },
];

export function MismanKennelNav({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const tabPath = `/misman/${slug}/${tab.href}`;
        const isActive = pathname.startsWith(tabPath);
        return (
          <Link
            key={tab.href}
            href={tabPath}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
