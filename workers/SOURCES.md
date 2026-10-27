# Job sources

Findings from calling each real endpoint on 2026-10-21 (`uv run python scripts/probe_sources.py`). Recorded samples live in [tests/fixtures/sources](tests/fixtures/sources).

**Date rule:** `posted_at` only comes from a creation or publication field. An "updated" field is stored as `source_updated_at` and never used as the posting date. Crawl time is never used. No real field means `posted_at = null`, `date_source = 'unknown'`, shown as "Date unknown".

## Employer systems (complete listings, worldwide)

Each lists every open job of one company, so a job missing from **2 successful runs in a row** is closed. A company whose fetch fails is left alone.

| System | Endpoint | Posting date | Not used as posting date | Notes |
|---|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | `first_published` (ISO) | `updated_at` | `content` is entity-escaped HTML |
| Lever | `api.lever.co/v0/postings/{slug}?mode=json` (EU: `api.eu.lever.co`, slug `eu:<slug>`) | `createdAt` (epoch ms) | | `country`, `workplaceType`, optional `salaryRange` |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | `publishedAt` (ISO) | | `workplaceType`, `isRemote`, salary in `compensation.summaryComponents` |
| Workable | `apply.workable.com/api/v1/widget/accounts/{slug}?details=true` | `published_on` (date) | `created_at` (draft creation) | `telecommuting`, `locations[].countryCode` |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{slug}/postings` | `releasedDate` (ISO) | | List has no description: detail (`ref`) is fetched only for jobs not stored yet |
| Teamtailor | `https://{slug}.teamtailor.com/jobs.rss` (or a custom host as slug) | RSS `pubDate` | | `remoteStatus` (none, hybrid, fully), `tt:locations` |

## More employer systems

| System | Endpoint | Posting date | Notes |
|---|---|---|---|
| Workday | `POST https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`, slug `tenant\|wdN\|site` | detail `startDate` | List says only "Posted Today" etc. and has no location; details are fetched for recent tech jobs only. Listing is paged newest first and treated as partial |
| Personio | `https://{slug}.jobs.personio.de/xml?language=en` | `createdAt` | Remote from office names and text |
| Recruitee | `https://{slug}.recruitee.com/api/offers/` | `published_at` | `remote` flag |

Not used: JustJoin.it and NoFluffJobs disallow `/api/` in robots.txt.

## Aggregators and boards (partial listings)

They return only their newest pages, so absence proves nothing: their jobs close when **not seen for 14 days**. Each runs on its own schedule to stay inside free limits.

| Source | Coverage | Every | Posting date | Not used | Notes |
|---|---|---|---|---|---|
| Remotive | Remote, worldwide | 6 h | `publication_date` | | Asks for max 4 calls a day. `candidate_required_location` gives the region |
| Himalayas | Remote, worldwide | 2 h | `pubDate` (epoch s) | `expiryDate` | `locationRestrictions`, salary with `salaryPeriod` |
| Jobicy | Remote, worldwide | 2 h | `pubDate` | | Free API, `industry=dev`. Fixture from documented shape (blocked from dev network) |
| Working Nomads | Remote, worldwide | 2 h | `pub_date` | | Fixture from documented shape (blocked from dev network) |
| Hacker News "Who is hiring" | Remote postings, worldwide | 2 h | comment `created_at` | | Monthly thread via the Algolia API; only comments that say remote |
| Arbeitnow | Germany and EU | 2 h | `created_at` (epoch s) | | `remote` flag |
| RemoteOK | Remote, worldwide | 4 h | `date` (ISO), `epoch` | | First array item is a legal notice. Terms: link back, name RemoteOK |
| We Work Remotely | Remote, worldwide | 4 h | RSS `pubDate` | | Title is "Company: Role". Fixture synthesised (blocked from dev network) |
| Adzuna | ~20 countries | 4 h | `created` | | Needs key. `salary_is_predicted = 1` salaries are ignored |
| Reed | UK only | 4 h | `date` (dd/mm/yyyy) | `expirationDate` | Needs key. Only runs if someone wants GB jobs |
| Jooble | ~70 countries | 6 h | none | `updated` | Needs key. Every Jooble job is "Date unknown" (confirmed on the live API) |

Only the We Work Remotely fixture is synthesised (the feed is blocked from the dev network); re-record it with `uv run python scripts/probe_sources.py weworkremotely`.

## What gets stored

- **Remote tech roles only** (title match), worldwide. Office and hybrid jobs are not stored.
- **Posted within the last 7 days**, with a real posting date (no date means no proof of freshness, so it is dropped). Jobs are deleted 10 days after posting (`prune_stale_jobs`, hourly) unless someone has an application for them. Why listed jobs were dropped is counted per run in `source_runs.dropped`.
- Descriptions are capped at 6,000 characters.
- **Internships are dropped.**
- **Salary only if stated** by the source, yearly.
- **Duplicates:** same canonical URL, or same company + title + first country within 30 days. Employer systems run first, so their copy (and apply link) wins.
- **Embeddings** (all-MiniLM-L6-v2, 384 dims via fastembed) only for new or changed jobs (`content_hash`).

## Politeness

Clear User-Agent with a contact link, 3 retries with exponential backoff (honours `Retry-After`), 4 companies in parallel per system, aggregators one request at a time, robots.txt checked for feed and page URLs. No LinkedIn or Indeed.
