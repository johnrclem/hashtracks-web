"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface StringArrayEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  transform?: (value: string) => string;
}

export function StringArrayEditor({
  items,
  onChange,
  placeholder,
  addLabel = "Add Item",
  transform,
}: StringArrayEditorProps) {
  function addItem() {
    onChange([...items, ""]);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function updateItem(index: number, value: string) {
    onChange(items.map((item, i) => (i === index ? value : item)));
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            placeholder={placeholder}
            value={item}
            onChange={(e) => updateItem(i, e.target.value)}
            onBlur={
              transform
                ? (e) => updateItem(i, transform(e.target.value))
                : undefined
            }
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeItem(i)}
          >
            &times;
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addItem}>
        {addLabel}
      </Button>
    </div>
  );
}
