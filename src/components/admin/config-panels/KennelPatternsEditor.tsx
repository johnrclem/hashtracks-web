"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface KennelPatternsEditorProps {
  patterns: [string, string][];
  onChange: (patterns: [string, string][]) => void;
}

export function KennelPatternsEditor({
  patterns,
  onChange,
}: KennelPatternsEditorProps) {
  function addRow() {
    onChange([...patterns, ["", ""]]);
  }

  function removeRow(index: number) {
    onChange(patterns.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: 0 | 1, value: string) {
    const updated = patterns.map((row, i) => {
      if (i !== index) return row;
      const copy: [string, string] = [...row];
      copy[field] = value;
      return copy;
    });
    onChange(updated);
  }

  return (
    <div className="space-y-2">
      {patterns.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder="Regex pattern (e.g., ^EWH3)"
            value={row[0]}
            onChange={(e) => updateRow(i, 0, e.target.value)}
            className="flex-1 font-mono text-xs"
          />
          <Input
            placeholder="Kennel tag"
            value={row[1]}
            onChange={(e) => updateRow(i, 1, e.target.value)}
            className="w-32 text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeRow(i)}
          >
            &times;
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        Add Pattern
      </Button>
    </div>
  );
}
