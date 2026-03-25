"use client";

import { useState } from "react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SuggestKennelForm } from "@/components/suggest/SuggestKennelForm";

interface SuggestKennelDialogProps {
  trigger: React.ReactNode;
}

export function SuggestKennelDialog({ trigger }: SuggestKennelDialogProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  // On mobile, navigate to the full-page suggest form instead of opening a dialog
  if (isMobile) {
    return (
      <Link href="/suggest">
        {trigger}
      </Link>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Suggest a Kennel</DialogTitle>
          <DialogDescription>
            Help us grow! Tell us about a kennel we should add.
          </DialogDescription>
        </DialogHeader>
        <SuggestKennelForm onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
