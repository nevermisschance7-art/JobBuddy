// The applied-jobs report (for showing your work to a manager): which jobs were applied to
// between two days of the user's own calendar, as rows and as a CSV file.

/** "YYYY-MM-DD" today in a time zone. */
export function localDay(zone: string | null, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** The moment a local day ("YYYY-MM-DD") starts in a time zone, as a UTC ISO string. */
export function dayStart(day: string, zone: string | null): string {
  const utc = new Date(`${day}T00:00:00Z`);
  // The zone's offset at that moment: how its clock reads UTC midnight.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone ?? "UTC",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(utc)
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return new Date(utc.getTime() - (shown - utc.getTime())).toISOString();
}

/** The day after "YYYY-MM-DD". */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The report's range from the page address: the last 7 days by default, at most a year. */
export function reportRange(
  from: string | undefined,
  to: string | undefined,
  zone: string | null,
): { from: string; to: string } {
  const today = localDay(zone);
  let end = to && DAY.test(to) ? to : today;
  if (end > today) end = today;
  const weekAgo = new Date(`${end}T00:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
  let start = from && DAY.test(from) ? from : weekAgo.toISOString().slice(0, 10);
  if (start > end) start = end;
  const yearAgo = new Date(`${end}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  if (start < yearAgo.toISOString().slice(0, 10)) start = yearAgo.toISOString().slice(0, 10);
  return { from: start, to: end };
}

export type ReportRow = {
  applied_at: string;
  status: string;
  jobs: { title: string; company_name: string; apply_url: string | null; source: string } | null;
};

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The report as CSV, applied time in the user's own zone. */
export function reportCsv(rows: ReportRow[], zone: string | null): string {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const lines = [["Applied", "Company", "Job title", "Status", "Source", "Link"].join(",")];
  for (const r of rows) {
    lines.push(
      [
        when.format(new Date(r.applied_at)),
        r.jobs?.company_name ?? "",
        r.jobs?.title ?? "",
        r.status,
        r.jobs?.source ?? "",
        r.jobs?.apply_url ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
