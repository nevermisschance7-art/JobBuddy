// How jobs are described on cards. Pure functions, shared by server and client.

export type Freshness = "new" | "recent" | "relevant" | "older" | "unknown";

export function freshness(postedAt: string | null, now: Date = new Date()): Freshness {
  if (!postedAt) return "unknown";
  const hours = (now.getTime() - new Date(postedAt).getTime()) / 3_600_000;
  if (hours < 24) return "new";
  if (hours < 72) return "recent";
  if (hours < 24 * 14) return "relevant";
  return "older";
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  new: "New",
  recent: "Recent",
  relevant: "Still relevant",
  older: "Older",
  unknown: "Date unknown",
};

export function postedLabel(postedAt: string | null, now: Date = new Date()): string {
  if (!postedAt) return "Date unknown";
  const days = Math.floor((now.getTime() - new Date(postedAt).getTime()) / 86_400_000);
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  return `Posted ${days} days ago`;
}

const REGION_LABEL: Record<string, string> = {
  WORLDWIDE: "anywhere",
  EUROPE: "Europe",
  EMEA: "EMEA",
  AMERICAS: "the Americas",
  NORTH_AMERICA: "North America",
  LATAM: "Latin America",
  APAC: "Asia-Pacific",
  MIDDLE_EAST: "the Middle East",
  AFRICA: "Africa",
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function locationLabel(job: {
  countries: string[];
  remote_regions: string[];
  remote_type: string | null;
}): string {
  const places = job.countries.slice(0, 3).map(countryName);
  const more = job.countries.length > 3 ? ` +${job.countries.length - 3}` : "";
  if (places.length > 0) return places.join(", ") + more;
  if (job.remote_regions.length > 0) {
    return `Remote, ${job.remote_regions.map((r) => REGION_LABEL[r] ?? r).join(" or ")}`;
  }
  return job.remote_type === "remote" ? "Remote, limits not stated" : "Location not stated";
}

export const REMOTE_LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

export function salaryLabel(
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("en", {
      style: currency ? "currency" : "decimal",
      currency: currency ?? undefined,
      notation: "compact",
      maximumFractionDigits: 0,
    }).format(n);
  if (min != null && max != null && min !== max) return `${fmt(min)} to ${fmt(max)}`;
  return fmt((min ?? max) as number);
}

export type EligibilityChip = "indicated" | "sponsorship_stated" | "unclear" | "restriction";

export const ELIGIBILITY_LABEL: Record<EligibilityChip, string> = {
  indicated: "Eligibility indicated",
  sponsorship_stated: "Sponsorship stated",
  unclear: "Eligibility unclear",
  restriction: "Potential restriction",
};

export function scoreBand(score: number): "great" | "good" | "fair" | "low" {
  if (score >= 85) return "great";
  if (score >= 70) return "good";
  if (score >= 55) return "fair";
  return "low";
}
