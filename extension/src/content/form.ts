import { fixedKeyFor, questionSimilarity } from "@jobbuddy/shared";
import type { FillData } from "../types";

// Reads an application form and fills it. Pure DOM code (no chrome.*), tested with jsdom.
// Never clicks or submits anything.

export type FieldKind =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "linkedin"
  | "github"
  | "website"
  | "resume"
  | "cover_letter"
  | "file"
  | "question";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export type FormField = {
  /** The input, textarea or select; for radio and checkbox groups, the first one. */
  el: Control;
  /** Radio or checkbox group members with their option labels. */
  options?: { el: HTMLInputElement; label: string }[];
  label: string;
  kind: FieldKind;
  required: boolean;
};

const cssId = (id: string) => id.replace(/["\\]/g, "\\$&");

const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*\*\s*$/, "")
    .trim();

function textOf(el: Element | null): string {
  if (!el) return "";
  // Leave out the inputs' own option text inside labels (e.g. select options).
  const copy = el.cloneNode(true) as Element;
  copy
    .querySelectorAll("select, option, input, textarea, script, style")
    .forEach((n) => n.remove());
  return clean(copy.textContent);
}

/** The visible question for a control: <label for>, wrapping label, aria, then the nearest heading-like text. */
export function labelFor(el: Element, doc: Document = el.ownerDocument): string {
  const id = el.getAttribute("id");
  if (id) {
    const byFor = doc.querySelector(`label[for="${cssId(id)}"]`);
    if (byFor && textOf(byFor)) return textOf(byFor);
  }
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((i) => textOf(doc.getElementById(i)))
      .join(" ")
      .trim();
    if (text) return clean(text);
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const wrap = el.closest("label");
  if (wrap && textOf(wrap)) return textOf(wrap);
  // Field containers used by Greenhouse, Lever, Ashby, Workable and SmartRecruiters.
  let node: Element | null = el.parentElement;
  for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
    const heading = node.querySelector(
      ":scope > label, :scope > legend, :scope > .application-label, :scope > [class*='label' i], :scope > [class*='question' i]",
    );
    if (heading && !heading.contains(el) && textOf(heading)) return textOf(heading);
  }
  return clean(el.getAttribute("placeholder"));
}

function isRequired(el: Element, label: string, raw: string): boolean {
  return (
    (el as HTMLInputElement).required ||
    el.getAttribute("aria-required") === "true" ||
    /\*\s*$/.test(raw) ||
    /\(required\)/i.test(label)
  );
}

/** What a field asks for, from its label and attributes. */
export function classify(meta: {
  label: string;
  name?: string;
  id?: string;
  type?: string;
  autocomplete?: string;
}): FieldKind {
  const label = meta.label.toLowerCase();
  const hints = `${label} ${meta.name ?? ""} ${meta.id ?? ""}`
    .toLowerCase()
    .replace(/[_\-[\]]+/g, " ");
  const auto = (meta.autocomplete ?? "").toLowerCase();

  if (meta.type === "file") {
    if (/cover/.test(hints)) return "cover_letter";
    if (/resume|résumé|\bcv\b|curriculum/.test(hints)) return "resume";
    return "file";
  }
  if (auto === "given-name") return "first_name";
  if (auto === "family-name") return "last_name";
  if (auto === "name") return "full_name";
  if (auto === "email" || meta.type === "email") return "email";
  if (auto === "tel" || meta.type === "tel") return "phone";

  // Longer questions are questions, even if they mention a keyword ("Why LinkedIn?").
  const short = label.split(/\s+/).length <= 6;
  if (short) {
    if (/\b(first|given|fore)\s?name\b|\bfirstname\b/.test(hints)) return "first_name";
    if (/\b(last|family|sur)\s?name\b|\blastname\b|\bsurname\b/.test(hints)) return "last_name";
    if (/\bfull name\b|^name$|^your name$/.test(label) || meta.name === "name") return "full_name";
    if (/e-?mail/.test(hints)) return "email";
    if (/\b(phone|mobile|telephone|tel)\b/.test(hints)) return "phone";
    if (/linked\s?in/.test(hints)) return "linkedin";
    if (/git\s?hub/.test(hints)) return "github";
    if (/portfolio|website|personal (site|url)|^url$|other website/.test(hints)) return "website";
    if (/^(current )?(location|city)$|^location \(city\)$/.test(label)) return "location";
  }
  if (/cover letter/.test(label)) return "cover_letter";
  return "question";
}

function visible(el: Element): boolean {
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el as HTMLElement);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

/** Every fillable field in the document, in page order. Radio and checkbox groups count once. */
export function collectFields(doc: Document): FormField[] {
  const out: FormField[] = [];
  const groups = new Map<string, FormField>();
  const controls = doc.querySelectorAll<Control>("input, textarea, select");
  for (const el of controls) {
    const type = (el as HTMLInputElement).type?.toLowerCase() ?? "";
    if (["hidden", "submit", "button", "reset", "image", "search", "password"].includes(type))
      continue;
    if (el.disabled || (el as HTMLInputElement).readOnly) continue;
    // File inputs are often hidden behind a styled button; keep them anyway.
    if (type !== "file" && !visible(el)) continue;

    if (type === "radio" || type === "checkbox") {
      const name = el.getAttribute("name") ?? el.id;
      const optionLabel = labelOwn(el as HTMLInputElement);
      const group = groups.get(name);
      if (group) {
        group.options!.push({ el: el as HTMLInputElement, label: optionLabel });
        continue;
      }
      const container =
        el.closest(
          "fieldset, [role='radiogroup'], [role='group'], .field, .application-question",
        ) ?? el.parentElement?.parentElement;
      const legend = [
        ...(container?.querySelectorAll("legend, label, .application-label, [class*='label' i]") ??
          []),
      ].find((n) => !n.querySelector("input") && clean(n.textContent));
      const raw = legend ? (legend.textContent ?? "") : optionLabel;
      const label = clean(raw);
      const field: FormField = {
        el,
        options: [{ el: el as HTMLInputElement, label: optionLabel }],
        label,
        kind: classify({ label }),
        required: isRequired(el, label, raw),
      };
      groups.set(name, field);
      out.push(field);
      continue;
    }

    const raw = labelFor(el, doc);
    const label = clean(raw);
    out.push({
      el,
      label,
      kind: classify({
        label,
        name: el.getAttribute("name") ?? "",
        id: el.id,
        type,
        autocomplete: el.getAttribute("autocomplete") ?? "",
      }),
      required: isRequired(el, label, raw),
    });
  }
  return out;
}

function labelOwn(el: HTMLInputElement): string {
  if (el.id) {
    const l = el.ownerDocument.querySelector(`label[for="${cssId(el.id)}"]`);
    if (l) return clean(l.textContent);
  }
  return clean(el.closest("label")?.textContent ?? el.value);
}

// ---------------------------------------------------------------- answers

/** The value for one field, or null when JobBuddy doesn't know it. */
export function valueFor(field: FormField, data: FillData): string | null {
  const p = data.profile;
  switch (field.kind) {
    case "first_name":
      return p.firstName;
    case "last_name":
      return p.lastName;
    case "full_name":
      return p.fullName;
    case "email":
      return p.email;
    case "phone":
      return p.phone;
    case "linkedin":
      return p.linkedin;
    case "github":
      return p.github;
    case "website":
      return p.website;
    case "location":
      return (
        data.fixedAnswers.location ?? ([p.city, p.countryCode].filter(Boolean).join(", ") || null)
      );
    case "cover_letter":
      return data.answers.find((a) => a.isCoverLetter)?.answer ?? null;
    case "resume":
    case "file":
      return null;
    case "question": {
      // Sensitive questions: only the user's fixed answers, never a drafted text.
      const key = fixedKeyFor(field.label);
      if (key) return data.fixedAnswers[key] ?? null;
      let best: { answer: string; score: number } | null = null;
      for (const a of data.answers) {
        if (a.isCoverLetter) continue;
        const score = questionSimilarity(field.label, a.question);
        if (!best || score > best.score) best = { answer: a.answer, score };
      }
      return best && best.score >= 0.6 ? best.answer : null;
    }
  }
}

// ---------------------------------------------------------------- filling

/** Sets a value the way React and other frameworks notice: native setter, then events. */
export function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const view = el.ownerDocument.defaultView ?? window;
  const proto =
    el instanceof view.HTMLTextAreaElement
      ? view.HTMLTextAreaElement.prototype
      : el instanceof view.HTMLSelectElement
        ? view.HTMLSelectElement.prototype
        : view.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new view.Event("input", { bubbles: true }));
  el.dispatchEvent(new view.Event("change", { bubbles: true }));
  el.dispatchEvent(new view.Event("blur", { bubbles: true }));
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The option that best matches an answer ("No" matches "No, I don't need sponsorship"). */
export function pickOption<T extends { label: string }>(options: T[], answer: string): T | null {
  const a = norm(answer);
  if (!a) return null;
  return (
    options.find((o) => norm(o.label) === a) ??
    options.find((o) => norm(o.label).startsWith(`${a} `) || a.startsWith(`${norm(o.label)} `)) ??
    options.find((o) => norm(o.label).includes(a) && a.length > 3) ??
    null
  );
}

export type FillReport = { filled: number; missed: FormField[]; resume: FormField | null };

/** Fills every field JobBuddy knows. Leaves non-empty fields alone. Returns what's left. */
export function fillForm(fields: FormField[], data: FillData): FillReport {
  const report: FillReport = { filled: 0, missed: [], resume: null };
  for (const f of fields) {
    if (f.kind === "resume") {
      report.resume ??= f;
      continue;
    }
    if (f.kind === "file") continue;
    const value = valueFor(f, data);
    if (f.options) {
      const choice = value ? pickOption(f.options, value) : null;
      if (choice && !choice.el.checked) {
        choice.el.click();
        report.filled++;
      } else if (!choice && !f.options.some((o) => o.el.checked)) report.missed.push(f);
      continue;
    }
    const el = f.el;
    if (el.value.trim()) continue;
    if (!value) {
      report.missed.push(f);
      continue;
    }
    if (el instanceof (el.ownerDocument.defaultView ?? window).HTMLSelectElement) {
      const options = [...el.options]
        .map((o) => ({ label: o.text, value: o.value }))
        .filter((o) => o.value);
      const choice = pickOption(options, value);
      if (!choice) {
        report.missed.push(f);
        continue;
      }
      setNativeValue(el, choice.value);
    } else {
      setNativeValue(el, value);
    }
    report.filled++;
  }
  return report;
}

/** Puts the CV file into a file input (DataTransfer), or drops it on a drop zone. */
export function attachFile(input: HTMLInputElement, file: File): boolean {
  const view = input.ownerDocument.defaultView ?? window;
  if (typeof view.DataTransfer !== "function") return false;
  try {
    const dt = new view.DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new view.Event("input", { bubbles: true }));
    input.dispatchEvent(new view.Event("change", { bubbles: true }));
    if (input.files?.length) return true;
  } catch {
    // Fall through to the drop zone.
  }
  const zone = input.closest("[class*='drop' i], [data-testid*='drop' i]") ?? input.parentElement;
  if (!zone) return false;
  const dt = new view.DataTransfer();
  dt.items.add(file);
  for (const type of ["dragenter", "dragover", "drop"]) {
    zone.dispatchEvent(
      new view.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  }
  return true;
}

/** Questions on the form to send to the web app for drafting ("Prepare this one"). */
export function formQuestions(fields: FormField[]): string[] {
  return [
    ...new Set(
      fields
        .filter((f) => f.kind === "question" || f.kind === "cover_letter")
        .map((f) => f.label)
        .filter((l) => l.length > 2),
    ),
  ];
}

// ---------------------------------------------------------------- confirmation

const CONFIRM_TEXT =
  /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|you('ve| have) (successfully )?applied|successfully applied/i;

/** True when the page looks like the employer's "application received" page. */
export function isConfirmation(doc: Document, url: string): boolean {
  const text = (doc.body?.textContent ?? "").slice(0, 20_000);
  if (!CONFIRM_TEXT.test(text)) return false;
  // A form still full of inputs is the application itself (some pages say "thanks for your interest").
  const inputs = doc.querySelectorAll("input:not([type=hidden]), textarea").length;
  return inputs < 3 || /confirm|thank|submitted|success/i.test(url);
}
