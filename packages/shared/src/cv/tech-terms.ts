import data from "./tech-terms.json";

// Technologies the truth checker watches for, and the matcher scores with (workers read the
// same tech-terms.json). If a tailored CV mentions one of these and the confirmed CV doesn't,
// it was invented. Also used to list a job's requirements the CV lacks.

export const TECH_TERMS: string[] = data.terms;

/** Spellings that mean the same technology. Keys and values are lower case. */
export const TECH_SYNONYMS: Record<string, string> = data.synonyms;
