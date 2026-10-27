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
  {
    key: "demographics",
    label: "Equal opportunities questions (gender, ethnicity, disability...)",
    hint: "e.g. I prefer not to say",
    kind: "text",
  },
  { key: "linkedin_url", label: "LinkedIn URL", kind: "url" },
  { key: "github_url", label: "GitHub URL", kind: "url" },
  { key: "portfolio_url", label: "Portfolio or website", kind: "url" },
];
