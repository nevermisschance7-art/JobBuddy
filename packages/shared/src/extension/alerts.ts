// Extension alerts: which events become a notification, when, and what they say.

export const ALERT_TYPES = [
  "daily_summary",
  "hot_match",
  "application_ready",
  "weekly_nudge",
  "needs_fixing",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export type Tone = "kind" | "funny" | "plain";

export type AlertSettings = {
  enabled_types?: string[];
  quiet_hours?: { start?: string; end?: string };
};

export type AlertEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const minutes = (hhmm: string | undefined) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Local time of day in minutes for a time zone. */
export function localMinutes(now: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** True inside quiet hours. Handles ranges over midnight (22:00 to 08:00). */
export function inQuietHours(now: Date, timeZone: string, settings: AlertSettings): boolean {
  const start = minutes(settings.quiet_hours?.start);
  const end = minutes(settings.quiet_hours?.end);
  if (start === null || end === null || start === end) return false;
  const t = localMinutes(now, timeZone);
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export function alertEnabled(type: string, settings: AlertSettings): type is AlertType {
  if (!(ALERT_TYPES as readonly string[]).includes(type)) return false;
  return settings.enabled_types ? settings.enabled_types.includes(type) : true;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Notification title and text for one event, in the user's tone. Plain, short, no em dashes. */
export function alertMessage(e: AlertEvent, tone: Tone): { title: string; message: string } {
  const p = e.payload;
  switch (e.type) {
    case "daily_summary": {
      const n = num(p.new_matches);
      const jobs = `${n} new job${n === 1 ? "" : "s"}`;
      return {
        title: "Your daily jobs",
        message:
          n === 0
            ? {
                kind: "No new matches today. Rest is part of the job hunt too.",
                funny: "Zero new jobs. Even recruiters take naps.",
                plain: "No new matches today.",
              }[tone]
            : {
                kind: `${jobs} for you today. Take a look when you're ready.`,
                funny: `${jobs} just landed. Fresh out of the oven.`,
                plain: `${jobs} ${n === 1 ? "matches" : "match"} your filters.`,
              }[tone],
      };
    }
    case "hot_match": {
      const what = `${str(p.title)} at ${str(p.company)}`;
      return {
        title: `Strong match: ${num(p.score)}/100`,
        message: {
          kind: `${what} fits you well. Worth a look today.`,
          funny: `${what}. This one has your name on it.`,
          plain: `${what}, posted today.`,
        }[tone],
      };
    }
    case "application_ready":
      return {
        title: "Ready to review",
        message: {
          kind: `Your application for ${str(p.title)} is ready. Check it, then you press Submit.`,
          funny: `${str(p.title)}: drafted and waiting for your final word.`,
          plain: `Application for ${str(p.title)} is ready to review.`,
        }[tone],
      };
    case "weekly_nudge": {
      const n = num(p.count);
      return {
        title: "Weekly check-in",
        message: {
          kind: `${n} application${n === 1 ? "" : "s"} got no reply in 3 weeks. Not about you; keep going.`,
          funny: `${n} employer${n === 1 ? "" : "s"} went quiet. Their loss.`,
          plain: `${n} application${n === 1 ? "" : "s"} moved to Ghosted.`,
        }[tone],
      };
    }
    case "needs_fixing":
      return {
        title: "Needs fixing",
        message: str(p.message) || "Something needs your attention in Settings.",
      };
    default:
      return { title: "JobBuddy", message: "Something new is waiting for you." };
  }
}

/** The events to show now, oldest first: enabled types only, nothing during quiet hours. */
export function alertsToShow(
  events: AlertEvent[],
  settings: AlertSettings,
  timeZone: string,
  now = new Date(),
): AlertEvent[] {
  if (inQuietHours(now, timeZone, settings)) return [];
  return events
    .filter((e) => alertEnabled(e.type, settings))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
