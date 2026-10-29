import type { FillData } from "../src/types";
import { collectFields, fillComboboxes, fillForm, type FormField } from "../src/content/form";

// The extension's real form code, bundled for the "Probe forms" workflow: it is loaded into
// live application forms in a headless browser, fills them with sample data and reports
// what it found and missed. Never submits.

function describe(f: FormField) {
  const el = f.el as unknown as HTMLInputElement;
  const control = f.choices
    ? "buttons"
    : f.options
      ? `group:${el.type}`
      : f.combobox
        ? "dropdown"
        : `${el.tagName.toLowerCase()}${el.type ? `:${el.type}` : ""}`;
  return { label: f.label, kind: f.kind, control, required: f.required };
}

async function run(data: FillData) {
  const fields = collectFields(document);
  const report = fillForm(fields, data);
  await fillComboboxes(report.dropdowns, report);
  return {
    url: location.href,
    fields: fields.map(describe),
    filled: report.filled,
    missed: report.missed.map((f) => f.label),
    resume: Boolean(report.resume),
  };
}

(window as unknown as { JobBuddyProbe: unknown }).JobBuddyProbe = { run };
