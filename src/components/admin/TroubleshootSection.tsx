"use client";

import { useState } from "react";
import { ConfigureAndTest } from "./ConfigureAndTest";
import type { KennelOption } from "./config-panels/KennelTagInput";

interface TroubleshootSectionProps {
  url: string;
  type: string;
  config: Record<string, unknown> | null;
  allKennels: KennelOption[];
  linkedKennelIds: string[];
  geminiAvailable?: boolean;
}

/**
 * Collapsible "Troubleshoot Config" section for the source detail page.
 * Embeds ConfigureAndTest with the source's current config pre-loaded.
 * Changes are NOT auto-saved — use the Edit dialog to save.
 */
export function TroubleshootSection({
  url,
  type,
  config,
  allKennels,
  linkedKennelIds,
  geminiAvailable,
}: TroubleshootSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [configObj, setConfigObj] = useState(config);
  const [configJson, setConfigJson] = useState(
    config ? JSON.stringify(config, null, 2) : "",
  );
  const [selectedKennels, setSelectedKennels] = useState(linkedKennelIds);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="text-xs">{isOpen ? "▾" : "▸"}</span>
        Troubleshoot Config
      </button>

      {isOpen && (
        <div className="rounded-md border p-4">
          <p className="mb-4 text-xs text-muted-foreground">
            Test the source config without saving. Changes here won&apos;t be
            persisted — use the Edit button above to save permanently.
          </p>
          <ConfigureAndTest
            url={url}
            type={type}
            config={configObj}
            configJson={configJson}
            selectedKennels={selectedKennels}
            allKennels={allKennels}
            geminiAvailable={geminiAvailable}
            onConfigChange={(c, j) => {
              setConfigObj(c);
              setConfigJson(j);
            }}
            onKennelsChange={setSelectedKennels}
          />
        </div>
      )}
    </div>
  );
}
