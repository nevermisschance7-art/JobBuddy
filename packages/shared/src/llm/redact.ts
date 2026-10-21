import type { PersonalInfo } from "./types";

// Replaces personal details with placeholders before text goes to a model and puts them
// back afterwards. Fixed answers are replaced too, so they can never reach a model.

type Term = { value: string; placeholder: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Phone numbers match even when spacing or punctuation differs. */
function phonePattern(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits
    .split("")
    .map((d, i) => (i === 0 ? `\\+?${d}` : `[\\s().-]*${d}`))
    .join("");
}

export class Redactor {
  private readonly terms: Term[] = [];
  private readonly patterns: { re: RegExp; placeholder: string }[] = [];

  constructor(info: PersonalInfo) {
    const add = (value: string | null | undefined, placeholder: string, minLength = 3) => {
      const v = value?.trim();
      if (!v || v.length < minLength) return;
      this.terms.push({ value: v, placeholder });
    };
    add(info.name, "{{NAME}}");
    add(info.email, "{{EMAIL}}");
    add(info.address, "{{ADDRESS}}", 6);
    (info.fixedAnswers ?? []).forEach((a, i) => add(a, `{{FIXED_${i + 1}}}`, 4));

    // Also catch the first and last name on their own.
    const parts = (info.name ?? "")
      .trim()
      .split(/\s+/)
      .filter((p) => p.length >= 3);
    if (parts.length > 1) {
      add(parts[0], "{{FIRST_NAME}}");
      add(parts[parts.length - 1], "{{LAST_NAME}}");
    }

    // Longest first so "Sam Tester" wins over "Sam".
    this.terms.sort((a, b) => b.value.length - a.value.length);
    for (const t of this.terms) {
      this.patterns.push({
        re: new RegExp(`(?<![\\w@])${escape(t.value)}(?![\\w@])`, "gi"),
        placeholder: t.placeholder,
      });
    }
    const phone = info.phone ? phonePattern(info.phone) : null;
    if (phone && info.phone) {
      this.terms.push({ value: info.phone.trim(), placeholder: "{{PHONE}}" });
      this.patterns.unshift({ re: new RegExp(phone, "g"), placeholder: "{{PHONE}}" });
    }
  }

  redact(text: string): string {
    let out = text;
    for (const p of this.patterns) out = out.replace(p.re, p.placeholder);
    return out;
  }

  restore(text: string): string {
    let out = text;
    for (const t of this.terms) out = out.split(t.placeholder).join(t.value);
    return out;
  }

  /** Restores placeholders inside every string of a parsed JSON value. */
  restoreDeep<T>(value: T): T {
    if (typeof value === "string") return this.restore(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.restoreDeep(v)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.restoreDeep(v)]),
      ) as T;
    }
    return value;
  }
}
