export const DISMISS_REASONS = {
  location: "Wrong location",
  tech: "Wrong tech or role",
  level: "Wrong level",
  company: "Not this company",
  pay: "Pay too low",
  other: "Something else",
} as const;

export type DismissReason = keyof typeof DISMISS_REASONS;
