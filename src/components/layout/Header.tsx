"use client";

import Link from "next/link";
import { SignInButton, SignedIn, SignedOut, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Globe, Clock, Thermometer } from "lucide-react";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useUser();
  const isAdmin = (user?.publicMetadata as { role?: string } | undefined)?.role === "admin";
  const { preference, setPreference, isLoading } = useTimePreference();
  const { tempUnit, setTempUnit } = useUnitsPreference();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          HashTracks
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          {user && (
            <Link
              href="/misman"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Misman
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {/* Timezone Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Time display preference" disabled={isLoading}>
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
                  <span className="text-xs text-muted-foreground">Times match the event's physical location</span>
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

          {/* Temperature Units Toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Temperature units">
                <Thermometer className="h-4 w-4" />
                <span className="sr-only">Toggle temperature units</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Temperature</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setTempUnit("IMPERIAL")}
                className={tempUnit === "IMPERIAL" ? "bg-accent" : ""}
              >
                °F — Fahrenheit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTempUnit("METRIC")}
                className={tempUnit === "METRIC" ? "bg-accent" : ""}
              >
                °C — Celsius
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

          {/* Mobile hamburger */}
          <button
            className="ml-2 md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <nav className="border-t px-4 py-2 md:hidden">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block py-2 text-sm font-medium text-muted-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          {user && (
            <Link
              href="/misman"
              className="block py-2 text-sm font-medium text-muted-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              Misman
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              className="block py-2 text-sm font-medium text-muted-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              Admin
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
