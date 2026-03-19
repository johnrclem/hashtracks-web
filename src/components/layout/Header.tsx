"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignedIn, SignedOut, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Globe, Clock, Thermometer, Sun, Moon, Monitor } from "lucide-react";
import { Wordmark } from "@/components/layout/Wordmark";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navLinks = [
  { href: "/hareline", label: "Hareline" },
  { href: "/logbook", label: "Logbook" },
  { href: "/kennels", label: "Kennels" },
  { href: "/profile", label: "Profile" },
];

export function Header() {
  const { user } = useUser();
  const isAdmin = (user?.publicMetadata as { role?: string } | undefined)?.role === "admin";
  const { preference, setPreference, isLoading } = useTimePreference();
  const { tempUnit, setTempUnit } = useUnitsPreference();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const mismanHref = user ? "/misman" : "/for-misman";
  const mismanActive = isActive("/misman") || isActive("/for-misman");

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Wordmark />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-foreground ${isActive(link.href) ? "text-foreground" : "text-muted-foreground"}`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href={mismanHref}
            className={`text-sm font-medium transition-colors hover:text-foreground ${
              mismanActive ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            Misman
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className={`text-sm font-medium transition-colors hover:text-foreground ${isActive("/admin") ? "text-foreground" : "text-muted-foreground"}`}
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {/* Timezone Toggle — desktop only, mobile uses More sheet */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hidden h-9 w-9 md:inline-flex" aria-label="Time display preference" title="Time display" disabled={isLoading}>
                {preference === "USER_LOCAL" ? <Clock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                <span className="sr-only">Toggle time display preference</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Time Display</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setPreference("EVENT_LOCAL")}
                className={preference === "EVENT_LOCAL" ? "bg-accent" : ""}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium flex items-center gap-2"><Globe className="h-4 w-4" /> Event Local Time</span>
                  <span className="text-xs text-muted-foreground">Times match the event&apos;s physical location</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setPreference("USER_LOCAL")}
                className={preference === "USER_LOCAL" ? "bg-accent" : ""}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium flex items-center gap-2"><Clock className="h-4 w-4" /> My Local Time</span>
                  <span className="text-xs text-muted-foreground">Times translated to your current timezone</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Temperature Units Toggle — desktop only */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hidden h-9 w-9 md:inline-flex" aria-label="Temperature units" title="Temperature units">
                <Thermometer className="h-4 w-4" />
                <span className="sr-only">Toggle temperature units</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Temperature</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => { setTempUnit("IMPERIAL"); }}
                className={tempUnit === "IMPERIAL" ? "bg-accent" : ""}
              >
                °F — Fahrenheit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setTempUnit("METRIC"); }}
                className={tempUnit === "METRIC" ? "bg-accent" : ""}
              >
                °C — Celsius
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme Toggle — desktop only */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hidden h-9 w-9 md:inline-flex" aria-label="Theme" title="Theme">
                {resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTheme("light")} className={theme === "light" ? "bg-accent" : ""}>
                <Sun className="mr-2 h-4 w-4" /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")} className={theme === "dark" ? "bg-accent" : ""}>
                <Moon className="mr-2 h-4 w-4" /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")} className={theme === "system" ? "bg-accent" : ""}>
                <Monitor className="mr-2 h-4 w-4" /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <SignedIn>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <SignInButton>
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </SignInButton>
          </SignedOut>
        </div>
      </div>
    </header>
  );
}
