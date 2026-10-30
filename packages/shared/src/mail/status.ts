// How an employer reply moves an application. Only forwards: a test or interview never moves an
// offer back, a receipt only marks a prepared application as applied, and a closed application
// (rejected or withdrawn) is left alone. "No reply" (ghosted) counts as applied.
import type { ApplicationStatus } from "../application";
import type { MailClass } from "./classify";

const RANK: Partial<Record<ApplicationStatus, number>> = {
  prepared: 0,
  applied: 1,
  ghosted: 1,
  assessment: 2,
  interview: 3,
  offer: 4,
};

const TARGET: Partial<Record<MailClass, ApplicationStatus>> = {
  assessment: "assessment",
  interview: "interview",
  next_step: "interview",
  offer: "offer",
};

/** The new status after a reply, or null to keep the current one. */
export function statusAfterMail(current: string, kind: MailClass): ApplicationStatus | null {
  if (current === "withdrawn" || current === "rejected") return null;
  if (kind === "received") return current === "prepared" ? "applied" : null;
  if (kind === "rejection") return current === "offer" ? null : "rejected";
  const target = TARGET[kind];
  if (!target) return null;
  const now = RANK[current as ApplicationStatus];
  return now !== undefined && now < RANK[target]! ? target : null;
}
