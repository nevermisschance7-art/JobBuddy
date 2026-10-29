# JobBuddy

## What it is

A free online job-hunt assistant for our team. For each user it finds every suitable recent job, scores it against their CV and filters, tailors an ATS-friendly CV, drafts short answers in the user's voice, autofills application forms through a Chrome extension and tracks employer replies.

**A human always reviews and presses Submit. The system never submits on its own.**

Access is open: anyone with the link signs in with **just a username** (no password, no email, by the owner's choice). A new username creates an account; an existing one signs in. The server maps the username to a hidden email (`<username>@users.jobbuddy.invalid`) and a password derived with HMAC from `AUTH_SECRET` ([src/lib/username.ts](apps/web/src/lib/username.ts)). There are no teams or invites. Each user's data is still private to that user through Supabase RLS. Because anyone who knows a username can sign in as that user, AI keys are decrypted only on the server and never sent to the browser.

The full build plan is in [docs/job-hunt-assistant-prompts.md](docs/job-hunt-assistant-prompts.md). Prompt 13's "team invites" part is dropped.

## Non-negotiable rules

- **Never invent CV content.** Tailoring may only select, reorder and reword facts in the user's confirmed CV. A code validator (not AI) enforces this.
- **Sensitive answers come only from user-set fixed answers, never from an LLM**: right to work, visa or sponsorship, salary, notice period, location, demographics. Fixed answers are never sent to any model.
- **posted_at only from a real source field** (creation or publication date), never crawl time and never an "updated" field. If unknown, store null with `date_source = 'unknown'` and show "Date unknown".
- **Free tiers first.** Every paid or external service (LLM, job source, PDF renderer, email) sits behind an interface so it can be swapped.
- **Per-user data isolation with Supabase RLS.** CVs and API keys are personal data (GDPR): encrypt AI keys at rest (AES-GCM, app key from env), support export and delete.
- **No scraping of LinkedIn or Indeed.** Respect each source's terms, rate limits and robots.txt.
- **Generated text: plain, short, human.** No buzzwords, no em dashes.
- **Never commit secrets.** Only `.env.example` files with names, no values.

## Layout

```
apps/web/          Next.js 15 (App Router, TS strict, Tailwind, shadcn/ui), deployed to Netlify
packages/shared/   Shared TS types and zod schemas (JSON Resume, job, match, application)
extension/         Chrome MV3 extension, TypeScript, Vite
workers/           Python 3.12 (uv, pytest, ruff): job fetchers, matcher, discovery; runs on GitHub Actions
supabase/          config, migrations, seed, RLS tests
docs/              build plan and notes
```

pnpm workspace packages: `apps/*`, `packages/*`, `extension`. The Python workers are separate (uv).

## AI router

All LLM calls go through the router: [packages/shared/src/llm](packages/shared/src/llm) (TypeScript, used by the web app via `@jobbuddy/shared/llm`) and [workers/src/jobbuddy_workers/llm](workers/src/jobbuddy_workers/llm) (Python). Both behave the same and pass the same [test vectors](packages/shared/src/llm/test-vectors.json).

- `generateJson(task, schema, prompt, userId)` / `generateText(task, prompt, maxWords, userId)`.
- Order: the user's Gemini key, then Groq, then OpenRouter (user key, then the shared `OPENROUTER_API_KEY`). Anthropic is wired in but disabled.
- Models and per-task settings live in [models.json](packages/shared/src/llm/models.json), not code. Check they still exist: `cd workers && uv run python -m jobbuddy_workers.llm.list_models`.
- Rate limit or quota: the key cools down (`ai_keys.quota_reset_at`) and the next provider is tried. Bad key: `ai_keys.last_error` is set and the key is skipped until replaced. All failed: a `needs_fixing` event (max one a day).
- Personal details (name, email, phone, address) and every fixed answer are replaced with placeholders before sending and restored afterwards. Pass them via the `personal` option ([personalInfoFor](apps/web/src/lib/ai/router.ts)).
- Text output goes through the style rules (no em dashes, buzzword swaps, over-length flagged, never cut).
- Time limits (TS router): 10 s per attempt (`ATTEMPT_TIMEOUT_MS`), one quick retry of the first model after a hang (free tiers stall on random requests that then succeed at once), and 20 s per call in total (`CALL_BUDGET_MS`), so a hanging provider never outlasts the web request; then the field is left to the user.
- Every call is logged to `llm_calls` (provider, model, tokens, latency; never content).
- Tests use `FakeProvider`; never call real providers in tests.

## Job fetching (workers)

`uv run jobbuddy-workers fetch [--source NAME]` runs in [fetch-jobs.yml](.github/workflows/fetch-jobs.yml), followed by matching. The database starts that workflow every 2 hours (`start_fetch_run()` via pg_cron and pg_net, GitHub token in Vault as `github_dispatch_token`) because GitHub's own schedule is unreliable; GitHub's schedule is a 6-hourly backup. The web app also starts it after onboarding, CV confirmation and filter changes (`requestMatchRun` in [runs.ts](apps/web/src/lib/runs.ts), `GITHUB_DISPATCH_TOKEN` on Netlify), unless a run is already queued or running. Sources, their real date fields, schedules and closing rules are documented in [workers/SOURCES.md](workers/SOURCES.md); read it before touching an adapter.

- Jobs are worldwide but **remote only**. Stored: remote tech roles posted in the last 7 days with a real posting date (`is_relevant` in [run.py](workers/src/jobbuddy_workers/jobs/run.py)); kept 10 days, then deleted hourly by `prune_stale_jobs` unless someone has an application for them. Each run records per source why listed jobs were dropped (`source_runs.dropped`: too_old, no_date, not_remote, not_tech); locations are parsed to ISO countries plus remote regions (WORLDWIDE, EUROPE, EMEA, ...) in [geo.py](workers/src/jobbuddy_workers/geo.py).
- Employer systems (complete listings) close a job after 2 missed runs; aggregators (partial listings) close after 14 days unseen.
- Employer companies come from the `companies` table. Seed or re-verify the starter list with the "Seed companies" workflow ([candidates.py](workers/src/jobbuddy_workers/seed/candidates.py)).
- Weekly discovery (`jobbuddy-workers discover`, [discover-companies.yml](.github/workflows/discover-companies.yml)) adds companies found in stored job links and the Common Crawl URL index, after checking each board lists at least one job. Companies failing 5 fetch runs in a row are deactivated and re-checked monthly. Counts per system: the `company_stats` view.
- Embeddings: fastembed with all-MiniLM-L6-v2 (384 dims), only for new or changed jobs.
- Adapter tests run against recorded fixtures in `workers/tests/fixtures/sources`; refresh them with `uv run python scripts/probe_sources.py`.

## Matching (workers)

`uv run jobbuddy-workers match` runs right after every fetch. No AI calls. Rules are pure functions in [match/rules.py](workers/src/jobbuddy_workers/match/rules.py), tested in `tests/test_match.py`.

- Hard filters (reasons saved in `reasons_failed`): location (country, or a remote region covering one of the user's countries, or remote with no stated limits, or remote limited to a country in `remote_extra_countries`, shown as a potential restriction), sponsorship ("unable to sponsor", "must have the right to work"...), work style, office days, seniority, excluded skills and companies, job type. Commute distance is not checked yet (needs geocoding).
- **Score = tech fit only (0-100)**, from technologies ([tech.py](workers/src/jobbuddy_workers/match/tech.py), same list as the web app: [tech-terms.json](packages/shared/src/cv/tech-terms.json)): 60 for the share of the job's technologies the CV shows (title 3x, required 1-2x, "nice to have" 0.4x), 25 when the person's main stack (most used technologies in the CV) is in the job, 15 when the kind of role (backend, platform, data...) matches their titles. Ads naming few technologies blend in CV/job text closeness (`jobs_for_matching` cosine similarity). Location, seniority, sponsorship etc. are pass/fail filters; their parts (eligibility chip, freshness, seniority, pay) stay in `breakdown` as card information only. `breakdown.top_reasons`: tech fit, eligibility, freshness.
- Stored: every passing job (any score; the board's Tech fit setting decides what is shown), plus near misses that failed a filter but scored at least the user's `min_score`. Untouched matches (`new`/`seen`) for jobs that no longer qualify are removed; saved or dismissed ones are kept.
- Full rescore when the CV embedding is cleared (the web app clears it whenever a CV is confirmed or edited) or filters changed after `profiles.matched_at`; otherwise only jobs with `content_updated_at` since the last matcher run.
- Events: `hot_match` (score 85+, posted under 24 h, max 3 per user per local day) and one `daily_summary` per local day after the user's chosen time.

## Web app pages

- `/app`: job board ([jobs-inbox.tsx](apps/web/src/components/jobs/jobs-inbox.tsx)): sidebar lists (Best matches, New = `status 'new'` until opened, Saved, Hidden) with counts and quick filters, "Updated X ago" (`profiles.matched_at`) and next update time, "N more below your score", and "Edit my filters", **the only place to edit filters** (also used by onboarding). Cards: description preview, the CV's technologies highlighted, **Quick apply** ([quick-apply.ts](apps/web/src/lib/actions/quick-apply.ts): application, tailored and truth-checked CV, approved with files via `ensureApprovedCv`, then opens the form in a new tab; "I applied"), Save, and More (Explain match, full description, Not for me).
- `/applications`: tabs by status (Ready to apply, Applied, Interviewing, Offers, Closed, All) with counts, search and pages of 25; moving to Applied stamps `applied_at` once.
- `/applications/[id]`: CV for one job: the finished CV with downloads, "Open application form" and "I applied" first; "Tailor again" / "Use my CV as it is" (both approve and make files directly, since the truth checker guards the content); editing and answers folded away. Tailoring: router task `tailor_cv`, [tailor.ts](apps/web/src/lib/cv/tailor.ts). The **truth checker** ([truth.ts](packages/shared/src/cv/truth.ts), code, no AI) runs on the AI result and again on approval: employers, projects, schools, titles and dates must match the confirmed CV (titles and dates are restored), and every technology ([tech-terms.ts](packages/shared/src/cv/tech-terms.ts)) and number must already be in it, or the bullet is removed. Removals and the job's technologies the CV lacks ("gaps", never added) are saved in `applications.tailor_report` and shown. Files: PDF (pdf-lib, standard fonts; letters outside Western European are spelled without accents) and Word (docx) from one ATS-friendly one-column layout ([layout.ts](apps/web/src/lib/cv/layout.ts)), stored as `cvs/<user_id>/application-<id>.pdf|docx`, downloaded through `/api/applications/[id]/cv?format=pdf|docx`.
- Answers on the same page ([answers.ts](packages/shared/src/answers/answers.ts), pure and tested; web side [lib/answers.ts](apps/web/src/lib/answers.ts)): questions pasted one per line (the extension will send them later). Per question: sensitive ones (`fixedKeyFor`: sponsorship, right to work, visa, salary, notice, relocation, location, links, pronouns, demographics) use only `fixed_answers` and never reach an AI; missing ones are asked and saved as fixed answers. Otherwise a past final answer with question similarity at least 0.88 is reused ("Reused, check this"), compared by wording with the company name masked (no embeddings on the web server). Otherwise the AI drafts (task `draft_answer`, 80 words or the form's limit; `cover_letter` 180) with the 5 most similar past answers as style examples. All AI drafts of one request go in ONE call (`draftMany`, at most 12; free Gemini keys allow about 1,000 requests a day) and reused answers get the company name swapped in code, so an application costs about 2 AI requests. Over-limit answers are flagged, never cut. Saved finals go to `answer_memory` (with `company`), stored per application in `applications.answers`.
- `/usage`: AI calls per provider today and key health from `llm_calls` and `ai_keys`.
- `/admin`: for the usernames in `ADMIN_USERNAMES` (default `never-miss`) **and** only after the admin password (`ADMIN_PASSWORD`; an httpOnly cookie made from it, 12 h) ([admin.ts](apps/web/src/lib/admin.ts)). Lists users with joined, last active, application count and their uploaded CV; Disable / Enable (row in `blocked_users`, server-only, checked by `requireUser` and the extension API, plus an Auth ban), Kick (1-minute ban ends every session) and Delete.
- `/settings`, `/onboarding/*`, `/login`.
- The board's sidebar "Tech fit" is the only place to set the minimum score (`profiles.min_score`, saved on change). The status line says when a search is running or a CV/filter change is waiting to be rescored. A confirmed CV without skills shows a warning. The "Re-read CV" workflow re-reads one user's uploaded file with the website's reader ([read-core.ts](apps/web/src/lib/cv/read-core.ts)).

## Chrome extension

[extension/](extension) (MV3, Vite). Never clicks Submit.

- Sign-in: the popup takes the username and calls `POST /api/extension/session` (also refreshes tokens). The session lives in `chrome.storage.local`. All data goes through `/api/extension/*` with a bearer token ([auth.ts](apps/web/src/lib/extension/auth.ts)), so RLS applies as on the website; the middleware skips these routes.
- Content script ([content/index.ts](extension/src/content/index.ts), all frames) runs by itself on the hosts in `ATS_HOSTS` ([urls.ts](packages/shared/src/extension/urls.ts)), and on any site when the user presses "Fill this page" in the popup (activeTab + scripting). The job is found by URL (`jobKeyFromUrl`, else the exact page address). One button, "Fill this application": creates the application if needed (`/api/extension/prepare`, which adds an unknown job with an unknown posting date), then in parallel makes the CV (`/api/extension/cv`, `ensureApprovedCv`) and drafts the form's unanswered free-text questions (prepare with questions, one AI call), then fills. Filling ([form.ts](extension/src/content/form.ts), tested with happy-dom): labels from `label[for]`, aria and container text; inputs, selects, radios, Yes/No button groups (Ashby) and custom dropdowns (react-select: type, wait for `[role=option]`, click); sensitive questions only from fixed answers (Yes/No work authorization from `work_authorized`); the approved CV PDF via DataTransfer (or a drop event); unfilled fields outlined, "Show me the next one". A confirmation page after a fill marks the application applied.
- Real forms: the manual "Probe forms" workflow ([probe-forms.mjs](apps/web/scripts/probe-forms.mjs)) opens live forms of stored jobs in headless Chrome, runs the form code (built from [probe.ts](extension/probe/probe.ts)) with sample data and logs found/filled/missed per form; it never submits (document POSTs are blocked) and only clicks links that open a form. It commits the forms, without scripts, to `extension/test/fixtures/real` with an `index.json`, and [real-forms.test.ts](extension/src/content/real-forms.test.ts) checks every one. Run it after changing [form.ts](extension/src/content/form.ts). Bot checks (Cloudflare, DataDome on SmartRecruiters) and sign-in walls (Workday accounts, RemoteOK) stop the probe but not a real user. Bot-trap fields ("for robots only") are never filled.
- Background: polls `/api/extension/events` every 15 minutes (chrome.alarms) for the 5 alert types, respects quiet hours and enabled types ([alerts.ts](packages/shared/src/extension/alerts.ts)), messages in the user's tone, badge = unread alerts.
- Build: `pnpm --filter extension build` (main build, then the content script as one IIFE file; the manifest is generated in [vite.config.ts](extension/vite.config.ts)). For the team: the manual "Build extension" workflow attaches `jobbuddy-extension.zip` to the `extension-latest` release, linked from Settings.

## Running locally

Requirements: Node 20+, pnpm, uv, Supabase CLI. Docker is optional (only for a local Supabase); by default we use the cloud project.

```bash
pnpm install                 # all JS/TS packages
pnpm dev                     # web app at http://localhost:3000
pnpm --filter extension dev  # build the extension once, load extension/dist unpacked
cd workers && uv sync        # Python deps (uv installs Python 3.12 itself)
cd workers && uv run python -m jobbuddy_workers --help
```

## Tests and lint

```bash
pnpm lint && pnpm typecheck && pnpm test   # all JS/TS packages
cd workers && uv run ruff check . && uv run ruff format --check . && uv run pytest
```

Browser tests (Playwright) walk through sign-up and onboarding against the live project and save screenshots: `pnpm --filter web build && pnpm --filter web e2e`. In CI they run on main and upload an `e2e-screenshots` artifact.

CI runs the same on every push and PR ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

RLS isolation tests run against the live Supabase project with throwaway users: `pnpm test:rls` (reads keys from `apps/web/.env.local`; in CI from repo secrets, main only).

After changing any `package.json`, the [Bootstrap workflow](.github/workflows/bootstrap.yml) regenerates `pnpm-lock.yaml` and Prettier formatting in the cloud, commits them and re-runs CI. Pull afterwards. (The dev machine's network is too slow for big npm installs.)

Apply migrations with `supabase db push` (project is linked; no Docker needed). Regenerate types with `pnpm --filter @jobbuddy/shared gen:types`.

## Environment variables (names only)

**apps/web** (`apps/web/.env.local`)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `APP_ENCRYPTION_KEY` (32-byte base64, AES-GCM for AI keys, server only)
- `AUTH_SECRET` (server only; derives sign-in passwords. Changing it locks everyone out)
- `ADMIN_PASSWORD` (server only; required to open `/admin`)
- `ADMIN_USERNAMES` (optional, comma separated; default `never-miss`)
- `GITHUB_DISPATCH_TOKEN` (server only; fine-grained token, Actions read/write on this repo only)
- `OPENROUTER_API_KEY` (optional shared fallback)
- `GEMINI_API_KEY` (dev testing only; users store their own keys encrypted in the database)

**workers** (`workers/.env`, and GitHub repo secrets in CI)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ENCRYPTION_KEY`
- `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`
- `REED_API_KEY`
- `JOOBLE_API_KEY`
- `OPENROUTER_API_KEY` (optional)

**extension** (`extension/.env`)

- `VITE_APP_URL` (the web app; every request goes through it)

## Notes for working on this repo

- Dev machine is Windows; keep scripts cross-platform (no bash-only npm scripts).
- Netlify free plan is credit based (300/month): don't add anything that deploys on every push to main without need.
- Keep the Supabase free database small (500 MB): only store jobs that can match at least one user, and prune closed ones.
- GitHub Actions minutes: keep each scheduled worker run short; only process new or changed jobs (content_hash).
