"use client";

import { Label } from "@/components/ui/label";
import { StringArrayEditor } from "./StringArrayEditor";
import { PatternSuggestButton } from "./PatternSuggestButton";

export interface PatternFieldConfig {
  harePatterns?: string[];
  runNumberPatterns?: string[];
}

interface PatternFieldSectionsProps {
  readonly config: PatternFieldConfig;
  readonly onChange: (updates: Partial<PatternFieldConfig>) => void;
  readonly sampleDescriptions?: string[];
  readonly geminiAvailable?: boolean;
  readonly hareDefaultsHint?: string;
  readonly runNumberDefaultsHint?: string;
}

export function PatternFieldSections({
  config,
  onChange,
  sampleDescriptions = [],
  geminiAvailable,
  hareDefaultsHint = "Hare:/Hares:",
  runNumberDefaultsHint = "#N in summary",
}: PatternFieldSectionsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>Hare Patterns</Label>
        <p className="text-xs text-muted-foreground">
          Regex patterns to extract hare names from event descriptions. Each
          must have a capture group. Leave empty to use defaults
          ({hareDefaultsHint}).
        </p>
        <StringArrayEditor
          items={config.harePatterns ?? []}
          onChange={(patterns) =>
            onChange({
              harePatterns: patterns.length > 0 ? patterns : undefined,
            })
          }
          placeholder="e.g., (?:^|\n)\s*WHO ARE THE HARES:\s*(.+)"
          addLabel="Add Hare Pattern"
        />
        <PatternSuggestButton
          sampleDescriptions={sampleDescriptions}
          field="hares"
          geminiAvailable={geminiAvailable}
          onAccept={(pattern) =>
            onChange({
              harePatterns: [...(config.harePatterns ?? []), pattern],
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Run Number Patterns</Label>
        <p className="text-xs text-muted-foreground">
          Regex patterns to extract run numbers from event descriptions. Each
          must have a capture group matching digits. Leave empty to use defaults
          ({runNumberDefaultsHint}).
        </p>
        <StringArrayEditor
          items={config.runNumberPatterns ?? []}
          onChange={(patterns) =>
            onChange({
              runNumberPatterns: patterns.length > 0 ? patterns : undefined,
            })
          }
          placeholder="e.g., Hash\s*#\s*(\d+)"
          addLabel="Add Run Number Pattern"
        />
        <PatternSuggestButton
          sampleDescriptions={sampleDescriptions}
          field="runNumber"
          geminiAvailable={geminiAvailable}
          onAccept={(pattern) =>
            onChange({
              runNumberPatterns: [...(config.runNumberPatterns ?? []), pattern],
            })
          }
        />
      </div>
    </>
  );
}
