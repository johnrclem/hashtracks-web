"use client";

import Link from "next/link";
import { useUser, useClerk } from "@clerk/nextjs";
import { Globe, Thermometer, Info, Shield, Users, LogOut, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { useUnitsPreference, type TempUnit } from "@/components/providers/units-preference-provider";
import type { TimeDisplayPref } from "@/generated/prisma/client";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
}

const navLinkClass = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted";

export function MobileMoreSheet({ open, onClose }: MobileMoreSheetProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const isAdmin = (user?.publicMetadata as { role?: string } | undefined)?.role === "admin";
  const { preference, setPreference } = useTimePreference();
  const { tempUnit, setTempUnit } = useUnitsPreference();
  const { theme, setTheme } = useTheme();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="fixed! bottom-0! top-auto! left-0! right-0! translate-x-0! translate-y-0! max-w-full! rounded-t-2xl! rounded-b-none! pb-[env(safe-area-inset-bottom)]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">More options</DialogTitle>

        {/* Drag indicator */}
        <div className="flex justify-center pb-2">
          <div className="h-1 w-8 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Navigation links */}
        <nav className="space-y-1">
          <Link href={user ? "/misman" : "/for-misman"} onClick={onClose} className={navLinkClass}>
            <Users className="h-4 w-4 text-muted-foreground" />
            Misman
          </Link>
          {isAdmin && (
            <Link href="/admin" onClick={onClose} className={navLinkClass}>
              <Shield className="h-4 w-4 text-muted-foreground" />
              Admin
            </Link>
          )}
          <Link href="/about" onClick={onClose} className={navLinkClass}>
            <Info className="h-4 w-4 text-muted-foreground" />
            About
          </Link>
        </nav>

        {/* Preferences */}
        <div className="border-t pt-3">
          <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Preferences
          </p>
          <div className="space-y-3 px-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Globe className="h-4 w-4" /> Time
              </span>
              <ToggleGroup type="single" variant="outline" size="sm" value={preference} onValueChange={(v) => { if (v === "EVENT_LOCAL" || v === "USER_LOCAL") setPreference(v); }}>
                <ToggleGroupItem value="EVENT_LOCAL">Event</ToggleGroupItem>
                <ToggleGroupItem value="USER_LOCAL">Local</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Thermometer className="h-4 w-4" /> Temp
              </span>
              <ToggleGroup type="single" variant="outline" size="sm" value={tempUnit} onValueChange={(v) => { if (v === "IMPERIAL" || v === "METRIC") setTempUnit(v); }}>
                <ToggleGroupItem value="IMPERIAL">°F</ToggleGroupItem>
                <ToggleGroupItem value="METRIC">°C</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sun className="h-4 w-4" /> Theme
              </span>
              <ToggleGroup type="single" variant="outline" size="sm" value={theme} onValueChange={(v) => v && setTheme(v)}>
                <ToggleGroupItem value="light" aria-label="Light"><Sun className="h-3.5 w-3.5" /></ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label="Dark"><Moon className="h-3.5 w-3.5" /></ToggleGroupItem>
                <ToggleGroupItem value="system" aria-label="System"><Monitor className="h-3.5 w-3.5" /></ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>

        {/* Feedback + Sign out */}
        <div className="border-t pt-3 space-y-1">
          <FeedbackDialog />
          {user && (
            <button
              onClick={() => { signOut(); onClose(); }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
