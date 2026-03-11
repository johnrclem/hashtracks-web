"use client";

import Link from "next/link";
import { useUser, useClerk } from "@clerk/nextjs";
import { Globe, Clock, Thermometer, Info, Shield, Users, LogOut } from "lucide-react";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
}

export function MobileMoreSheet({ open, onClose }: MobileMoreSheetProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const isAdmin = (user?.publicMetadata as { role?: string } | undefined)?.role === "admin";
  const { preference, setPreference } = useTimePreference();
  const { tempUnit, setTempUnit } = useUnitsPreference();

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
          <Link
            href={user ? "/misman" : "/for-misman"}
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Users className="h-4 w-4 text-muted-foreground" />
            Misman
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Shield className="h-4 w-4 text-muted-foreground" />
              Admin
            </Link>
          )}
          <Link
            href="/about"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Info className="h-4 w-4 text-muted-foreground" />
            About
          </Link>
        </nav>

        {/* Preferences */}
        <div className="border-t pt-3">
          <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Preferences
          </p>

          {/* Time display */}
          <div className="space-y-1">
            <button
              onClick={() => setPreference("EVENT_LOCAL")}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                preference === "EVENT_LOCAL" ? "bg-muted font-medium" : "hover:bg-muted"
              }`}
            >
              <Globe className="h-4 w-4 text-muted-foreground" />
              Event Local Time
            </button>
            <button
              onClick={() => setPreference("USER_LOCAL")}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                preference === "USER_LOCAL" ? "bg-muted font-medium" : "hover:bg-muted"
              }`}
            >
              <Clock className="h-4 w-4 text-muted-foreground" />
              My Local Time
            </button>
          </div>

          {/* Temperature */}
          <div className="mt-2 space-y-1">
            <button
              onClick={() => setTempUnit("IMPERIAL")}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                tempUnit === "IMPERIAL" ? "bg-muted font-medium" : "hover:bg-muted"
              }`}
            >
              <Thermometer className="h-4 w-4 text-muted-foreground" />
              °F — Fahrenheit
            </button>
            <button
              onClick={() => setTempUnit("METRIC")}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                tempUnit === "METRIC" ? "bg-muted font-medium" : "hover:bg-muted"
              }`}
            >
              <Thermometer className="h-4 w-4 text-muted-foreground" />
              °C — Celsius
            </button>
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
