# JobBuddy

## What it is

A free online job-hunt assistant for our team. For each user it finds every suitable recent job, scores it against their CV and filters, tailors an ATS-friendly CV, drafts short answers in the user's voice, autofills application forms through a Chrome extension and tracks employer replies.

**A human always reviews and presses Submit. The system never submits on its own.**

Access is open: anyone with the link can sign up (Google or email magic link). There are no teams or invites. Each user's personal data (CV, keys, matches, applications, answers) is still private to that user through Supabase RLS, because the anon key is public in the browser.

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

## Running locally

Requirements: Node 20+, pnpm, uv, Supabase CLI. Docker is optional (only for a local Supabase); by default we use the cloud project.

```bash
pnpm install                 # all JS/TS packages
pnpm dev                     # web app at http://localhost:3000
pnpm --filter extension dev  # build the extension in watch mode, load extension/dist unpacked
cd workers && uv sync        # Python deps (uv installs Python 3.12 itself)
cd workers && uv run python -m jobbuddy_workers --help
```

## Tests and lint

```bash
pnpm lint && pnpm typecheck && pnpm test   # all JS/TS packages
cd workers && uv run ruff check . && uv run ruff format --check . && uv run pytest
```

CI runs the same on every push and PR ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Environment variables (names only)

**apps/web** (`apps/web/.env.local`)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `APP_ENCRYPTION_KEY` (32-byte base64, AES-GCM for AI keys, server only)
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
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`

## Notes for working on this repo

- Dev machine is Windows; keep scripts cross-platform (no bash-only npm scripts).
- Netlify free plan is credit based (300/month): don't add anything that deploys on every push to main without need.
- Keep the Supabase free database small (500 MB): only store jobs that can match at least one user, and prune closed ones.
- GitHub Actions minutes: keep each scheduled worker run short; only process new or changed jobs (content_hash).
