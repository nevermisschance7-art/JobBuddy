# Job Hunt Assistant: Claude Code build prompts

Working name: **JobBuddy** (rename anytime). It's a free, online job-hunt assistant for a global team. It finds every suitable job, tailors an ATS-friendly CV, drafts short answers in the user's own voice, autofills application forms, and tracks replies. **A human always presses Submit.**

---

## How to use this file

1. Do the **Setup checklist** first.
2. Paste the prompts into Claude Code **one at a time, in order**.
3. For each prompt, start in **plan mode** (Shift+Tab). Read Claude's plan, correct it, then let it build.
4. After each prompt, **run the tests, try it yourself, and commit**. Don't start the next prompt on a broken step.
5. If a free tier or API behaves differently from what a prompt assumes, tell Claude Code to check the provider's current docs and adapt. Don't force the assumption.
6. Never paste secret keys into a prompt. They go in `.env.local` files and in the hosting dashboards only.

---

## Setup checklist (you do this once)

**Free accounts**
- [ ] GitHub: new private repo, e.g. `jobbuddy`
- [ ] Supabase: new project. Copy the Project URL, the anon key and the service role key (secret).
- [ ] Netlify: sign up with GitHub (connect the repo later, in prompt 13)
- [ ] Google AI Studio: Gemini API key
- [ ] Groq: API key
- [ ] OpenRouter: API key
- [ ] Adzuna: app_id and app_key
- [ ] Reed: API key
- [ ] Jooble: API key

**On your computer**
- [ ] Node.js LTS, pnpm, Python 3.12 with `uv`, Git, Claude Code
- [ ] Supabase CLI (`supabase login`), GitHub CLI (`gh auth login`), Netlify CLI (`netlify login`)
- [ ] Optional: Docker (to run Supabase locally)

**Later (optional)**
- [ ] Chrome Web Store developer account (one-time $5) for easy team installs. Until then, load the extension unpacked.

---

## Prompt 0: Repo setup and CLAUDE.md

```
Create a monorepo for "JobBuddy", a free online job-hunt assistant for a global team of developers.

Structure:
- apps/web: Next.js 15 (App Router, TypeScript strict, Tailwind, shadcn/ui), deployed to Netlify
- workers: Python 3.12 managed with uv, pytest, ruff; runs on GitHub Actions schedules
- extension: Chrome Manifest V3, TypeScript, built with Vite
- supabase: migrations, seed, RLS tests
- packages/shared: shared TypeScript types and zod schemas (JSON Resume, job, match, application)

Write a CLAUDE.md at the root with:
1. Product summary. The system finds every suitable recent job for each user, scores it against their CV and filters, tailors an ATS-friendly CV, drafts short answers in the user's voice, autofills forms through the Chrome extension and tracks employer replies. A human always reviews and presses Submit; the system never submits on its own.
2. Non-negotiable rules:
   - Never invent CV content. Tailoring may only select, reorder and reword facts in the user's confirmed CV.
   - Sensitive answers (right to work, visa or sponsorship, salary, notice period, location, demographics) come ONLY from user-set fixed answers, never from an LLM.
   - Store a job's posted_at only from a real source field, never the crawl time. If unknown, show "Date unknown".
   - Free tiers first. Every paid or external service sits behind an interface so it can be swapped.
   - Per-user data isolation with Supabase RLS. CVs and keys are personal data (GDPR): encrypt secrets, support export and delete.
   - No scraping of LinkedIn or Indeed.
   - Generated text: plain, short, human. No buzzwords, no em dashes.
3. Folder layout, how to run each part locally, how to run tests, and the env variables needed (names only, no values).

Also add: .env.example files per app, .gitignore (exclude all .env files), a root README stub, pnpm workspaces, a GitHub Actions CI workflow that runs lint and tests for web, workers and extension, and pre-commit hooks for formatting.
```

---

## Prompt 1: Database schema and security

```
Design the Supabase Postgres schema as SQL migrations in /supabase/migrations. Enable pgvector.

Tables (all with created_at/updated_at):
- profiles: user_id (auth.users), display_name, time_zone, tone ('kind'|'funny'|'plain'), min_score (default 55), alert settings (json: enabled types, quiet hours, daily summary time)
- cvs: user_id, original_file path, resume_json (JSON Resume schema), confirmed boolean, embedding vector(384)
- filters: user_id, countries_allowed text[], needs_sponsorship boolean, remote_types text[] ('remote','hybrid','onsite'), hybrid_max_office_days int, home_location, max_commute_km, seniority_levels text[], must_have_skills text[], excluded_skills text[], excluded_companies text[], salary_floor numeric, salary_currency, employment_types text[]
- fixed_answers: user_id, key (e.g. right_to_work, visa_status, needs_sponsorship, notice_period, salary_expectation, willing_to_relocate, pronouns, linkedin_url, github_url, portfolio_url), value, applies_to_country nullable
- ai_keys: user_id, provider ('gemini'|'groq'|'openrouter'), encrypted_key, last_error, quota_reset_at
- companies: id, name, ats ('greenhouse'|'lever'|'ashby'|'workable'|'smartrecruiters'|'teamtailor'), slug, website, active, last_ok_at, fail_count
- jobs: id, source, external_id, canonical_url, apply_url, title, company_id, company_name, locations jsonb, countries text[], remote_type, employment_type, seniority, salary_min, salary_max, salary_currency, description_text, posted_at nullable, date_source ('source_field'|'unknown'), first_seen_at, last_seen_at, closed_at nullable, embedding vector(384), content_hash. Unique (source, external_id).
- user_job_matches: user_id, job_id, score int, breakdown jsonb, passed_filters boolean, reasons_failed text[], status ('new'|'seen'|'saved'|'dismissed'|'preparing'|'applied'), dismissed_reason
- applications: user_id, job_id, status ('prepared'|'applied'|'assessment'|'interview'|'offer'|'rejected'|'ghosted'|'withdrawn'), applied_at, tailored_cv_pdf path, tailored_cv_docx path, tailored_resume_json, answers jsonb, last_reply_at, notes
- answer_memory: user_id, question_text, question_embedding vector(384), final_answer, job_id, times_reused
- employer_messages: user_id, application_id nullable, from_domain, subject, snippet, received_at, classification ('rejection'|'interview'|'assessment'|'offer'|'other'), confidence
- events: user_id, type, payload jsonb, read boolean (feeds alerts and the fun layer)
- source_runs: source, started_at, finished_at, jobs_seen, jobs_new, errors

Jobs and companies are shared and readable by all signed-in users; only the service role writes them. Everything user-owned is readable and writable only by its owner (RLS).
Add indexes for posted_at, last_seen_at, countries (GIN), and vector indexes (HNSW).
Add a storage bucket "cvs" with per-user folder policies.
Add a scheduled SQL function that deletes jobs closed more than 30 days ago and not linked to any application (keeps the free database small).
Write RLS tests (pgTAP, or a TypeScript test with two test users) proving user A cannot read or write user B's data.
Generate TypeScript types into packages/shared.
```

---

## Prompt 2: Sign-up and onboarding

```
Build auth and onboarding in apps/web with Supabase Auth (email magic link + Google sign-in).

Onboarding wizard (friendly, one step per screen, progress dots, a mascot greeting each step):
1. Welcome: explain in 3 short lines what the app does and that you always press Submit yourself.
2. Upload CV (PDF or DOCX). Extract the text server-side, then call the AI router (prompt 3; use the fake provider until then) to convert it to JSON Resume. Show an editable form of the result. The user must confirm it, and this confirmed JSON becomes the only source of truth for tailoring.
3. Filters: countries I can work in, do I need sponsorship, remote/hybrid/onsite, max office days, home location and commute, seniority, must-have and excluded skills, salary floor and currency, minimum match score (slider, default 55).
4. Fixed answers: right to work, visa/sponsorship, notice period, salary expectation, relocation, links. Explain that the AI will never make these up.
5. AI key: paste a free Gemini key (link to Google AI Studio with 3-step instructions); Groq and OpenRouter keys optional. Validate each key with a tiny test call. Encrypt keys at rest with an app-level key from env (AES-GCM), and decrypt server-side only.
6. Tone picker: kind / funny / plain, with a sample message for each.
7. Done: "I'm off to find jobs. First results within about 2 hours."

Also add a Settings page to edit all of this later, plus "Export my data" (JSON + files) and "Delete my account and data".
```

---

## Prompt 3: AI router (free tiers, swappable)

```
Build an LLM router in packages/shared (TypeScript) and workers/llm (Python) with the same behaviour:

- Interface: generate_json(task, schema, prompt, user_id) and generate_text(task, prompt, max_words, user_id).
- Provider order per user: Gemini Flash (user's key) → Groq (user's key or none) → OpenRouter ':free' models. On quota or rate-limit errors, mark the provider cooling down until its reset time and fall back to the next. If all are exhausted, return a clear error that creates a "needs fixing" event.
- Keep model names in config, not code, so they can be updated when free tiers change. Add a script that lists the models each provider currently offers.
- JSON tasks: validate with zod/pydantic. On invalid output, strip markdown fences and invisible characters, retry once with the validation error, then fail cleanly.
- Privacy: before sending, replace the user's name, email, phone and street address with placeholders ({{NAME}} etc.), and restore them afterwards. Never send fixed_answers to the model.
- Text style post-processor: enforce max_words, remove em dashes and a banned-phrase list (e.g. "I am passionate about", "delve", "leverage", "dynamic", "fast-paced", "synergy", "I am excited to", "furthermore"), and flag rather than silently cut if over length.
- Log provider, model, tokens and latency per call (no prompt content) for the usage page.
- A FakeProvider for tests, plus tests for fallback, JSON repair, redaction and the style rules.
- A switch so later we can add Claude (Anthropic API) as a paid provider with one config change.
```

---

## Prompt 4: Job fetchers (as many real jobs as possible)

```
In /workers build job source adapters with one interface: fetch() -> list[RawJob], normalise(RawJob) -> Job.

Sources:
- Employer systems via their public job-board endpoints: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Teamtailor. Iterate over the companies table.
- Aggregators with free APIs: Adzuna (loop over all countries it supports), Reed (UK), Jooble, Remotive, Himalayas, Arbeitnow, RemoteOK, plus the We Work Remotely RSS feeds.

Rules:
- FIRST, for each source, call the real endpoint, inspect which date fields exist (e.g. created, published, updated), and write the findings in workers/SOURCES.md. Set posted_at only from a true creation or publication field. An "updated" field is NOT a posting date; store it separately. Never use crawl time. Set date_source.
- Respect each source's terms, rate limits and robots.txt; identify with a clear User-Agent; exponential backoff; per-source concurrency limits. No LinkedIn or Indeed scraping.
- Normalise: title, company, locations to country codes, remote_type (remote/hybrid/onsite, from fields and text), employment_type (exclude internships), seniority (from title and text), salary only if stated, and clean description text.
- Dedupe: canonical URL first, then (normalised company, normalised title, country) within 30 days. Prefer the employer's own system as the apply_url when an aggregator duplicates it.
- Mark jobs closed when they disappear from their source for 2 consecutive runs.
- Compute embeddings locally with sentence-transformers (all-MiniLM-L6-v2, 384 dims) and cache the model in GitHub Actions.
- Write each run to source_runs.
- GitHub Actions workflow every 2 hours using the Supabase service role key from repo secrets. Keep each run inside the free minutes; process only new or changed jobs (content_hash).
- Tests using recorded fixture responses for every adapter.

Seed the companies table with a starter list of at least 300 tech companies across the six employer systems (verify each slug returns jobs before inserting).
```

---

## Prompt 5: Company discovery (coverage grows by itself)

```
Add a weekly GitHub Actions job in /workers that finds new companies on the six employer systems:
- Collect candidate slugs from aggregator results (apply URLs that point to greenhouse.io, lever.co, ashbyhq.com, workable.com, smartrecruiters.com, teamtailor.com) and from public lists of companies using those systems.
- Check each slug is live and returns at least one job, then insert it.
- Deactivate companies that fail 5 runs in a row; retry deactivated ones monthly.
- Report counts per system on the health page (prompt 13).
```

---

## Prompt 6: Matching (every suitable job, no AI cost)

```
In /workers build the matcher. It runs after each fetch, for every user and every new or changed open job. NO LLM calls in this step.

1. Hard filters: country allowed or remote-allowed-for-user's-country, sponsorship (if the user needs sponsorship and the job says "no sponsorship" or "must have right to work without sponsorship", fail it), remote type, max office days if stated, seniority, excluded skills, excluded companies, employment type, internships out. Save reasons_failed.
2. Score /100 for jobs that pass:
   - technical fit 35: cosine similarity of CV and job embeddings plus must-have skill overlap
   - seniority 20
   - eligibility & location 20
   - remote fit 10
   - freshness 10: posted <24h full, <72h most, <14d some, unknown low
   - compensation 5: stated and above floor full, unknown partial
   Unknown or unverified info never gets full points. Store the breakdown with one-line reasons.
3. Show ALL jobs that pass filters and are at or above the user's min_score; no top-N limit.
4. Create events: one daily summary per user, and a "hot match" event for score >= 85 and posted < 24h (max 3 per user per day).

Write unit tests with sample CVs and jobs covering each filter and the scoring maths.
```

---

## Prompt 7: Dashboard

```
Build the main dashboard in apps/web:
- Jobs inbox: every match >= min_score, sorted by score. Each card shows title, company, location, remote type, posted date (or "Date unknown"), a freshness chip (New <24h, Recent <72h, Still relevant, Older), salary if stated, an eligibility chip (Eligibility indicated / Sponsorship stated / Eligibility unclear / Potential restriction), the score ring and its top 3 reasons.
- Filters: score range, freshness, remote type, country, company, source, and search. Infinite scroll.
- Actions per job: "Explain match" (on-demand AI, cached), "Prepare application" (prompts 8–9), "Save", "Not for me" (asks for an optional reason and suggests a filter change).
- Applications board: Kanban with prepared, applied, assessment, interview, offer, rejected, ghosted.
- Usage page: AI calls per provider today, quota status, key health.
- Responsive and fast; good empty, loading and error states; dark mode.
```

---

## Prompt 8: ATS-friendly CV tailoring

```
Build CV tailoring, triggered by "Prepare application":
1. Input: the confirmed resume_json and the job description.
2. LLM task (generate_json): choose and order the most relevant roles, bullets and skills; reword bullets to use the job's terms where they are true; write a 2–3 line summary. Output a JSON Resume.
3. Truth validator (code, not AI): every employer, title, date, number, skill and technology in the output must exist in the source CV (allow synonyms only from a small mapping list). On violation, drop the item and record it. List the job's requirements the user doesn't meet as "gaps" for the user to see. Never add them to the CV.
4. Render an ATS-friendly CV: single column, standard headings (Summary, Experience, Skills, Education, Projects), real text (no images or tables for content), common fonts, 1–2 pages.
   - PDF with Typst. First check whether Typst's WASM build works in a Netlify function; otherwise render in a Python worker on demand.
   - DOCX with a docx library, same content.
5. Review screen: side-by-side diff with the original CV, gaps list, and edit-in-place before approving. Save the files to Supabase storage.
6. Tests: the validator must catch an invented skill, a changed date and an inflated number.
```

---

## Prompt 9: Answers in the user's voice, with memory

```
Build application answer drafting:
1. Question sources: questions pasted by the user, or sent from the extension after it reads the form (prompt 10).
2. For each question:
   a. If it maps to a fixed answer (right to work, sponsorship, salary, notice, relocation, links, demographics), use fixed_answers only. Never generate. If missing, ask the user and save it.
   b. Else search answer_memory by embedding. Similarity >= 0.88: reuse the user's final answer, lightly adapted to this job, labelled "Reused, check this".
   c. Else draft with generate_text: max 80 words (or the form's limit), using the user's 5 most similar past final answers as style examples, the confirmed CV facts and the job description. Plain, first person, specific, no buzzwords, no em dashes.
3. Review screen: the user edits each answer. Their edited final version is saved to answer_memory, so the system learns how they answer.
4. Optional "cover letter" task: max 180 words, same rules, only if the form asks for one.
5. Tests: fixed answers never reach the LLM; reuse threshold works; word limits enforced.
```

---

## Prompt 10: Chrome extension (alerts, autofill, CV upload)

```
Build the Chrome MV3 extension in /extension:
- Sign in with Supabase (same account as the web app). Store the session securely in chrome.storage.
- Alerts (chrome.notifications + badge count), polling the events table every 15 minutes, only these 5 types:
  1. daily summary at the user's chosen time
  2. hot match (max 3/day)
  3. application ready to review
  4. weekly gentle nudge (no reply after 21 days → moved to Ghosted)
  5. needs fixing (AI key quota or invalid key)
  Respect quiet hours and per-type toggles; messages use the user's tone.
- Autofill on Greenhouse, Lever, Ashby, Workable and SmartRecruiters application pages (including when embedded in an iframe on a company site; use all_frames where needed):
  - Detect the job and match it to the prepared application. If none exists, offer "Prepare this one" (it reads the form questions and sends them to the web app).
  - Fill name, email, phone, links, fixed answers and drafted answers. Set inputs the way React forms accept them (native setter + input/change events).
  - Attach the tailored CV PDF to the resume file input: fetch it, build a File, assign via DataTransfer and dispatch change. If the field is a drop zone, simulate a drop. Show "CV attached ✓" or "CV not attached, click to download and drag it in".
  - Highlight every field it couldn't fill.
  - NEVER click Submit. When the user submits, detect the confirmation page and mark the application "applied".
- Popup UI: today's matches count, the next action, a mascot line.
- Minimal permissions; host permissions only for those employer-system domains and the app.
```

---

## Prompt 11: Employer reply tracking

```
Build reply tracking:
1. Google Apps Script add-on (in /reply-tracker): a single Code.gs the user pastes into script.google.com from their own Gmail account, with step-by-step install instructions shown in the app's Settings, including a one-click copy of the script with their personal token.
   - A time trigger runs every hour.
   - Gmail search: mail in the last 2 days from employer-system domains (greenhouse.io, lever.co, ashbyhq.com, workablemail.com, smartrecruiters.com, teamtailor.com, myworkday.com and others) OR from domains of companies the user has applied to (fetched from the app API).
   - Send only sender, domain, subject, date and a 300-character snippet to the app's API with the user's token. Never the full email.
2. API route: authenticate the token, match the message to an application (company domain or name, job title), classify it with the AI router (rejection, interview, assessment, offer, other, plus confidence), update the application status when confidence is high, and create an event.
3. Manual fallback on every application card: buttons for Rejected, Interview, Assessment, Offer and No reply. Outlook users use this.
4. A daily job marks applications "ghosted" after 21 days with no reply and adds them to the weekly nudge.
5. Users can revoke the token and see every message received in Settings.
```

---

## Prompt 12: The fun layer (stress relief)

```
Make the app pleasant to use under stress:
- Mascot: an original character (e.g. a tired but loyal office cat named "Byte") drawn in simple SVG with a few moods: happy, thinking, sleepy, celebrating, comforting. It appears in onboarding, empty states, alerts and the extension popup.
- Message library in /apps/web/content/messages.ts, keyed by event (new_matches, hot_match, application_ready, applied, rejection, ghosted, assessment, interview, offer, needs_fixing, quiet_week) × tone (kind, funny, plain), at least 6 variants each, picked at random without repeats. Kind, never sarcastic about the user; funny about the job market, not about them.
- Ghosted graveyard page: small tombstones per ghosted company with dates and a "pay respects" button.
- Gentle weekly recap: effort, not volume ("You sent 4 thoughtful applications. That's a good week. Rest is part of the plan.").
- Small rewards on rejection: a joke, a cat fact, or a badge ("Rejection #10: Resilience badge").
- Interview and offer celebrations with a short confetti animation.
- No guilt streaks and no shaming. Respect prefers-reduced-motion. Users can turn humour off.
```

---

## Prompt 13: Team, deploy and launch

```
Finish for team use and deploy:
- Team invites: an owner creates a team and shares an invite link. Team members can see each other's display names and shared "good companies" lists, never each other's CVs, matches or applications. Extend RLS and its tests.
- Deploy apps/web to Netlify with the Next.js runtime: netlify.toml, env vars set via the Netlify CLI, preview deploys for PRs.
- Workers on GitHub Actions with repo secrets; Supabase migrations applied through the Supabase CLI in CI.
- Health page (/health, admin only): last run per source, jobs seen and new, open job count, companies per employer system, error counts, database size against the free limit.
- Error tracking with a free option (Sentry free tier) or structured logs.
- Package the extension for unpacked install, plus a script to build a Chrome Web Store zip.
- README for new team members: what it is, a 5-minute setup (sign up, upload CV, add free Gemini key, install the extension, optional Gmail reply tracker), privacy notes and FAQ.
- A final review pass: run all tests, check that no secrets are in the repo, check the RLS isolation tests, check that the extension never clicks Submit.
```

---

## After launch: improvements to consider later

- Add Claude as a paid provider for CV tailoring once it proves useful.
- More sources: Workday tenants, government job APIs per country.
- Per-user learning: use "Not for me" reasons to tune filters automatically.
- Interview prep page per application (company notes, likely questions from the job description).
