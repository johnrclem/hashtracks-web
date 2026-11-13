"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmKennelRunning, stopKennel } from "@/app/admin/kennels/status-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type StatusDialogMode = "running" | "stopped";

interface KennelStatusDialogProps {
  kennelId: string;
  kennelName: string;
  mode: StatusDialogMode | null;
  onClose: () => void;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function KennelStatusDialog({ kennelId, kennelName, mode, onClose }: Readonly<KennelStatusDialogProps>) {
  const [observedOn, setObservedOn] = useState(todayUtc);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const stopping = mode === "stopped";

  function submit() {
    setError(null);
    startTransition(async () => {
      const input = { observedOn, note, url: url.trim() || undefined };
      const result = stopping
        ? await stopKennel(kennelId, input)
        : await confirmKennelRunning(kennelId, input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(stopping ? "Kennel marked stopped" : "Confirmed running");
      setNote("");
      setUrl("");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stopping ? `Mark ${kennelName} stopped` : `Confirm ${kennelName} running`}</DialogTitle>
          <DialogDescription>
            {stopping
              ? "Hides this kennel's generated schedule runs and pauses its static schedule. You can restart it later."
              : "Records that you checked this kennel is still running."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`status-date-${kennelId}`}>Date you checked</Label>
            <Input
              id={`status-date-${kennelId}`}
              type="date"
              value={observedOn}
              max={todayUtc()}
              onChange={(e) => setObservedOn(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`status-note-${kennelId}`}>How do you know?</Label>
            <Textarea
              id={`status-note-${kennelId}`}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Their Facebook page posted a trail for this Saturday"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`status-url-${kennelId}`}>Link (optional)</Label>
            <Input
              id={`status-url-${kennelId}`}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant={stopping ? "destructive" : "default"}
            onClick={submit}
            disabled={isPending}
          >
            {isPending ? "Saving..." : stopping ? "Mark stopped" : "Confirm running"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
