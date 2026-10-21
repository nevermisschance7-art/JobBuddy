import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";

/** Text field, trimmed. Empty becomes null. */
export function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whole number field. Empty or invalid becomes null. */
export function int(formData: FormData, name: string): number | null {
  const value = text(formData, name);
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** All checked values of a checkbox group. */
export function list(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
}

/** A JSON string array from a TagInput hidden field. */
export function tags(formData: FormData, name: string): string[] {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const values = parsed.filter((v): v is string => typeof v === "string").map((v) => v.trim());
    return [...new Set(values.filter(Boolean))];
  } catch {
    return [];
  }
}

/** After a successful save: go to the form's `next` step if it has one, else return the state. */
export function finish(formData: FormData, state: ActionState): ActionState {
  const next = formData.get("next");
  if (state.ok && typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
    redirect(next);
  }
  return state;
}
