"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  approveProposal,
  rejectProposal,
  updateProposalUrl,
  refineProposal,
} from "@/app/admin/research/actions";
import { TYPE_LABELS } from "./SourceTable";
import type { SerializedProposal } from "./ResearchDashboard";
import type { SourceType } from "@/generated/prisma/client";

const SOURCE_TYPES: SourceType[] = [
  "HTML_SCRAPER",
  "GOOGLE_CALENDAR",
  "GOOGLE_SHEETS",
  "ICAL_FEED",
  "HASHREGO",
  "MEETUP",
  "RSS_FEED",
  "JSON_API",
];

interface Props {
  proposal: SerializedProposal;
  onClose: () => void;
}

export function ProposalApprovalDialog({ proposal, onClose }: Props) {
  const [isPending, startTransition] = useTransition();

  // Editable fields
  const [url, setUrl] = useState(proposal.url);
  const [sourceName, setSourceName] = useState(
    proposal.sourceName ?? (proposal.kennelName ? `${proposal.kennelName} Website` : ""),
  );
  const [sourceType, setSourceType] = useState<SourceType | "">(
    proposal.detectedType ?? "",
  );
  const [configJson, setConfigJson] = useState(
    proposal.extractedConfig
      ? JSON.stringify(proposal.extractedConfig, null, 2)
      : "",
  );
  const [feedback, setFeedback] = useState("");
  const [showConfigEditor, setShowConfigEditor] = useState(false);

  function handleReAnalyze() {
    if (!url.trim()) return;
    startTransition(async () => {
      const result = await updateProposalUrl(proposal.id, url);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success("Re-analyzed successfully");
        onClose(); // Refresh data
      }
    });
  }

  function handleRefine() {
    if (!feedback.trim()) return;
    startTransition(async () => {
      const result = await refineProposal(proposal.id, feedback);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success("Config refined");
        setFeedback("");
        onClose(); // Refresh data
      }
    });
  }

  function handleApprove() {
    if (!sourceType) {
      toast.error("Select a source type");
      return;
    }
    startTransition(async () => {
      const result = await approveProposal(proposal.id, {
        name: sourceName || undefined,
        type: sourceType as SourceType,
        kennelId: proposal.kennelId ?? undefined,
        config: configJson || undefined,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success("Source created!");
        onClose();
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectProposal(proposal.id);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else {
        toast.success("Proposal rejected");
        onClose();
      }
    });
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Review Proposal
            {proposal.confidence && (
              <Badge
                variant={proposal.confidence === "high" ? "default" : "secondary"}
                className="text-xs"
              >
                {proposal.confidence} confidence
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Review and approve this source proposal to create a new data source
            {proposal.kennelName ? ` for ${proposal.kennelName}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* URL + Re-analyze */}
          <div className="space-y-1">
            <Label>URL</Label>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleReAnalyze}
                disabled={isPending || url === proposal.url}
              >
                {isPending ? "..." : "Re-analyze"}
              </Button>
            </div>
          </div>

          {/* Source Name */}
          <div className="space-y-1">
            <Label>Source Name</Label>
            <Input
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="e.g., NYCH3 Website"
            />
          </div>

          {/* Type + Kennel */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Source Type</Label>
              <Select
                value={sourceType}
                onValueChange={(v) => setSourceType(v as SourceType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Kennel</Label>
              <Input
                value={proposal.kennelName ?? "—"}
                disabled
                className="bg-muted"
              />
            </div>
          </div>

          {/* Explanation */}
          {proposal.explanation && (
            <div className="rounded-md border p-3 bg-muted/50">
              <p className="text-sm text-muted-foreground">{proposal.explanation}</p>
            </div>
          )}

          {/* Config preview */}
          {configJson && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Config Preview</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfigEditor(!showConfigEditor)}
                >
                  {showConfigEditor ? "Hide Editor" : "Edit Config JSON"}
                </Button>
              </div>
              {showConfigEditor ? (
                <Textarea
                  value={configJson}
                  onChange={(e) => setConfigJson(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
              ) : (
                <pre className="rounded-md border p-3 bg-muted/50 text-xs overflow-x-auto max-h-40">
                  {configJson}
                </pre>
              )}
            </div>
          )}

          {/* Feedback / Refine */}
          <div className="space-y-1">
            <Label>Feedback (refine AI config)</Label>
            <div className="flex gap-2">
              <Input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder='e.g., "location is in column 4, not 3"'
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefine}
                disabled={isPending || !feedback.trim()}
              >
                {isPending ? "..." : "Refine"}
              </Button>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={handleReject}
            disabled={isPending}
          >
            Reject
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isPending || !sourceType}
          >
            {isPending ? "Creating..." : "Approve & Create Source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
