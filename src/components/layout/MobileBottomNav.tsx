"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Calendar, Hash, BookOpen, User, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { MobileMoreSheet } from "@/components/layout/MobileMoreSheet";

const tabs = [
  { href: "/hareline", label: "Hareline", icon: Calendar },
  { href: "/kennels", label: "Kennels", icon: Hash },
  { href: "/logbook", label: "Logbook", icon: BookOpen },
  { href: "/profile", label: "Profile", icon: User },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Root path is effectively the hareline, so highlight that tab
  const effectivePath = pathname === "/" ? "/hareline" : pathname;
  const isActive = (href: string) =>
    effectivePath === href || effectivePath.startsWith(`${href}/`);
  const isMoreActive = pathname.startsWith("/misman") || pathname.startsWith("/admin") || pathname.startsWith("/about") || pathname.startsWith("/for-misman");

  return (
    <>
      <nav
        className="fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur-sm md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-16 items-stretch">
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <div className="relative">
                  {active && (
                    <span className="absolute -top-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-orange-400 dark:bg-orange-500" />
                  )}
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            );
          })}

          {/* More tab */}
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More options"
            aria-expanded={moreOpen}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
              isMoreActive || moreOpen ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <div className="relative">
              {isMoreActive && (
                <span className="absolute -top-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-orange-400 dark:bg-orange-500" />
              )}
              <MoreHorizontal className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />}
    </>
  );
}
