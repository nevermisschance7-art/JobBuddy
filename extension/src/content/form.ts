import {
  fixedAnswerFor,
  fixedKeyFor,
  isConsentBox,
  questionSimilarity,
  standardAnswer,
} from "@jobbuddy/shared";
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
  // "Please enter your address:", "What is your home address?" (never sent to an AI).
  if (
    /^(please )?(enter|provide|add|give) (us )?(your )?(full |home |current |postal |residential )?address\b|^what is your (full |home |current |postal |residential )?address\b/.test(
      label,
    ) &&
    !/e-?mail|ip address|web address/.test(label)
  )
    return "address";
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
    if (/^location \(city\)$|^(current )?city( of residence)?$/.test(label)) return "city";
    if (/^(current )?location$/.test(label)) return "location";
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

export function visible(el: Element): boolean {
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return true;
  const own = view.getComputedStyle(el as HTMLElement);
  if (own.visibility === "hidden") return false;
  // A form hidden after Submit hides its container, not each field (display isn't inherited).
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (view.getComputedStyle(node as HTMLElement).display === "none") return false;
  }
  return true;
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
  // Custom dropdowns: the text shown, never the hidden input's internal code.
  if (field.combobox) return comboboxText(el as HTMLElement);
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
    case "location": {
      // "City, Country" when known: a country alone makes place lists pick a random place.
      const fixed = data.fixedAnswers.location?.trim();
      if (fixed && fixed.includes(",")) return fixed;
      const country = fixed || p.country || p.countryCode;
      return [p.city, country].filter(Boolean).join(", ") || null;
    }
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
      return data.coverLetterText ?? data.answers.find((a) => a.isCoverLetter)?.answer ?? null;
    case "resume":
    case "file":
      return null;
    case "question": {
      const plain = field.label.toLowerCase();
      // "If yes, tell us their names. Otherwise, please list N/A."
      if (
        /otherwise,? (please )?(list|write|enter|put|type|answer|say)?\s*["']?n\/?a\b/.test(plain)
      )
        return "N/A";
      // "Are you 18 years of age or older?": yes when the CV shows years of work.
      if (/\b(18|eighteen) (years )?(of age |years old )?or older\b|at least 18\b/.test(plain))
        return p.adult ? "Yes" : null;
      // "What is your current time zone?" (a list of zones): the user's own, else "Other".
      if (/time ?zone/.test(plain) && (field.options || field.choices || isSelectLike(field))) {
        return timeZoneAnswer(p.timeZone, choiceLabels(field));
      }
      // Sensitive questions: only the user's fixed answers, never a drafted text.
      const key = fixedKeyFor(field.label);
      if (key === "right_to_work" && isYesNo(field)) {
        // "Do you have work authorization...?" with Yes / No: the yes/no fixed answer.
        return data.fixedAnswers.work_authorized ?? yesNoFrom(data.fixedAnswers.right_to_work);
      }
      if (key) return fixedAnswerFor(key, data.fixedAnswers) ?? null;
      // The owner's standing answers to personal questions (always No / fully remote only).
      const standard = standardAnswer(field.label);
      if (standard) {
        const choice = Boolean(field.options || field.choices || isSelectLike(field));
        return choice ? standard.choice : standard.text;
      }
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

function isSelectLike(field: FormField): boolean {
  return field.el.tagName === "SELECT" || Boolean(field.combobox);
}

/**
 * The user's time zone in the form's words: the listed option with the same GMT/UTC offset
 * ("(GMT+00:00) London"), else "Other". Without a known list (custom dropdowns), the offset.
 */
export function timeZoneAnswer(
  timeZone: string | null | undefined,
  options: string[] = [],
  now = new Date(),
): string | null {
  const other = () => options.find((o) => /^other\b/i.test(o.trim())) ?? null;
  let offset: string;
  try {
    const part = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone ?? undefined,
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value; // "GMT+01:00", or "GMT" for +00:00
    offset = !part || part === "GMT" ? "+00:00" : part.replace(/^GMT/, "");
  } catch {
    return other();
  }
  const sign = offset[0] === "-" ? "-" : "+";
  const hh = offset.slice(1, 3);
  const mm = offset.slice(4, 6) || "00";
  if (options.length === 0) return `GMT${sign}${hh}:${mm}`;
  const hours = Number(hh);
  const minutes = Number(mm);
  // "(GMT+01:00)", "UTC+1", "GMT -5"; for +00:00 also a bare "GMT" or "UTC".
  const same = (label: string) => {
    for (const m of label.matchAll(/\b(?:gmt|utc)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/gi)) {
      if (m[1] === sign && Number(m[2]) === hours && Number(m[3] ?? 0) === minutes) return true;
    }
    return hours === 0 && minutes === 0 && /\b(?:gmt|utc)\b(?!\s*[+-]\s*\d)/i.test(label);
  };
  return options.find(same) ?? other();
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
    yesNoOption(options, a)
  );
}

const NEGATIVE = /\b(no|not|none|don ?t|do not|am not|have not|haven ?t)\b/;

/** "No" for "I am not a protected veteran", "Yes" for "I identify as one of the
 * veterans...": the one option that says (or doesn't say) no, besides the decline option. */
function yesNoOption<T extends { label: string }>(options: T[], a: string): T | null {
  if (a !== "yes" && a !== "no") return null;
  const real = options.filter((o) => norm(o.label) && !DECLINE.test(norm(o.label)));
  const negative = real.filter((o) => NEGATIVE.test(norm(o.label)));
  const positive = real.filter((o) => !NEGATIVE.test(norm(o.label)));
  const pick = a === "no" ? negative : positive;
  return pick.length === 1 ? pick[0]! : null;
}

export type FillReport = {
  filled: number;
  /** Fields filled with what the user typed on an earlier form (learned answers). */
  fromLearned: number;
  missed: FormField[];
  resume: FormField | null;
  /** A cover letter upload field, for the tailored cover letter PDF. */
  coverLetter: FormField | null;
  /** Consent tick boxes ticked for the user (privacy policy, terms): shown to check. */
  consented: FormField[];
  /** Custom dropdowns with the value to pick, for fillComboboxes (zone: a time zone list). */
  dropdowns: { field: FormField; value: string; zone?: string | null }[];
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
/** The value a custom dropdown shows as picked (react-select, Workday...), or null. */
export function comboboxText(control: HTMLElement): string | null {
  const box =
    (control.closest("[class*='container' i], [class*='control' i]") as HTMLElement | null) ??
    control.parentElement ??
    control;
  const value = box.querySelector(
    "[class*='singleValue' i], [class*='single-value' i], [class*='multiValue' i], [class*='multi-value' i], [data-automation-id='promptOption'], [data-automation-id='selectedItem']",
  );
  if (value?.textContent?.trim()) return value.textContent.trim();
  // A button-style dropdown shows its value as its own text (the hidden input holds a code).
  const shown =
    control.tagName === "INPUT"
      ? ""
      : [...control.childNodes]
          .map((n) =>
            n.nodeType === 1 && /placeholder/i.test((n as Element).className?.toString() ?? "")
              ? ""
              : (n.textContent ?? ""),
          )
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
  return shown && !PLACEHOLDER.test(shown) ? shown : null;
}

/** "Select One", "Choose...", "--": a dropdown's placeholder, not a value or a question. */
export const PLACEHOLDER =
  /^(select|choose|please (select|choose)|pick|start typing|--)( one| an? (option|answer)| from the list)?\W*$/i;

export const comboboxHasValue = (control: HTMLElement) => comboboxText(control) !== null;

export async function fillComboboxes(
  dropdowns: FillReport["dropdowns"],
  report: FillReport,
): Promise<void> {
  for (const { field, value, zone } of dropdowns) {
    const control = field.el as unknown as HTMLElement;
    const input = control.tagName === "INPUT" ? (control as HTMLInputElement) : null;
    click((input?.closest("[class*='control' i]") as HTMLElement) ?? control);
    control.focus();
    const first = value.split(",")[0]!.trim();
    const place = field.kind === "city" || field.kind === "location";
    // Type the whole value; if that finds nothing, the first part ("Warsaw" of "Warsaw, Poland").
    // Place lists: type the city only, they search by place name.
    // Time zone lists: open the whole list (nothing typed) and pick the user's zone or Other.
    if (input && zone === undefined) {
      setNativeValue(input, place ? first : value.length <= 40 ? value : first);
    }

    let picked: HTMLElement | null = null;
    for (let i = 0; i < 15 && !picked; i++) {
      await wait(150);
      const options = openOptions(control).map((el) => ({ el, label: clean(el.textContent) }));
      if (options.length === 0) {
        if (input && i === 6 && input.value !== first) setNativeValue(input, first);
        continue;
      }
      if (zone !== undefined) {
        const label = timeZoneAnswer(
          zone,
          options.map((o) => o.label),
        );
        picked = options.find((o) => o.label === label)?.el ?? null;
        if (!picked && i > 4) break;
        continue;
      }
      picked = place
        ? placeOption(options, value)
        : (pickOption(options, value)?.el ??
          options.find((o) => norm(o.label).includes(norm(first)))?.el ??
          null);
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

/**
 * A place from a list of places: it must be the city itself ("Norwich, Norfolk, United
 * Kingdom"), preferably in the right country. Never just any place in the country (that
 * picked "Halley Research Station (United Kingdom), Antarctica" for "United Kingdom").
 */
export function placeOption(
  options: { el: HTMLElement; label: string }[],
  value: string,
): HTMLElement | null {
  const parts = value
    .split(",")
    .map((p) => norm(p))
    .filter(Boolean);
  const city = parts[0];
  if (!city) return null;
  const country = parts.length > 1 ? parts.at(-1)! : null;
  const named = options.filter((o) => {
    const label = norm(o.label);
    return label === city || label.startsWith(`${city} `);
  });
  const inCountry = country ? named.find((o) => norm(o.label).includes(country)) : null;
  return (inCountry ?? named[0])?.el ?? null;
}

/** Fills every field JobBuddy knows. Leaves non-empty fields alone. Returns what's left. */
export function fillForm(fields: FormField[], data: FillData): FillReport {
  const report: FillReport = {
    filled: 0,
    fromLearned: 0,
    missed: [],
    resume: null,
    coverLetter: null,
    consented: [],
    dropdowns: [],
  };
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
    if (f.kind === "cover_letter" && data.coverLetter) report.coverLetter ??= f;
    else report.missed.push(f); // another upload the user attaches
    return;
  }
  // A field that already has an answer (picked by the user, or by an earlier fill) is never
  // changed: JobBuddy only fills gaps.
  if (f.choices?.some((c) => isChosen(c.el))) return;
  if (f.options?.some((o) => o.el.checked)) return;
  // A single consent tick box (privacy policy, terms, "I certify"): ticked, for the user to
  // check before Submit. Never a marketing opt-in.
  const box = f.options?.length === 1 ? f.options[0]! : null;
  if (box && box.el.type === "checkbox" && isConsentBox(`${f.label} ${box.label}`)) {
    box.el.click();
    report.consented.push(f);
    report.filled++;
    return;
  }
  if (f.combobox && comboboxHasValue(f.el as unknown as HTMLElement)) return;
  const known = knownValue(f, data);
  const value = known ?? learnedValue(f.label, data);
  if (!known && value) report.fromLearned++;
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
    const zone = /time ?zone/i.test(f.label) ? (data.profile.timeZone ?? null) : undefined;
    if (value) report.dropdowns.push({ field: f, value, ...(zone !== undefined ? { zone } : {}) });
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
  const inputs = [...doc.querySelectorAll("input:not([type=hidden]), textarea")].filter(
    visible,
  ).length;
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
