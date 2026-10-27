import type { Resume } from "@jobbuddy/shared";

// One simple layout that both the PDF and the Word file are drawn from. ATS friendly:
// one column, standard section names, plain text, no tables, images or icons.

export type CvBlock =
  | { kind: "name"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "section"; text: string }
  | { kind: "entry"; title: string; right?: string; sub?: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(d: string | undefined): string {
  if (!d) return "";
  const [y, m] = d.split("-");
  const month = m ? MONTHS[Number(m) - 1] : undefined;
  return month ? `${month} ${y}` : (y ?? "");
}

function range(start?: string, end?: string, current = true): string {
  if (!start && !end) return "";
  const to = end ? formatDate(end) : current ? "Present" : "";
  return [formatDate(start), to].filter(Boolean).join(" - ");
}

const join = (parts: (string | undefined)[], sep: string) =>
  parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(sep);

export function cvBlocks(r: Resume): CvBlock[] {
  const out: CvBlock[] = [{ kind: "name", text: r.basics.name }];
  const b = r.basics;
  const place = join([b.location?.city, b.location?.countryCode], ", ");
  const contact = join(
    [b.label, place, b.email, b.phone, b.url, ...b.profiles.map((p) => p.url)],
    " | ",
  );
  if (contact) out.push({ kind: "contact", text: contact });

  if (b.summary)
    out.push({ kind: "section", text: "Summary" }, { kind: "paragraph", text: b.summary });

  if (r.work.length > 0) {
    out.push({ kind: "section", text: "Experience" });
    for (const w of r.work) {
      out.push({
        kind: "entry",
        title: `${w.position}, ${w.name}`,
        right: range(w.startDate, w.endDate),
        sub: w.location,
      });
      if (w.summary) out.push({ kind: "paragraph", text: w.summary });
      for (const h of w.highlights) out.push({ kind: "bullet", text: h });
    }
  }

  if (r.skills.length > 0) {
    out.push({ kind: "section", text: "Skills" });
    for (const s of r.skills) {
      const list = s.keywords.join(", ");
      out.push({ kind: "paragraph", text: r.skills.length > 1 ? `${s.name}: ${list}` : list });
    }
  }

  if (r.projects.length > 0) {
    out.push({ kind: "section", text: "Projects" });
    for (const p of r.projects) {
      out.push({
        kind: "entry",
        title: p.name,
        right: range(p.startDate, p.endDate, false),
        sub: p.url,
      });
      if (p.description) out.push({ kind: "paragraph", text: p.description });
      for (const h of p.highlights) out.push({ kind: "bullet", text: h });
      if (p.keywords.length > 0)
        out.push({ kind: "paragraph", text: `Tech: ${p.keywords.join(", ")}` });
    }
  }

  if (r.education.length > 0) {
    out.push({ kind: "section", text: "Education" });
    for (const e of r.education) {
      out.push({
        kind: "entry",
        title: e.institution,
        right: range(e.startDate, e.endDate, false),
        sub: join([e.studyType, e.area, e.score], ", "),
      });
    }
  }

  if (r.certificates.length > 0) {
    out.push({ kind: "section", text: "Certificates" });
    for (const c of r.certificates) {
      out.push({ kind: "bullet", text: join([c.name, c.issuer, formatDate(c.date)], ", ") });
    }
  }

  if (r.languages.length > 0) {
    out.push({ kind: "section", text: "Languages" });
    out.push({
      kind: "paragraph",
      text: r.languages
        .map((l) => (l.fluency ? `${l.language} (${l.fluency})` : l.language))
        .join(", "),
    });
  }
  return out;
}

/** A safe file name like "Sam-Tester-CV-Acme". */
export function cvFileName(r: Resume, company: string): string {
  const slug = (s: string) =>
    s
      .replace(/ł/g, "l")
      .replace(/Ł/g, "L")
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return [slug(r.basics.name), "CV", slug(company)].filter(Boolean).join("-");
}
