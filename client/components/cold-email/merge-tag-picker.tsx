"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  BUILT_IN_FIELDS,
  toToken,
  type BuiltInField,
} from "@/lib/personalize";

export interface MergeTagPickerProps {
  /**
   * Token names already present in the editor body — used to highlight chips
   * that have been used at least once.
   */
  used: string[];
  /**
   * Custom metadata keys discovered from the contact list. Shown alongside the
   * built-in fields so senders don't have to remember spelling.
   */
  customFields?: string[];
  /**
   * Called when a chip is clicked. The editor handles cursor placement.
   */
  onInsert: (field: string, token: string) => void;
}

/**
 * The chip tray beneath the body field. Clicking a chip asks the editor to
 * insert the canonical `{{ field }}` token at the current caret position.
 */
export function MergeTagPicker({ used, customFields = [], onInsert }: MergeTagPickerProps) {
  const [query, setQuery] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const usedSet = useMemo(() => new Set(used.map((t) => t.toLowerCase())), [used]);
  const custom = useMemo(
    () => customFields.filter((f) => !BUILT_IN_FIELDS.includes(f as BuiltInField)),
    [customFields],
  );

  const allFields = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    const matches = (field: string) => field.toLowerCase().includes(normalisedQuery);
    return [
      ...BUILT_IN_FIELDS.filter(matches),
      ...custom.filter(matches).filter((f) => !BUILT_IN_FIELDS.includes(f as BuiltInField)),
    ];
  }, [query, custom]);

  const handleCustomAdd = () => {
    const clean = customValue.trim().toLowerCase().replace(/\s+/g, "_");
    if (!clean) return;
    onInsert(clean, toToken(clean));
    setCustomValue("");
    setAddingCustom(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>Insert merge tag</span>
        </div>
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {allFields.map((field) => {
          const isUsed = usedSet.has(field.toLowerCase());
          const isCustom = !BUILT_IN_FIELDS.includes(field as BuiltInField);
          return (
            <Button
              key={field}
              type="button"
              variant={isUsed ? "secondary" : "outline"}
              size="sm"
              onClick={() => onInsert(field, toToken(field))}
              className="h-7 gap-1 px-2 text-xs"
              title={`Insert {{ ${field} }}`}
            >
              <span className="font-mono">{`{{ ${field} }}`}</span>
              {isCustom && <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">custom</span>}
            </Button>
          );
        })}
        {!allFields.length && (
          <span className="text-xs text-muted-foreground">No fields match “{query}”.</span>
        )}
      </div>

      {addingCustom ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCustomAdd();
              } else if (e.key === "Escape") {
                setAddingCustom(false);
                setCustomValue("");
              }
            }}
            placeholder="custom_field_key (e.g. industry)"
            className="h-7 max-w-xs text-xs"
          />
          <Button size="sm" variant="default" className="h-7" onClick={handleCustomAdd}>
            Insert
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              setAddingCustom(false);
              setCustomValue("");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setAddingCustom(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Custom field
        </Button>
      )}
    </div>
  );
}
