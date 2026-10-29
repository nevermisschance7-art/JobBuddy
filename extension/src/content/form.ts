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
  | "country"
  | "current_company"
  | "current_title"
  | "headline"
  | "summary"
  | "city"
  | "address"
  | "postal_code"
  | "region"
  | "phone_type"
  | "worked_here"
  | "resume"
  | "cover_letter"
  | "file"
  | "question";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export type FormField = {
  /**
   * The input, textarea or select; for radio and checkbox groups, the first one; for button
   * choices and custom dropdowns, the first button or the dropdown's control.
   */
  el: Control;
  /** Radio or checkbox group members with their option labels. */
  options?: { el: HTMLInputElement; label: string }[];
  /** Choice buttons ("Yes" / "No" as buttons, as on Ashby) or custom radios (role=radio). */
  choices?: { el: HTMLElement; label: string }[];
  /** A custom dropdown (react-select and similar): typed into, then an option is clicked. */
  combobox?: boolean;
  /** A rich text editor (contenteditable). */
  editable?: boolean;
  label: string;
  kind: FieldKind;
  required: boolean;
};

const cssId = (id: string) => id.replace(/["\\]/g, "\\$&");

const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/\s+/g, " ")
    // Required marks in any language: "*Obligatorio", "* (erforderlich)", "(required)"...
    .replace(
      /\s*[*✱]?\s*\(?\b(required|obligatorio|obligatoria|erforderlich|pflichtfeld|obligatoire|wymagane|obrigat[óo]rio|verplicht)\b\)?/gi,
      "",
    )
    .replace(/\s*[*✱]\s*$/, "")
    .trim();

/** Trap fields for bots ("leave this empty"). Filling one gets an application thrown away. */
const HONEYPOT =
  /robots? only|do not (enter|fill|complete)|leave (this )?(field )?(blank|empty)|if you('| a)re (a )?human|honeypot/i;

function textOf(el: Element | null): string {
  if (!el) return "";
  // Leave out the inputs' own option text inside labels (e.g. select options).
  const copy = el.cloneNode(true) as Element;
  copy
    .querySelectorAll("select, option, input, textarea, script, style")
    .forEach((n) => n.remove());
  // Spaces tidied but required marks ("*", "Obligatorio") kept: isRequired reads them, and
  // callers clean() the text for display.
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
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
    if (text) return text;
  }
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.replace(/\s+/g, " ").trim();
  const wrap = el.closest("label");
  if (wrap && textOf(wrap)) return textOf(wrap);
  return nearbyHeading(el) || clean(el.getAttribute("placeholder"));
}

/** The question heading of the box a control sits in (Greenhouse, Lever, Ashby, BambooHR...). */
function nearbyHeading(el: Element): string {
  let node: Element | null = el.parentElement;
  for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
    const heading = node.querySelector(
      ":scope > label, :scope > legend, :scope > .application-label, :scope > [class*='label' i], :scope > [class*='question' i]",
    );
    if (heading && !heading.contains(el) && textOf(heading)) return textOf(heading);
  }
  return "";
}

/** Upload buttons' own labels say nothing about what to upload. */
const GENERIC_UPLOAD =
  /^(choose|select|browse|upload|attach|add)( a| your)? (file|files|document)s?$|^(upload|attach|browse)$/i;

/** "Resume*", "Name ✱", "Gehalt (erforderlich)", "*Obligatorio"... */
const REQUIRED_MARK =
  /[*✱]\s*$|[*✱]\s*\(?(required|obligatorio|obligatoria|erforderlich|obligatoire|wymagane|obrigat[óo]rio|verplicht)|\((required|erforderlich|obligatorio|obligatoire)\)/i;

function isRequired(el: Element, label: string, raw: string): boolean {
  return (
    (el as HTMLInputElement).required ||
    el.getAttribute("aria-required") === "true" ||
    REQUIRED_MARK.test(raw) ||
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
  /** Test hooks forms carry (data-ui="resume", data-automation-id="email"...). */
  extra?: string;
}): FieldKind {
  const label = meta.label.toLowerCase();
  const hints = `${label} ${meta.name ?? ""} ${meta.id ?? ""} ${meta.extra ?? ""}`
    .toLowerCase()
    .replace(/[_\-[\]]+/g, " ");
  const auto = (meta.autocomplete ?? "").toLowerCase();

  if (meta.type === "file") {
    if (/cover|motivation|anschreiben|lettre|list motywacyjny/.test(hints)) return "cover_letter";
    if (/resume|résumé|\bcv\b|curr[ií]cul|lebenslauf|życiorys/.test(hints)) return "resume";
    return "file";
  }
  if (auto === "given-name") return "first_name";
  if (auto === "family-name") return "last_name";
  if (auto === "name") return "full_name";
  if (auto === "email" || meta.type === "email") return "email";
  if (auto === "tel" || meta.type === "tel") return "phone";

  // Personal-detail questions written out in full ("What is your preferred name?").
  if (/preferred (first )?name|what should we call you|name you go by|nickname/.test(label))
    return "first_name";
  if (/legal (first and last |full )?name|full legal name|first and last name/.test(label))
    return "full_name";
  if (/first line of (your )?address|address line 1|street address/.test(label)) return "address";
  if (/post ?code|postal code|zip ?code/.test(label) && label.split(/\s+/).length <= 8)
    return "postal_code";

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
    if (/^(current )?location$|^location \(city\)$/.test(label)) return "location";
    if (/^(city|town|ciudad|stadt|ort|ville|miasto|cidade)$/.test(label)) return "city";
    if (
      /^(street |home )?address( line 1)?$|^street$|^direcci[óo]n$|^(stra(ss|ß)e|adresse|adres)$/.test(
        label,
      )
    )
      return "address";
    if (
      /^(postal|post|zip)( ?code)?$|^postcode$|^(c[óo]digo postal|plz|postleitzahl|code postal|kod pocztowy)$/.test(
        label,
      )
    )
      return "postal_code";
    if (/^(state|province|region|county|state ?\/ ?province)$/.test(label)) return "region";
    if (/^phone (device |number )?type$/.test(label)) return "phone_type";
    if (
      /^(country|country of residence|country ?\/ ?(region|territory)|pa[ií]s|land|pays|kraj)$/.test(
        label,
      )
    )
      return "country";
    if (/^(current |most recent )?(company|employer|organi[sz]ation)( name)?$/.test(label))
      return "current_company";
    if (/^(current |most recent )?(job )?title$|^current (role|position)$/.test(label))
      return "current_title";
    if (/^headline$|^professional headline$/.test(label)) return "headline";
    if (/^(profile |professional )?summary$|^about (you|yourself|me)$/.test(label))
      return "summary";
  }
  if (
    /cover letter|carta de (motivaci[óo]n|presentaci[óo]n)|anschreiben|lettre de motivation|list motywacyjny/.test(
      label,
    )
  )
    return "cover_letter";
  // "Have you previously worked for Acme?": answered from the CV's employers.
  if (
    /(currently|previously|ever|before) (been )?(work(ed)?|employed) (for|at|by)|(work(ed)?|employed) (for|at|by) .* (before|previously)/.test(
      label,
    )
  )
    return "worked_here";
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

    let raw = labelFor(el, doc);
    // A file input labelled just "Choose File": its box's heading ("Resume*") says what it is.
    if (type === "file" && GENERIC_UPLOAD.test(clean(raw))) raw = nearbyHeading(el) || raw;
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
        extra: HOOK_ATTRS.map((a) => el.getAttribute(a) ?? "").join(" "),
      }),
      required: isRequired(el, label, raw),
      ...(isCombobox(el) ? { combobox: true } : {}),
    });
  }

  // Custom dropdowns that aren't inputs: <div role="combobox">, <button aria-haspopup="listbox">.
  for (const el of doc.querySelectorAll<HTMLElement>(
    "[role='combobox']:not(input), button[aria-haspopup='listbox']",
  )) {
    if (!visible(el) || el.querySelector("input")) continue;
    const raw = labelFor(el, doc);
    const label = clean(raw);
    if (!label) continue;
    out.push({
      el: el as unknown as Control,
      label,
      kind: classify({ label }),
      required: isRequired(el, label, raw),
      combobox: true,
    });
  }

  // Rich text editors (cover letters, long answers): contenteditable boxes.
  for (const el of doc.querySelectorAll<HTMLElement>(
    "[contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']",
  )) {
    if (!visible(el) || el.parentElement?.closest("[contenteditable]")) continue;
    const raw = labelFor(el, doc);
    const label = clean(raw);
    if (!label) continue;
    out.push({
      el: el as unknown as Control,
      label,
      kind: classify({ label }),
      required: isRequired(el, label, raw),
      editable: true,
    });
  }

  out.push(...choiceGroups(doc));
  // Never touch bot traps.
  return out.filter((f) => {
    const el = f.el as unknown as Element;
    const names = `${el.getAttribute?.("name") ?? ""} ${el.id ?? ""}`;
    return !HONEYPOT.test(f.label) && !/honey ?pot|\bhp[_-]/i.test(names);
  });
}

/** Types into a rich text editor the way a person does, so the editor's own code notices. */
export function setEditableText(el: HTMLElement, text: string): void {
  el.focus();
  const doc = el.ownerDocument;
  const selection = doc.getSelection();
  if (selection) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  let inserted = false;
  try {
    inserted = doc.execCommand?.("insertText", false, text) ?? false;
  } catch {
    inserted = false;
  }
  if (!inserted || !el.textContent?.trim()) {
    el.textContent = text;
    el.dispatchEvent(new (doc.defaultView ?? window).Event("input", { bubbles: true }));
  }
}

/** Attributes forms use as stable hooks; they often say what a field is better than its label. */
const HOOK_ATTRS = ["data-ui", "data-automation-id", "data-testid", "data-qa", "data-field"];

/** Inputs that open a list of options to pick from instead of taking free text. */
function isCombobox(el: Element): boolean {
  return (
    el.tagName === "INPUT" &&
    (el.getAttribute("role") === "combobox" ||
      el.getAttribute("aria-autocomplete") === "list" ||
      el.getAttribute("aria-haspopup") === "listbox")
  );
}

const CHOICE = "button, [role='radio']";
const NOT_A_CHOICE = /submit|apply|next|back|previous|upload|attach|remove|delete|add|cancel|save/i;

/**
 * Questions answered by clicking one of a few buttons, like Ashby's "Yes" / "No", or custom
 * radios (role=radio). Two to six short choices side by side, under a question label.
 */
function choiceGroups(doc: Document): FormField[] {
  const out: FormField[] = [];
  const seen = new Set<Element>();
  for (const first of doc.querySelectorAll<HTMLElement>(CHOICE)) {
    const parent = first.parentElement;
    if (!parent || seen.has(parent)) continue;
    seen.add(parent);
    const choices = [...parent.children].filter((c): c is HTMLElement => c.matches(CHOICE));
    const labels = choices.map((c) => clean(c.textContent));
    if (choices.length < 2 || choices.length > 6) continue;
    if (labels.some((l) => !l || l.length > 40 || NOT_A_CHOICE.test(l))) continue;
    if (choices.some((c) => (c as HTMLButtonElement).type === "submit")) continue;
    if (!visible(parent)) continue;
    const raw = labelFor(parent, doc);
    const label = clean(raw);
    if (!label || labels.includes(label)) continue;
    // The question's own "*" (label text is cleaned above, so look at the raw container text).
    const around = (parent.parentElement?.textContent ?? "").replace(parent.textContent ?? "", "");
    out.push({
      el: choices[0] as unknown as Control,
      choices: choices.map((el, i) => ({ el, label: labels[i]! })),
      label,
      kind: "question",
      required: isRequired(parent, label, raw) || around.includes("*"),
    });
  }
  return out;
}

/** A choice button that looks selected (aria-pressed, aria-checked or a "selected" class). */
function isChosen(el: HTMLElement): boolean {
  return (
    el.getAttribute("aria-pressed") === "true" ||
    el.getAttribute("aria-checked") === "true" ||
    /(^|[\s_-])(selected|active|checked)/i.test(el.className)
  );
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
/**
 * The value for one field: from the CV, fixed answers or saved answers, and otherwise what
 * the user typed for the same question on an earlier form (learned answers).
 */
export function valueFor(field: FormField, data: FillData): string | null {
  return knownValue(field, data) ?? learnedValue(field.label, data);
}

/** The user's own earlier answer to (nearly) the same question. */
export function learnedValue(label: string, data: FillData): string | null {
  let best: { answer: string; score: number } | null = null;
  for (const l of data.learned ?? []) {
    const score = questionSimilarity(label, l.question);
    if (!best || score > best.score) best = { answer: l.answer, score };
  }
  return best && best.score >= 0.8 ? best.answer : null;
}

/** What the user has put in a field right now (typed text, picked option), or null. */
export function currentAnswer(field: FormField): string | null {
  if (field.options) return field.options.find((o) => o.el.checked)?.label ?? null;
  if (field.choices) return field.choices.find((c) => isChosen(c.el))?.label ?? null;
  const el = field.el as unknown as HTMLInputElement | HTMLSelectElement | HTMLElement;
  if (field.editable) return (el as HTMLElement).textContent?.trim() || null;
  if (el instanceof (el.ownerDocument.defaultView ?? window).HTMLSelectElement) {
    const option = el.selectedOptions[0];
    return option && option.value ? option.text.trim() : null;
  }
  const input = el as HTMLInputElement;
  if (input.type === "file" || input.type === "password") return null;
  return input.value?.trim() || null;
}

function knownValue(field: FormField, data: FillData): string | null {
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
        data.fixedAnswers.location ??
        ([p.city, p.country ?? p.countryCode].filter(Boolean).join(", ") || null)
      );
    case "country":
      return p.country ?? null;
    case "city":
      return p.city ?? null;
    case "address":
      return p.address ?? null;
    case "postal_code":
      return p.postalCode ?? null;
    case "region":
      return p.region ?? null;
    case "phone_type":
      return p.phone ? "Mobile" : null;
    case "worked_here": {
      // Yes only when the CV lists this employer.
      const company = norm(data.jobCompany ?? "");
      if (!company) return null;
      const worked = (p.employers ?? []).some((e) => {
        const n = norm(e);
        return n === company || n.startsWith(`${company} `) || company.startsWith(`${n} `);
      });
      return worked ? "Yes" : "No";
    }
    case "current_company":
      return p.currentCompany ?? null;
    case "current_title":
      return p.currentTitle ?? null;
    case "headline":
      return p.headline ?? null;
    case "summary":
      return p.summary ?? null;
    case "cover_letter":
      return data.answers.find((a) => a.isCoverLetter)?.answer ?? null;
    case "resume":
    case "file":
      return null;
    case "question": {
      // Sensitive questions: only the user's fixed answers, never a drafted text.
      const key = fixedKeyFor(field.label);
      if (key === "right_to_work" && isYesNo(field)) {
        // "Do you have work authorization...?" with Yes / No: the yes/no fixed answer.
        return data.fixedAnswers.work_authorized ?? yesNoFrom(data.fixedAnswers.right_to_work);
      }
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

/** The answer choices a field offers (radios, buttons, select options). */
export function choiceLabels(field: FormField): string[] {
  if (field.options) return field.options.map((o) => o.label);
  if (field.choices) return field.choices.map((c) => c.label);
  const el = field.el;
  if (el.tagName === "SELECT") return [...(el as HTMLSelectElement).options].map((o) => o.text);
  return [];
}

function isYesNo(field: FormField): boolean {
  const labels = choiceLabels(field).map((l) => l.trim().toLowerCase());
  return labels.some((l) => l.startsWith("yes")) && labels.some((l) => l.startsWith("no"));
}

function yesNoFrom(text: string | undefined): string | null {
  if (!text) return null;
  if (/^\s*yes\b/i.test(text)) return "Yes";
  if (/^\s*no\b/i.test(text)) return "No";
  return null;
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
/** "I prefer not to say", "Decline to self identify", "I don't wish to answer"... */
const DECLINE =
  /prefer not|decline|don ?t (want|wish)|do not (want|wish)|rather not|not to (say|disclose|answer|specify)|choose not|keine angabe|m[öo]chte (ich )?(keine angabe|nicht)|prefiero no|no deseo|no quiero|pr[ée]f[èe]re ne pas|ne souhaite pas|wol[eę] nie|nie chc[eę]|prefiro n[ãa]o/;

export function pickOption<T extends { label: string }>(options: T[], answer: string): T | null {
  const whole = pickOne(options, answer);
  if (whole || !answer.includes(",")) return whole;
  // "Manchester, United Kingdom" in a country list: try the parts, the last (widest) first.
  for (const part of answer
    .split(",")
    .map((p) => p.trim())
    .reverse()) {
    const hit = pickOne(options, part);
    if (hit) return hit;
  }
  return null;
}

function pickOne<T extends { label: string }>(options: T[], answer: string): T | null {
  const a = norm(answer);
  if (!a) return null;
  // A "prefer not to say" answer matches whatever wording the form uses for it.
  if (DECLINE.test(a)) {
    const decline = options.find((o) => DECLINE.test(norm(o.label)));
    if (decline) return decline;
  }
  return (
    options.find((o) => norm(o.label) === a) ??
    options.find((o) => norm(o.label).startsWith(`${a} `) || a.startsWith(`${norm(o.label)} `)) ??
    options.find((o) => norm(o.label).includes(a) && a.length > 3) ??
    null
  );
}

export type FillReport = {
  filled: number;
  missed: FormField[];
  resume: FormField | null;
  /** Custom dropdowns with the value to pick, for fillComboboxes. */
  dropdowns: { field: FormField; value: string }[];
};

/** A real-looking click: pointer and mouse events, then click (for React handlers). */
export function click(el: HTMLElement): void {
  const view = el.ownerDocument.defaultView ?? window;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    const Ev =
      type.startsWith("pointer") && "PointerEvent" in view ? view.PointerEvent : view.MouseEvent;
    el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, button: 0 }));
  }
  el.click();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Visible options of the list a dropdown opened (or any open list on the page). */
function openOptions(control: HTMLElement): HTMLElement[] {
  const doc = control.ownerDocument;
  const listId = control.getAttribute("aria-controls") ?? control.getAttribute("aria-owns");
  const list = listId ? doc.getElementById(listId) : null;
  const scope: ParentNode = list ?? doc;
  const marked = [...scope.querySelectorAll<HTMLElement>("[role='option']")].filter(
    (o) => visible(o) && o.getAttribute("aria-disabled") !== "true",
  );
  if (marked.length > 0) return marked;
  // Lists built without the "option" marker: short visible items of a list or menu that
  // opened for this control (leaf elements only, so a whole list isn't taken as one option).
  const lists = doc.querySelectorAll<HTMLElement>(
    "[role='listbox'], [class*='option' i], [class*='menu' i], [class*='dropdown' i], ul",
  );
  const items: HTMLElement[] = [];
  for (const list of lists) {
    if (!visible(list) || list.contains(control)) continue;
    for (const el of list.querySelectorAll<HTMLElement>("li, div, span, button")) {
      const text = clean(el.textContent);
      if (!text || text.length > 80 || !visible(el)) continue;
      if ([...el.children].some((c) => clean(c.textContent) === text)) continue; // not a leaf
      items.push(el);
    }
  }
  return [...new Set(items)];
}

/**
 * Custom dropdowns: open, type to filter, wait for the options, click the best one.
 * "Warsaw, Poland" also matches an option "Warsaw, Masovian Voivodeship, Poland".
 */
export async function fillComboboxes(
  dropdowns: FillReport["dropdowns"],
  report: FillReport,
): Promise<void> {
  for (const { field, value } of dropdowns) {
    const control = field.el as unknown as HTMLElement;
    const input = control.tagName === "INPUT" ? (control as HTMLInputElement) : null;
    click((input?.closest("[class*='control' i]") as HTMLElement) ?? control);
    control.focus();
    const first = value.split(",")[0]!.trim();
    // Type the whole value; if that finds nothing, the first part ("Warsaw" of "Warsaw, Poland").
    if (input) setNativeValue(input, value.length <= 40 ? value : first);

    let picked: HTMLElement | null = null;
    for (let i = 0; i < 15 && !picked; i++) {
      await wait(150);
      const options = openOptions(control).map((el) => ({ el, label: clean(el.textContent) }));
      if (options.length === 0) {
        if (input && i === 6 && input.value !== first) setNativeValue(input, first);
        continue;
      }
      picked =
        pickOption(options, value)?.el ??
        options.find((o) => norm(o.label).includes(norm(first)))?.el ??
        null;
      if (!picked && i > 4) break;
    }
    if (picked) {
      click(picked);
      report.filled++;
    } else {
      control.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      if (input) setNativeValue(input, "");
      report.missed.push(field);
    }
    await wait(100);
  }
}

/** Fills every field JobBuddy knows. Leaves non-empty fields alone. Returns what's left. */
export function fillForm(fields: FormField[], data: FillData): FillReport {
  const report: FillReport = { filled: 0, missed: [], resume: null, dropdowns: [] };
  for (const f of fields) {
    // One odd field must never stop the rest of the form.
    try {
      fillOne(f, data, report);
    } catch {
      report.missed.push(f);
    }
  }
  return report;
}

function fillOne(f: FormField, data: FillData, report: FillReport): void {
  if (f.kind === "resume") {
    report.resume ??= f;
    return;
  }
  // File fields only ever get the CV (above); a browser refuses text in them.
  if (f.kind === "file") return; // other uploads (photo, portfolio): left alone
  if ((f.el as HTMLInputElement).type === "file") {
    report.missed.push(f); // e.g. a cover letter upload: the user attaches it
    return;
  }
  const value = valueFor(f, data);
  if (f.choices) {
    const choice = value ? pickOption(f.choices, value) : null;
    if (choice && !isChosen(choice.el)) {
      click(choice.el);
      report.filled++;
    } else if (!choice && !f.choices.some((c) => isChosen(c.el))) report.missed.push(f);
    return;
  }
  if (f.editable) {
    const box = f.el as unknown as HTMLElement;
    if (box.textContent?.trim()) return;
    if (value) {
      setEditableText(box, value);
      report.filled++;
    } else report.missed.push(f);
    return;
  }
  if (f.combobox) {
    // Filled afterwards by fillComboboxes: it has to open the list and wait for options.
    if (value) report.dropdowns.push({ field: f, value });
    else report.missed.push(f);
    return;
  }
  if (f.options) {
    const choice = value ? pickOption(f.options, value) : null;
    if (choice && !choice.el.checked) {
      choice.el.click();
      report.filled++;
    } else if (!choice && !f.options.some((o) => o.el.checked)) report.missed.push(f);
    return;
  }
  const el = f.el;
  if (el.value.trim()) return;
  if (!value) {
    report.missed.push(f);
    return;
  }
  if (el instanceof (el.ownerDocument.defaultView ?? window).HTMLSelectElement) {
    const options = [...el.options]
      .map((o) => ({ label: o.text, value: o.value }))
      .filter((o) => o.value);
    const choice = pickOption(options, value);
    if (!choice) {
      report.missed.push(f);
      return;
    }
    setNativeValue(el, choice.value);
  } else if ((el as HTMLInputElement).type === "date") {
    // Date pickers take YYYY-MM-DD; a notice period ("1 month") becomes a start date.
    const date = noticeToDate(value);
    if (!date) {
      report.missed.push(f);
      return;
    }
    setNativeValue(el, date);
  } else {
    setNativeValue(el, value);
  }
  report.filled++;
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
  /thank(s| you)( so much)? for (applying|your (application|interest|submission))|application (has |have )?(been |was )?(\w+ )?(submitted|received|sent|complete)|we('ve| have) (\w+ )?received your application|you('ve| have) (\w+ )?applied|successfully (applied|submitted|sent)|all done!|application complete/i;

/** True when the page looks like the employer's "application received" page. */
export function isConfirmation(doc: Document, url: string): boolean {
  const text = (doc.body?.textContent ?? "").slice(0, 20_000);
  if (!CONFIRM_TEXT.test(text)) return false;
  // A form still full of inputs is the application itself (some pages say "thanks for your interest").
  const inputs = doc.querySelectorAll("input:not([type=hidden]), textarea").length;
  return inputs < 3 || /confirm|thank|submitted|success/i.test(url);
}

/**
 * A notice period as a start date for date pickers ("Date available"): "1 month" -> today
 * plus a month, "2 weeks", "immediately" -> today. A date already written as a date is kept.
 * Returns YYYY-MM-DD (what date inputs take), or null when it can't tell.
 */
export function noticeToDate(text: string, now = new Date()): string | null {
  const t = text.trim().toLowerCase();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return t;
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/immediate|asap|right away|now|none|no notice|^0/.test(t))
    return d.toISOString().slice(0, 10);
  const m = /(\d+|one|two|three|four|six)\s*(day|week|month)/.exec(t);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6 };
  const n = Number(m[1]) || words[m[1]!] || 0;
  if (m[2] === "day") d.setUTCDate(d.getUTCDate() + n);
  else if (m[2] === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
