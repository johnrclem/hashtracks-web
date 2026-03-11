"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
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

const navLinkClass = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted";

const prefBtnClass = (active: boolean) =>
  `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-muted font-medium" : "hover:bg-muted"}`;

export function MobileMoreSheet({ open, onClose }: MobileMoreSheetProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const isAdmin = (user?.publicMetadata as { role?: string } | undefined)?.role === "admin";
  const { preference, setPreference } = useTimePreference();
  const { tempUnit, setTempUnit } = useUnitsPreference();

  const prefOptions: { icon: LucideIcon; label: string; active: boolean; onSelect: () => void }[] = [
    { icon: Globe, label: "Event Local Time", active: preference === "EVENT_LOCAL", onSelect: () => setPreference("EVENT_LOCAL") },
    { icon: Clock, label: "My Local Time", active: preference === "USER_LOCAL", onSelect: () => setPreference("USER_LOCAL") },
    { icon: Thermometer, label: "°F — Fahrenheit", active: tempUnit === "IMPERIAL", onSelect: () => setTempUnit("IMPERIAL") },
    { icon: Thermometer, label: "°C — Celsius", active: tempUnit === "METRIC", onSelect: () => setTempUnit("METRIC") },
  ];

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
          <div className="space-y-1">
            {prefOptions.map((opt) => {
              const Icon = opt.icon;
              return (
                <button key={opt.label} onClick={opt.onSelect} className={prefBtnClass(opt.active)}>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {opt.label}
                </button>
              );
            })}
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
