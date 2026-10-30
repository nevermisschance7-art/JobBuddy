// Sensitive answers come ONLY from what the user sets here, never from an LLM.

export type FixedAnswerKey = {
  key: string;
  label: string;
  hint?: string;
  kind: "text" | "url" | "choice";
  choices?: string[];
};

export const FIXED_ANSWER_KEYS: FixedAnswerKey[] = [
  {
    key: "right_to_work",
    label: "Where do you have the right to work?",
    hint: "e.g. UK and EU (Irish citizen)",
    kind: "text",
  },
  {
    key: "work_authorized",
    label: "Can you legally work for the companies you apply to? (for Yes/No questions)",
    hint: 'Used when a form asks "Do you have work authorization?" with Yes / No.',
    kind: "choice",
    choices: ["Yes", "No"],
  },
  {
    key: "visa_status",
    label: "Visa or citizenship status",
    hint: "e.g. British citizen, or Skilled Worker visa until 2027",
    kind: "text",
  },
  {
    key: "needs_sponsorship",
    label: "Do you need visa sponsorship?",
    kind: "choice",
    choices: ["No", "Yes", "Depends on the country"],
  },
  { key: "notice_period", label: "Notice period", hint: "e.g. 1 month", kind: "text" },
  {
    key: "salary_expectation",
    label: "Salary expectation",
    hint: "e.g. £70,000 to £80,000 base",
    kind: "text",
  },
  {
    key: "willing_to_relocate",
    label: "Willing to relocate?",
    kind: "choice",
    choices: ["No", "Yes", "Within my country", "For the right role"],
  },
  {
    key: "location",
    label: "Where are you based?",
    hint: "e.g. Warsaw, Poland (CET)",
    kind: "text",
  },
  { key: "pronouns", label: "Pronouns (optional)", kind: "text" },
  // Equal opportunities: one answer per question. Forms word their options differently;
  // the closest option is picked. Leave one empty to use the general answer below.
  {
    key: "gender",
    label: "Equal opportunities: gender",
    kind: "choice",
    choices: ["Male", "Female", "Non-binary", "I prefer not to say"],
  },
  {
    key: "ethnicity",
    label: "Equal opportunities: ethnicity or race",
    hint: "e.g. White, or I prefer not to say",
    kind: "text",
  },
  {
    key: "disability",
    label: "Equal opportunities: do you have a disability?",
    kind: "choice",
    choices: ["No", "Yes", "I prefer not to say"],
  },
  {
    key: "veteran",
    label: "Equal opportunities: are you a (protected) veteran?",
    kind: "choice",
    choices: ["No", "Yes", "I prefer not to say"],
  },
  {
    key: "sexual_orientation",
    label: "Equal opportunities: sexual orientation",
    hint: "e.g. Heterosexual, or I prefer not to say",
    kind: "text",
  },
  {
    key: "transgender",
    label: "Equal opportunities: do you identify as transgender?",
    kind: "choice",
    choices: ["No", "Yes", "I prefer not to say"],
  },
  {
    key: "demographics",
    label: "Any other equal opportunities question (religion, age...)",
    hint: "e.g. I prefer not to say. Also used for the ones above that you leave empty.",
    kind: "text",
  },
  {
    key: "heard_about",
    label: "How did you hear about the jobs you apply to?",
    hint: "e.g. Job board, or LinkedIn. Many forms ask this.",
    kind: "text",
  },
  { key: "linkedin_url", label: "LinkedIn URL", kind: "url" },
  { key: "github_url", label: "GitHub URL", kind: "url" },
  { key: "portfolio_url", label: "Portfolio or website", kind: "url" },
];
