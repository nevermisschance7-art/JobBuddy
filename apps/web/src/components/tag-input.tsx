"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/field";

export type TagOption = { value: string; label: string };

/** Chips you add with Enter or comma. Submits a JSON array in a hidden field called `name`. */
export function TagInput({
  name,
  id,
  initial = [],
  options,
  placeholder,
  upperCase = false,
}: {
  name: string;
  id?: string;
  initial?: string[];
  options?: TagOption[];
  placeholder?: string;
  upperCase?: boolean;
}) {
  const [values, setValues] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const listId = useId();
  const labelOf = (v: string) => options?.find((o) => o.value === v)?.label ?? v;

  function add(raw: string) {
    let v = raw.trim();
    if (!v) return;
    if (options) {
      const match = options.find(
        (o) =>
          o.value.toLowerCase() === v.toLowerCase() || o.label.toLowerCase() === v.toLowerCase(),
      );
      if (!match) return;
      v = match.value;
    }
    if (upperCase) v = v.toUpperCase();
    if (!values.includes(v)) setValues([...values, v]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={JSON.stringify(values)} />
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {values.map((v) => (
            <li
              key={v}
              className="flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-3 text-sm"
            >
              {labelOf(v)}
              <button
                type="button"
                aria-label={`Remove ${labelOf(v)}`}
                className="rounded-full p-0.5 hover:bg-background"
                onClick={() => setValues(values.filter((x) => x !== v))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        value={draft}
        list={options ? listId : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // Picking from the datalist fills the whole label at once.
          if (options?.some((o) => o.label === v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            setValues(values.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
      />
      {options ? (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o.value} value={o.label} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
