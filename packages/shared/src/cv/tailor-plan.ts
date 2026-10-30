// Tailoring a CV for one job, as a plan the code applies to the confirmed CV.
//
// The AI never returns a whole CV (it played safe and copied everything). It returns a plan:
// a headline, a summary, which skills to show, which bullets of each job to keep (by number)
// and how to word them, and which projects to keep. The code builds the CV from the plan and
// the original, so employers, titles, dates and skills can only come from the CV; the truth
// checker then checks every reworded line. Without an AI, ruleTailor orders and trims by the
// job's technologies.

import { z } from "zod";
import type { Resume } from "../resume";
import { termsIn } from "./truth";

/** Bullets kept per job: recent roles say more. */
export const BULLETS_RECENT = 5;
export const BULLETS_OLDER = 3;
const RECENT_ROLES = 2;
/** Skill keywords shown at most; fewer than this and the CV keeps all of its own. */
const MAX_SKILLS = 30;
const MIN_SKILLS = 6;

export const tailorPlanSchema = z.object({
  headline: z.string().max(140).optional(),
  summary: z.string().max(1200).optional(),
  skills: z
    .array(z.object({ name: z.string().max(60), keywords: z.array(z.string().max(80)).max(40) }))
    .max(10)
    .default([]),
  work: z
    .array(
      z.object({
        job: z.number().int(),
        bullets: z.array(z.object({ from: z.number().int(), text: z.string().max(400) })).max(12),
      }),
    )
    .default([]),
  projects: z.array(z.number().int()).max(6).optional(),
});
export type TailorPlan = z.infer<typeof tailorPlanSchema>;

/** The CV as the AI sees it: numbered jobs, bullets and projects, so the plan can point. */
export function numberedCv(cv: Resume): string {
  const lines: string[] = [];
  lines.push(`Headline: ${cv.basics.label ?? ""}`);
  lines.push(`Summary: ${cv.basics.summary ?? ""}`);
  lines.push("Skills:");
  for (const g of cv.skills) lines.push(`- ${g.name}: ${g.keywords.join(", ")}`);
  lines.push("Experience:");
  cv.work.forEach((w, j) => {
    lines.push(
      `J${j}. ${w.position} at ${w.name} (${w.startDate ?? "?"} to ${w.endDate ?? "now"})`,
    );
    if (w.summary) lines.push(`   About: ${w.summary}`);
    w.highlights.forEach((b, i) => lines.push(`   B${i}. ${b}`));
  });
  if (cv.projects.length) {
    lines.push("Projects:");
    cv.projects.forEach((p, k) =>
      lines.push(`P${k}. ${p.name}: ${p.description ?? ""} ${p.highlights.join(" ")}`.trim()),
    );
  }
  if (cv.education.length) {
    lines.push("Education:");
    for (const e of cv.education) {
      lines.push(`- ${[e.studyType, e.area].filter(Boolean).join(" ")} at ${e.institution}`);
    }
  }
  return lines.join("\n");
}

const lower = (s: string) => s.trim().toLowerCase();

/** How much a line is about this job: the job's technologies it names, title ones double. */
function relevance(text: string, jobTerms: Set<string>, titleTerms: Set<string>): number {
  let score = 0;
  for (const t of termsIn(text)) {
    if (titleTerms.has(t)) score += 2;
    else if (jobTerms.has(t)) score += 1;
  }
  return score;
}

function bulletCap(index: number): number {
  return index < RECENT_ROLES ? BULLETS_RECENT : BULLETS_OLDER;
}

/** Most relevant first, original order among equals. */
function byRelevance<T>(items: T[], score: (t: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

/** Without an AI: skills and bullets ordered by the job's technologies, the weakest trimmed. */
export function ruleTailor(cv: Resume, jobTitle: string, jobText: string): Resume {
  const jobTerms = termsIn(`${jobTitle}\n${jobText}`);
  const titleTerms = termsIn(jobTitle);
  const score = (text: string) => relevance(text, jobTerms, titleTerms);

  const skills = byRelevance(
    cv.skills.map((g) => ({
      ...g,
      keywords: byRelevance(g.keywords, (k) => score(k)),
    })),
    (g) => g.keywords.reduce((n, k) => n + score(k), 0),
  );
  const work = cv.work.map((w, j) => {
    const ranked = byRelevance(w.highlights, score).slice(0, bulletCap(j));
    // Keep the CV's own order among the bullets that stay: it often tells a story.
    const highlights = w.highlights.filter((b) => ranked.includes(b));
    return { ...w, highlights };
  });
  const projects = byRelevance(cv.projects, (p) =>
    score(`${p.name} ${p.description ?? ""} ${p.highlights.join(" ")} ${p.keywords.join(" ")}`),
  ).slice(0, 3);
  return { ...cv, skills, work, projects };
}

/**
 * The CV built from the AI's plan. Only what the CV has can appear: skills are matched to
 * the CV's own keywords (its spelling), bullets must point at a real bullet, every job stays
 * (with rule-picked bullets where the plan skipped it). Reworded text is checked afterwards
 * by checkTailoredCv.
 */
export function applyPlan(cv: Resume, plan: TailorPlan, jobTitle: string, jobText: string): Resume {
  const fallback = ruleTailor(cv, jobTitle, jobText);

  // Skills: only keywords the CV lists, in the plan's order and groups.
  const known = new Map<string, string>();
  for (const g of cv.skills) for (const k of g.keywords) known.set(lower(k), k);
  const used = new Set<string>();
  let total = 0;
  const planned = plan.skills
    .map((g) => ({
      name: g.name.trim() || "Skills",
      keywords: g.keywords.flatMap((k) => {
        const own = known.get(lower(k));
        if (!own || used.has(lower(own)) || total >= MAX_SKILLS) return [];
        used.add(lower(own));
        total++;
        return [own];
      }),
    }))
    .filter((g) => g.keywords.length > 0);
  const skills = total >= MIN_SKILLS ? planned : fallback.skills;

  const work = cv.work.map((w, j) => {
    const entry = plan.work.find((p) => p.job === j);
    // Each CV bullet at most once, and only bullets that exist.
    const seen = new Set<number>();
    const bullets: string[] = [];
    for (const b of entry?.bullets ?? []) {
      const text = b.text.trim();
      if (b.from < 0 || b.from >= w.highlights.length || seen.has(b.from) || !text) continue;
      seen.add(b.from);
      bullets.push(text);
    }
    bullets.splice(bulletCap(j));
    const highlights =
      bullets.length > 0 || w.highlights.length === 0 ? bullets : fallback.work[j]!.highlights;
    return { ...w, highlights };
  });

  const picked = (plan.projects ?? [])
    .filter((k, i, all) => k >= 0 && k < cv.projects.length && all.indexOf(k) === i)
    .map((k) => cv.projects[k]!);
  const projects = plan.projects ? picked : fallback.projects;

  return {
    ...cv,
    basics: {
      ...cv.basics,
      label: plan.headline?.trim() || cv.basics.label,
      summary: plan.summary?.trim() || cv.basics.summary,
    },
    skills,
    work,
    projects,
  };
}
