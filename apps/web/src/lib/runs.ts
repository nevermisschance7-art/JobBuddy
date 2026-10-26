import "server-only";

// Starts the "Fetch jobs" GitHub workflow (fetch, then match) so a new or changed profile
// gets matches in minutes instead of waiting for the next 2-hourly run. Uses a fine-grained
// token that can only start this repo's workflows (GITHUB_DISPATCH_TOKEN). Never throws:
// at worst the user waits for the next scheduled run.

const REPO = "nevermisschance7-art/JobBuddy";
const WORKFLOW = "fetch-jobs.yml";

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "JobBuddy",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(5_000),
  });
}

/** Returns true when a run was started or one is already on its way. */
export async function requestMatchRun(): Promise<boolean> {
  if (!process.env.GITHUB_DISPATCH_TOKEN) return false;
  try {
    // A queued or running fetch already picks up the latest profile when it reaches matching.
    for (const status of ["queued", "in_progress"]) {
      const res = await gh(`/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=1`);
      if (res.ok && ((await res.json()) as { total_count?: number }).total_count) return true;
    }
    const res = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    return res.status === 204;
  } catch (e) {
    console.error("requestMatchRun failed", e);
    return false;
  }
}
