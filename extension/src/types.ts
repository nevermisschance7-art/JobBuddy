// Shapes returned by the web app's /api/extension routes.

export type FillProfile = {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  countryCode: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
};

export type FillData = {
  /** Null for the basics-only data ("base") of a job without an application. */
  applicationId: string | null;
  status: string | null;
  profile: FillProfile;
  fixedAnswers: Record<string, string>;
  answers: { question: string; answer: string; isCoverLetter: boolean }[];
  cv: { fileName: string; base64: string } | null;
};

export type LookupResult = {
  job: { id: string; title: string; company: string } | null;
  application: FillData | null;
  /** Contact details and fixed answers, for any form. */
  base: FillData;
  reviewUrl: string | null;
};

export type PrepareInput = {
  url: string;
  title: string;
  company: string;
  description: string;
  questions: string[];
};

export type PrepareResult = { applicationId: string; drafted: number; reviewUrl: string };

/** Messages from content scripts and the popup to the background worker. */
export type Message =
  | { type: "lookup"; url: string }
  | { type: "prepare"; input: PrepareInput }
  | { type: "applied"; applicationId: string }
  | { type: "cv"; applicationId: string }
  | { type: "open"; url: string };

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; signedOut?: boolean };
