"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { QuickAddDialog } from "./QuickAddDialog";
import { LogUnlistedRunDialog } from "./LogUnlistedRunDialog";
import { Plus } from "lucide-react";

export function AddRunButton() {
  const [open, setOpen] = useState(false);
  const [showUnlistedForm, setShowUnlistedForm] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} className="mr-1" />
        Add Run
      </Button>
      <QuickAddDialog
        open={open}
        onOpenChange={setOpen}
        onRequestUnlistedRun={() => {
          setOpen(false);
          setShowUnlistedForm(true);
        }}
      />
      <LogUnlistedRunDialog
        open={showUnlistedForm}
        onOpenChange={setShowUnlistedForm}
      />
    </>
  );
}
