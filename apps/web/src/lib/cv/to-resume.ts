import type { Resume } from "@jobbuddy/shared";

// Converts CV text into a JSON Resume draft for the user to check and complete.
// TEMPORARY: a simple rule-based reader. Prompt 3 replaces this with the AI router
// (generate_json with resumeSchema). The user always reviews and confirms the result.

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?(linkedin\.com\/in\/[\w-]+|github\.com\/[\w-]+)\/?/gi;

const SECTION_HEADINGS: Record<
  string,
  keyof Pick<Resume, "work" | "education" | "skills" | "projects">
> = {
  experience: "work",
  "work experience": "work",
  employment: "work",
  "professional experience": "work",
  education: "education",
  skills: "skills",
  "technical skills": "skills",
  projects: "projects",
};

export function cvTextToResume(text: string): Resume {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const name = lines.find((l) => !EMAIL.test(l) && !PHONE.test(l) && l.length <= 60) ?? "";
  const email = text.match(EMAIL)?.[0];
  const phone = text.match(PHONE)?.[0]?.trim();
  const profiles = [...text.matchAll(URL_RE)].map((m) => {
    const path = m[1] ?? "";
    return {
      network: path.toLowerCase().startsWith("github") ? "GitHub" : "LinkedIn",
      url: `https://${path}`,
    };
  });

  // Skills: the lines under a "Skills" heading, split on commas.
  const skills: string[] = [];
  let section: string | null = null;
  for (const line of lines) {
    const heading = SECTION_HEADINGS[line.toLowerCase().replace(/[:\s]+$/, "")];
    if (heading) {
      section = heading;
      continue;
    }
    if (section === "skills") {
      skills.push(
        ...line
          .replace(/^[-•*]\s*/, "")
          .split(/[,|;•]/)
          .map((s) => s.trim())
          .filter((s) => s && s.length <= 40),
      );
    }
  }

  return {
    basics: {
      name,
      email,
      phone,
      summary: undefined,
      profiles,
    },
    work: [],
    education: [],
    skills: skills.length > 0 ? [{ name: "Skills", keywords: [...new Set(skills)] }] : [],
    projects: [],
    languages: [],
    certificates: [],
  };
}
