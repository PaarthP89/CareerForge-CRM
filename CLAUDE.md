# CLAUDE.md — CareerForge CRM Project Guide

---

## 0. How This File Is Used (Workflow Contract)

This project is built one **subphase** at a time. For each subphase:

1. A human pastes this entire file + the target subphase (e.g. "Phase 3.2") into an **Architect** model (Claude/Gemini/etc., per the Architect/Builder prompt template).
2. The Architect produces a single one-shot prompt for **Claude Code** (the Builder).
3. Claude Code executes ONLY that subphase, then stops for review.

**Edit permissions — read this before touching this file:**

| Section | Who can edit | How |
|---|---|---|
| 1. Project Fundamentals | **Human only** | Claude Code must never modify. Treat as read-only law. |
| 2. Architecture & Living Design | **Claude proposes, human commits** | Claude Code may append to `2.9 Proposed Changes (Pending Approval)` only. A human reviews and manually promotes approved entries into the relevant subsection (2.1–2.8). Claude never edits 2.1–2.8 directly. |
| 3. Roadmap & Task Tracker | **Claude checks boxes, human approves phase completion** | A box may only be checked after lint + test + build pass AND the human has explicitly approved the diff. No skipping ahead. |
| 4. Current State & Changelog | **Claude Code — free write** | Append-only. This is the one section Claude updates freely, every session, to keep continuity between sessions/models. |

If Claude Code is ever uncertain whether something belongs in Section 2 vs Section 4, default to Section 4 and flag it for human triage.

---

## 1. Project Fundamentals (Frozen — Human-Edit Only)

### 1.1 Overview
- **Project:** CareerForge CRM
- **Core concept:** Production-grade Job Search CRM + automated ingestion pipeline. Centralizes internship/new-grad job discovery, automates scraping, tracks application state, and binds specific resume versions to specific applications.
- **Audience:** Single user initially (founder), designed to extend to other students/new grads later without architectural rework.

### 1.2 Tech Stack
- **Frontend/Backend:** Next.js (App Router)
- **Language:** TypeScript — strict mode, `no-explicit-any` enforced via lint, no `any` escape hatches without a `// TODO(human-approved):` comment explaining why.
- **Styling:** Tailwind CSS + shadcn/ui (dark-mode dashboard)
- **Database:** Supabase Postgres `[ASSUMPTION: chosen over Neon for unified DB+storage vendor; revisit if cost/scale demands otherwise]`
- **File Storage:** Supabase Storage, private bucket, presigned URLs only (see 2.4)
- **Scraper Engine:** Node.js + Playwright, fully decoupled from the Next.js app
- **Automation:** GitHub Actions cron, nightly 2:00 AM run
- **AI Engine:** Google Gemini API (resume/job-description matching)

### 1.3 Command Reference
```
npm run dev          # Next.js dev server
npm run build         # Production build
npm run lint          # ESLint (must pass before any phase is marked done)
npm test              # Vitest unit/component tests
npm run test:e2e       # Playwright E2E tests
npm run scraper:dev    # Run scraper worker locally (outside Next.js process)
npm run scraper:test   # Playwright-based scraper validation against fixture HTML
```

### 1.4 Strict Development Rules (Global, Non-Negotiable)
1. **No coding without planning.** Before writing/changing files, outline implementation steps and get human approval. (Architect prompts satisfy this — Claude Code should still restate its plan briefly before executing.)
2. **Architectural boundary.** The scraper worker (`/workers/scraper`) must never import from or depend on `/app` or `/components`. Communication happens only via the database or webhook, never direct function calls.
3. **Type safety.** All shared types live in `/types`. No duplicate inline interfaces for entities that already have a canonical type.
4. **File integrity.** When modifying a file, preserve existing architecture, security checks, and error boundaries. Run the linter after every edit batch.
5. **Security.** Resume files are never public. Always served via presigned URLs per policy in 2.4. Service-role Supabase keys are never used client-side — see 2.3.
6. **Dependency policy.** No new npm/pip packages may be installed without explicit human approval in the current session. If a task seems to need one, stop and propose it first — do not silently add it to `package.json`.
7. **Definition of Done.** No subphase is complete until all checks in 2.8 pass and a `git diff` has been shown to and approved by the human.
8. **Section discipline.** Claude Code never edits Sections 1–3 directly (see permissions table in Section 0).

### 1.5 Directory Structure Blueprint
```
├── app/
│   ├── api/              # Backend endpoints (status updates, uploads, AI matching)
│   ├── dashboard/         # Main tracking dashboard (tabs, table, uploads)
│   └── resume/            # Resume sandbox/editor workspace
├── components/            # Reusable UI (shadcn primitives)
├── types/                 # Unified TypeScript type definitions
├── lib/                   # Supabase client(s), auth helpers, shared utils
├── workers/
│   └── scraper/           # Playwright scraper, decoupled from Next.js
└── tests/
    ├── unit/
    └── e2e/
```

---

## 2. Architecture & Living Design Reference

> Claude Code: you may **append proposals** to 2.9 only. Sections 2.1–2.8 are updated by a human after reviewing those proposals.

### 2.1 Data Model / Schema
*(Populate as tables are created in Phase 1. Canonical source of truth — `/types` must match this exactly.)*

```sql
-- jobs
id uuid pk
user_id uuid not null references auth.users(id)
title text not null
company text not null
url text not null
stream text check (stream in ('internship','new_grad'))
posted_at timestamptz
discovered_at timestamptz default now()
applied boolean default false
resume_file_path text nullable  -- Supabase Storage path, not public URL
created_at timestamptz default now()
-- UNIQUE(company, title, url) → constraint name: jobs_company_title_url_key
```
- `user_id` is live as of Phase 1.2; RLS policy is `user_id = auth.uid()`.

### 2.2 Auth & Authorization Model
- **Now:** Supabase Auth, single user, one personal account. No public signup flow.
- **Row-level security:** Enabled on `jobs` as of Phase 1.2. Policy: `user_id = auth.uid()` for ALL operations. Service-role key (scraper worker) bypasses RLS; scraper must supply a bot user UUID — see 2.9 and `SCRAPER_USER_ID` secret plan.
- **API routes:** All `/app/api/*` routes require a valid Supabase session; no anonymous writes.
- **Future (not in current roadmap):** invite-based signup, per-user scrape preferences.

### 2.3 Secrets & Environment Variables
| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend + API | Public, safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend + API routes | Anon key only — respects RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Scraper worker ONLY | Never imported into `/app`. GitHub Actions secret only. |
| `SCRAPER_USER_ID` | Scraper worker ONLY | UUID of bot Supabase Auth user. `.env.local` + GitHub Actions secret. |
| `GEMINI_API_KEY` | `/app/api/resume/match` route | Server-side only, never exposed to client |
| `DISCORD_WEBHOOK_URL` | Scraper worker error handler | GitHub Actions secret. Optional locally — worker no-ops if unset. |

**Rules:** Never commit `.env*` files. Never log secret values, even partially. Never use the service-role key in any file under `/app`.

### 2.4 Security Policies
- **Presigned download URLs:** TTL = **15 minutes**, generated fresh on each "Download" click — never cached, never stored.
- **Resume bucket:** private, no public read policy, ever.
- **RLS:** enforced on every table from Phase 1 onward (see 2.2).

### 2.5 Dependency Policy
- Default: no new dependencies without explicit approval (see Rule 6 in 1.4).
- Pre-approved (already implied by stack): `@supabase/supabase-js`, `@supabase/ssr`, `playwright`, `shadcn/ui` components, `tailwindcss`, `@google/generative-ai`.
- Anything else (markdown editor lib, webhook client, etc.) must be proposed in 2.9 before installation.

### 2.6 Testing & CI Conventions
- **Unit/component:** Vitest + React Testing Library, colocated in `tests/unit/`.
- **E2E:** Playwright Test, `tests/e2e/`, run against a local dev build.
- **Scraper validation:** Playwright-based fixture tests in `workers/scraper/__tests__/`, run against saved HTML snapshots (never against live sites in CI, to avoid false failures from layout drift).
- **CI:** GitHub Actions runs lint + unit + e2e on every PR; scraper cron job is a separate workflow.

### 2.7 Git / Commit Conventions
- One branch per subphase: `phase-<N>.<M>-short-description`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`).
- No bundling unrelated file changes into one commit.

### 2.8 Definition of Done (applies to every subphase)
A subphase is only complete when, in order:
1. `npm run lint` passes clean.
2. `npm test` and `npm run test:e2e` (where relevant) pass.
3. `npm run build` succeeds.
4. `git diff` has been shown to the human and explicitly approved.
5. The corresponding checkbox in Section 3 is checked **by the human**, not by Claude Code.

**Debug rule:** if lint/tests fail more than 3 times on the same issue, stop. Do not rewrite core logic speculatively — report the failure and ask for guidance.

### 2.9 Proposed Changes (Pending Approval)
*(Claude Code appends here. Human reviews, then manually promotes into 2.1–2.8 and clears the entry.)*

- [2026-06-30] [Subphase 4.1-4.3]: Added storage.objects RLS policies on 'resumes' bucket scoping SELECT/INSERT/UPDATE to (storage.foldername(name))[1] = auth.uid()::text, with file path convention {user_id}/{job_id}/resume.pdf — reason: bucket existed since Phase 1.2 but had no path-scoped policy recorded in 2.4; required for Phase 4 upload/download to function under RLS.

- [2026-06-30] [Subphase 4b, ad hoc]: Added `deleted_at timestamptz` (nullable, no default) to `jobs` via migration `20260630190000_add_jobs_deleted_at.sql` — reason: soft-delete/trash/restore feature needs a marker column; no RLS change required since the existing `user_id = auth.uid()` policy already covers these rows, app-level queries just filter on `deleted_at`. Schema in 2.1 should be updated to include this column once promoted.

- [2026-06-30] [Proposed scope refinement for Phase 5, pending human review before the next Architect prompt]: The original 5.1-5.3 bullets describe a single-job sandbox (one resume + one pasted job description → one match score). The human has since asked for something broader: score the resume against the ~3,100 jobs the scraper has already collected, not a one-off paste. Proposed refinement, discussed and agreed with the human on 2026-06-30:
  - **Resume source**: use the Phase 5.1 editor's text directly as the matching baseline (not a separate upload) — this means 5.1 needs to persist the edited resume text somewhere durable (a new column/table, e.g. a `resume_text` column on a per-user `profile`-type row), not just hold it in client state.
  - **Matching strategy** (for 5.2/5.3, applies to the new bulk case): two-stage — (1) a cheap keyword/title pre-filter to drop obviously-irrelevant roles first (e.g. "Analyst", "Trading", "Revenue Cycle" if the resume is pure SWE), then (2) batch Gemini scoring (~50-100 job titles per call, not one call per job) only over the survivors. Avoids 3,100 individual Gemini calls.
  - **Known constraint**: `jobs` only has `title`/`company`/`url`, no full job description column — matching can only reason over title/company text unless a later subphase adds JD fetching from the stored `url`.
  - Not yet implemented. Recommend the next Architect prompt for "Phase 5.1" incorporate the resume-text-persistence requirement above so 5.2/5.3 aren't blocked on a missing column later.

- [2026-07-01] [Subphase 5.1]: Added a new `resumes` table as a Section 2.1 addition:
  ```sql
  create table if not exists resumes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) unique,
    content text not null default '',
    updated_at timestamptz not null default now()
  );
  ```
  RLS (Section 2.2/2.4-relevant addition): enabled on `resumes`, with `resumes_select_own`/`resumes_insert_own`/`resumes_update_own` policies all scoped to `user_id = auth.uid()`, mirroring the existing `jobs` RLS pattern. `user_id` is `unique`, giving exactly one resume row per user and clean `upsert(..., { onConflict: 'user_id' })` semantics. Applied via migration `20260701000000_add_resumes_table.sql`, confirmed on the remote project via `supabase migration list`. Reason: durable server-side resume text persistence required by the agreed Phase 5 bulk-matching design (see the scope-refinement proposal directly above), which 5.2/5.3 will read from as the matching baseline. Note: this table is unrelated to the existing `resumes` Storage bucket from Phase 4 (per-job PDF attachments) — same name, different concern.

- [2026-07-02] [Subphase 5.2]: Added a new `job_matches` table as a Section 2.1 addition:
  ```sql
  create table if not exists job_matches (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id),
    job_id uuid not null references jobs(id) on delete cascade,
    score integer not null check (score >= 0 and score <= 100),
    reasoning text,
    matched_at timestamptz not null default now(),
    unique (user_id, job_id)
  );
  ```
  RLS (Section 2.2/2.4-relevant addition): enabled on `job_matches`, with `job_matches_select_own`/`job_matches_insert_own`/`job_matches_update_own` policies all scoped to `user_id = auth.uid()`, mirroring the existing `jobs`/`resumes` RLS pattern. `unique(user_id, job_id)` gives clean `upsert(..., { onConflict: 'user_id,job_id' })` semantics so re-running the match pipeline overwrites prior scores rather than erroring or duplicating. Applied via migration `20260702000000_add_job_matches_table.sql`, confirmed on the remote project via `supabase migration list`. Reason: durable, re-runnable storage for the two-stage bulk-matching pipeline agreed in the Phase 5 scope-refinement proposal, needed so 5.3 can read persisted scores without re-running Gemini on every page load.

- [2026-07-02] [Subphase 5.3]: Extended `job_matches` (Section 2.1 addition) with two nullable/defaulted columns, applied via migration `20260702120000_add_job_matches_live_compare_columns.sql`, confirmed via `supabase migration list`:
  ```sql
  alter table job_matches add column if not exists missing_keywords text[];
  alter table job_matches add column if not exists jd_fetched boolean not null default false;
  ```
  No RLS change needed — existing `job_matches` policies already cover these columns. Reason: the original 5.3 roadmap line ("missing-term suggestions") assumed a real job-description text to diff against, but `jobs` only ever stored title/company/url (see the Phase 5 readiness snapshot entry above). Discussed with the human and resolved as: a manually-triggered, per-job live comparison (`POST /api/resume/match/[jobId]`) that fetches `jobs.url` on demand, extracts readable text, and asks Gemini for a real score + missing-keyword list against that specific posting — falling back to a title/company-only score (empty `missing_keywords`, `jd_fetched: false`) when the fetch fails or the page is JS-rendered/blocked, since plain `fetch()` can't execute JavaScript and Playwright is intentionally scoped to `/workers/scraper` only (Section 1.4 Rule 2), not the `/app` layer. This is a materially different, larger-scope feature than the original one-line roadmap text; kept out of Sections 1–3 verbatim and only reflected here plus the Section 4 changelog below.

- [2026-07-03] [Phase 6 — Link Quality & Dead-Listing Sweep]: Added `jobs.url_quality text CHECK (IN ('direct','generic','unknown'))` (nullable, unclassified = null) and `jobs.last_checked_at timestamptz` (nullable), via migration `20260703000000_add_jobs_url_quality_and_last_checked_at.sql`, applied to remote and confirmed via `supabase migration list`. No RLS change needed — existing `user_id = auth.uid()` policy on `jobs` already covers new columns. Also introduces a new top-level directory, **`workers/shared/`**, holding logic used by both `/workers/scraper` and the new `/workers/link-health` (bounded-concurrency pool, a worker-local Gemini wrapper, HTML-extraction/timeout-fetch helpers, the service-role Supabase client factory, the Discord notifier, and the new URL-quality/dead-listing classifiers) — this isn't reflected in the frozen Section 1.5 Directory Structure Blueprint yet; recommend the human fold `workers/shared/` into 1.5 on next edit. Reason for the new directory rather than duplicating into each worker or importing from `/app`: neither worker may depend on `/app`/`/components` per Rule 2, and `/lib` itself is Next.js-coupled in places (`lib/supabase-server.ts` imports `next/headers`), so a sibling shared-worker-code directory is the cleanest boundary that still avoids duplicating substantial logic (the classifiers in particular) across two packages. `workers/scraper/lib/supabase.ts` and `workers/scraper/lib/notify.ts` were deleted in favor of the `workers/shared/lib` versions (byte-identical logic, `notifyDiscord` gained an optional `source` label so link-health's alerts don't say "Scraper Alert"). Schema/architecture in 2.1/1.5 should be updated by the human once reviewed.

- [2026-07-04] [Phase 7.1-7.3]: No schema changes. Architecturally notable: **removed the standalone `/matches` page** (`app/matches/page.tsx`, `components/matches/matches-list.tsx`) and the "Matches" nav link entry, folding its functionality (Run Match button, ranked results table) directly into `/resume`. This wasn't explicitly requested by the Phase 7 checklist text, but became a natural consequence of it: 7.1/7.2 put a "Run Match" button and ranked-results table on `/resume` itself, which made `/matches` a near-exact duplicate of part of `/resume`. Kept one page instead of two doing the same job. `NavLinks`'s `current` prop union type narrowed from `'dashboard' | 'resume' | 'matches'` to `'dashboard' | 'resume'` accordingly. The old query-param-driven compare flow (`/resume?jobId=X` server-rendering a standalone `JobComparePanel`) was replaced by an inline expandable table row on `/resume`'s results list (7.3) — `JobComparePanel` itself was kept and reused (still owns the fetch/status/retry logic for `POST /api/resume/match/[jobId]`), just stripped of its old "Comparing against X at Y" header line and bordered-panel wrapper so it drops cleanly into a `<TableCell colSpan={5}>` instead. No changes to either `/api/resume/match` route — both were already correct per Phase 5.2/5.3 and only needed new frontend callers. Flagging for human review since removing a page (even a redundant one) is the kind of structural call Section 0 asks Claude Code to surface rather than decide unilaterally forever — happy to restore `/matches` as a thin redirect to `/resume` instead if preferred.

---

## 3. Roadmap & Task Tracker

> Edit checkboxes only after Definition of Done (2.8) is fully satisfied and a human has approved. Each subphase = one Architect-prompt cycle.

### Phase 1: Database Setup & Storage Buckets
- [x] 1.1 Initialize Supabase Postgres schema (`jobs` table per 2.1).
- [x] 1.2 Enable RLS policies per 2.2; create private `resumes` Storage bucket.
- [x] 1.3 Verify DB connection via a minimal Next.js API route test; confirm service-role key is never imported client-side.

### Phase 2: Core Dashboard UI Grid
- [x] 2.1 Build layout with Internship / New Grad toggle tabs.
- [x] 2.2 Implement dense results table with mock data.
- [x] 2.3 Connect "Applied" checkbox to live Supabase PATCH requests (persists across refresh).

### Phase 3: Playwright Ingestion Pipeline
- [x] 3.1 Write standalone Playwright scraper in `/workers/scraper`, fully decoupled per Rule 2.
- [x] 3.2 Add dedup checks against the `(company, title, url)` unique constraint.
- [x] 3.3 Add try/catch with webhook (Discord/Slack) notification on scrape failure.
- [x] 3.4 Wire up GitHub Actions cron (2:00 AM nightly), using `SUPABASE_SERVICE_ROLE_KEY` as a GH secret only.

### Phase 4: Resume Document Management
- [x] 4.1 Add "Upload Resume" UI element to table rows.
- [x] 4.2 Build backend API: upload PDF to private bucket, store path (not public URL) on the job row.
- [x] 4.3 Generate 15-minute presigned URLs (per 2.4); swap button to "Download" once a file exists.

### Phase 5: Resume Sandbox & AI ATS Optimizer
- [x] 5.1 Build Markdown/rich-text editor layout in the Resume workspace tab.
- [x] 5.2 Build `/app/api/resume/match` route connecting job description + resume text to Gemini API (server-side key only, per 2.3).
- [x] 5.3 Output keyword match score and missing-term suggestions to the UI.

### Phase 7: Resume Matcher Refinement & Live Deep-Compare
- [x] 7.1 Reshape the `/resume` page — replace editor-focused layout with a simple paste-your-resume textarea (keep `resumes.content` persistence and save mechanism) plus a "Run Match" button and a results area below. Kill any editing/formatting controls.
- [x] 7.2 Wire the "Run Match" button to the existing `/api/resume/match` pipeline — two-stage matching (keyword pre-filter → batch Gemini scoring) against the active job corpus, writes to `job_matches`, renders ranked results on the page with score + company + title.
- [x] 7.3 Add per-job live compare on the `/resume` results list — each matched job has a "Deep Compare" trigger that calls `POST /api/resume/match/[jobId]`, fetches the real posting URL, extracts JD text, and shows a real score + missing keywords inline. Graceful fallback to title/company-only score if the fetch fails or page is unscrapeable.

---

## 4. Current State & Changelog

*(Claude Code: append a dated entry here at the end of every session — what was built, what's still rough, what the next subphase needs to know. Free write, no approval needed. Older entries get condensed/pruned once their detail stops being actionable — full history is in `git log` if ever needed.)*

**Where things stand (2026-07-03):**
- **Phases 1-4** (DB/RLS/storage, dashboard grid, scraper pipeline, resume uploads) plus ad hoc **4.4** (`/login` page — email+password only, no signup/magic-link/sign-out) and **4b** (Trash tab with restore, manual "Add Job" dialog) are built, human-verified in a real browser, and checkboxed in §3. Live corpus: scraper pulls from 4 sources (`workers/scraper/sources/`). Still-true gaps: no permanent-delete/empty-trash action (never in scope); `jobs.url` isn't always the real apply link for aggregator-sourced rows (redirect/listing pages, not the ATS form) — flagged, not yet fixed.
- **Phase 5** (resume editor at `/resume`, Gemini-backed bulk matching at `/api/resume/match`, per-job live compare, `/matches` page) is code-complete and checkboxed. `resumes` and `job_matches` tables exist (see §2.9 for exact schema — not yet promoted into §2.1 by a human). As of this writing `job_matches` has 0 rows — the bulk/live-compare Gemini pipeline has still never been exercised end-to-end against a real key from the UI; only the incident below put real traffic through the Gemini-backed classifiers (a different pipeline, see next bullet).
- **Phase 6** (Link Quality & Dead-Listing Sweep) added `workers/shared/lib` (code shared between `/workers/scraper` and the new `/workers/link-health`, since neither may import `/app` per Rule 2), `jobs.url_quality`/`jobs.last_checked_at` columns, and two layered classifiers (`url-quality.ts`, `dead-listing.ts`) that resolve most cases for free via a host-allowlist/keyword pass and only fall back to an LLM call when genuinely ambiguous. `link-health` is resumable (orders by `last_checked_at ASC NULLS FIRST`) and runs weekly via `.github/workflows/link-health-cron.yml`. No fixture tests exist yet for the new classifiers. `workers/shared/lib/html.ts`'s fetch/extraction layer was materially rewritten after the Ollama incident below (see that entry) — it now does real text extraction and a headless-browser fallback for JS-rendered pages, not just a raw `fetch()`.

**Open items / known gaps, current as of this entry:**
- `GEMINI_API_KEY` is set in `.env.local` (human added it directly, never pasted in chat).
- `job_matches` is empty — Phase 5's resume-matching pipeline has zero real runs; only auth guards were ever curl-verified.
- No fixture tests for `url-quality.ts` / `dead-listing.ts`, nor for the new Playwright-fallback path in `html.ts`.
- `jobs.url` aggregator-redirect problem (Phase 5 backlog item, still open).
- `LINK_HEALTH_BATCH_SIZE` has no GitHub Actions secret — the weekly cron always uses the 300-row default.
- ~3,114 of ~3,891 active jobs still haven't been swept by `link-health` (see incident below for why) — none of that sweep has run since the `html.ts` rewrite, so its real-world accuracy on the actual corpus is still unverified beyond the two-URL smoke test noted below.

**[2026-07-03] Ollama wiring added, then removed after crashing the user's machine.** A working session after the Phase 6 entry above (which had explicitly scoped Ollama *out*) added a switchable second LLM backend anyway: `workers/shared/lib/llm.ts` gained an `LLM_PROVIDER=ollama` branch alongside a new `ollama.ts` (hitting a local `http://localhost:11434`, model `llama3:latest`), intended to keep bulk backfill runs off Gemini's free-tier quota. Running `link-health` against local Ollama loaded a 4.7GB model and crashed the machine (forced restart); that session's context was lost with no surviving log.

Forensics (direct read-only queries against the remote Supabase project, since local Docker wasn't running): the sweep had processed 777 of 3,891 active jobs before dying (last `last_checked_at`: 15:55:33 UTC). Of those, 689 resolved `direct` and 30 `generic` via the free host/keyword layers (no LLM needed), 58 came back `unknown`, and 4 were confirmed dead by keyword match and soft-deleted (real signal — Apple, TikTok, Qualcomm, Voleon postings). `job_matches` stayed at 0 rows throughout, confirming this was purely the Phase 6 classifier sweep, not the Phase 5 resume-matching pipeline.

**Decision: Ollama is removed entirely, not replaced.** Deleted `workers/shared/lib/ollama.ts` and the smoke-test script (`.smoke-ollama-tmp.ts`); `llm.ts` is now a thin Gemini-only wrapper (no provider switch). Considered Groq (OpenAI-compatible API, e.g. `llama-3.1-8b-instant`) as a cheap hosted alternative given the classifiers' workload is short-prompt/short-output — cost modeling puts a full sweep of the ~3,900-job corpus at roughly $0.03–$0.35 depending on how often the ambiguous/LLM branch triggers, meaning a $5 budget covers well over a hundred full sweeps. Not wired up; flagged as a future option only if Gemini's rate limits become the actual bottleneck.

**Notes for whoever picks this up next:** `link-health` is safe to resume (resumable via `last_checked_at`) — recommend small `LINK_HEALTH_BATCH_SIZE` runs or the GitHub Actions weekly cron rather than a long local run, now that there's no local-LLM option to overload the machine with.

**[2026-07-03] Fixed the classifiers' fetch layer — curl-vs-browser mismatch and a bug where extraction was never applied.** Human reported curl/plain fetch returning near-nothing for postings that render fine and are clearly real in an actual browser. Investigation found two separate problems in `workers/shared/lib/html.ts`: (1) `extractReadableText`/`isViableJobDescription` existed but `fetchTextWithTimeout` never actually called them — it returned raw HTML straight through, which both classifiers then ran keyword regexes and Gemini prompts against directly (raw HTML boilerplate/script tags trivially exceed the 200-char viability threshold, so the viability gate was effectively a no-op); (2) no JS execution at all, so client-rendered SPA career pages (Ashby, some custom company sites) return an empty pre-render shell to any non-browser fetch, indistinguishable from a dead/blocked page.

Fix, approved by the human this session (installed `playwright` as a real dependency — previously only aspirationally listed in §2.5/§1.2, never actually installed or used): `fetchTextWithTimeout` now (a) does a plain `fetch()` first and extracts+returns real readable text when that's viable (cheap, no browser — covers the ATS-hosted majority per the Phase 6 host-allowlist data), and (b) falls back to a headless Chromium render (`chromium.launch({ headless: true })`, one shared browser instance per worker run via a lazy singleton + new `closeBrowser()` export) only when the plain fetch fails or comes back too short. The browser fallback navigates with `waitUntil: 'domcontentloaded'` then best-effort waits for `networkidle` (own try/catch, since some SPAs never go fully idle due to analytics/websockets/chat widgets) before extracting — an earlier version that only used `domcontentloaded` was caught by testing to return empty content for real SPA postings, since that event fires before client-side rendering completes. The browser-fallback path is capped at 2 concurrent pages via a small internal semaphore, independent of whatever concurrency `scraper`/`link-health` use for their outer per-job loop — deliberately conservative given the Ollama incident above was a resource-exhaustion crash, and a handful of concurrent headless Chromium pages is a very different (much lighter) profile than a 4.7GB local LLM but still not free.

Both worker `main()`s (`workers/scraper/index.ts`, `workers/link-health/index.ts`) now call `closeBrowser()` in a `.finally()` after `main()` so the browser process never lingers past a run; both `main().catch()` handlers were changed from `process.exit(1)` to `process.exitCode = 1` so that `.finally()` actually gets to run (a hard `process.exit()` inside `.catch` would have skipped it). Both GitHub Actions workflows (`scraper-cron.yml`, `link-health-cron.yml`) gained an `npx playwright install --with-deps chromium` step before the worker runs, since the browser binary isn't part of `npm ci`. Verified locally via a temporary smoke script (deleted after) against a real Greenhouse posting (plain-fetch path, instant, 4522 chars extracted) and a real Ashby SPA posting (`jobs.ashbyhq.com/linear` — correctly fell through to the browser fallback and extracted 2128 chars of real rendered content, e.g. actual department/position listings, not the pre-render "enable JavaScript" shell). `npm run lint` and `tsc --noEmit` on both worker tsconfigs are clean.

**Known issues / not done:** (1) Not yet run against the real ~3,891-job corpus — only the two-URL smoke test above has exercised this code path; real-world hit rate on how often the browser fallback triggers, and whether 2-page concurrency is fast enough for a full sweep, is unverified. (2) No fixture/unit tests added for either the extraction fix or the browser fallback. (3) Local Playwright browser installs were unexpectedly flaky on this machine — `--with-deps` hung indefinitely locally (likely a macOS-specific system-dependency step; not expected to be an issue on the Ubuntu GitHub Actions runners, which is why the workflows still use `--with-deps`) and the plain Chromium download stalled/dropped mid-transfer twice on a slow connection before succeeding — worth knowing if a future CI run of these workflows fails on the install step, since it may need a retry rather than indicating a real problem.

**[2026-07-03] Fixed a scraper link-extraction bug that inserted company homepages instead of real apply URLs, ad hoc.** Human noticed ~14 Boeing rows on one dashboard page all pointing to `www.boeing.com/` instead of distinct application links. Root cause in `workers/scraper/sources/speedyapply.ts` (`README.md` and `NEW_GRAD_USA.md` tables): the link-detection heuristic only matched headers containing "apply"/"link"/"url", but this source's real apply-link column is headed **"Posting"** — no match, so `linkKey` came back empty and the code fell back to scanning every cell in the row for the first URL it could find, which was always the `<a href="https://company.com/">` in the **Company** column (present for styling/branding on every row, listed before the "Posting" column). `vanshb03.ts` has the identical fallback pattern but wasn't actually triggering it (its header is "Application/Link", which does match) — hardened anyway since it's the same fragile shape.

Fix: (1) added `'posting'` to the recognized link-header substrings; (2) the fallback scan now explicitly skips the Company/Title/Date columns, so even an unrecognized header can never resolve to one of those columns' incidental links. Verified against live upstream data: all 5 currently-listed Boeing postings now resolve to distinct real Workday URLs, 0 bare-origin URLs across 363 total speedyapply listings (previously this bug affected other companies too, not just Boeing — see below).

Added a second, source-agnostic guardrail in `workers/scraper/index.ts`: every listing from every source is now rejected (logged + Discord-notified, not silently inserted) if its URL matches `^https?:\/\/[^/]+\/?$` (bare origin, no path) — a real per-posting apply link is never shaped like that. This is deliberately at the one choke point all 4 sources funnel through, so a *future* source-level extraction bug of this same shape degrades to dropped rows instead of silently writing bad data again. New `rejectedBadUrl` counter added alongside the existing `skipped` counter in the per-source and total summary logs.

Data cleanup: queried the live `jobs` table read-only and found 345 of 3,891 active rows already had this exact bare-origin-URL defect (not just Boeing — nvidia.com ×7, northropgrumman.com ×6, travelers.com ×6, rivian.com ×5, boeing.com ×5, and ~25 more companies). Soft-deleted all 345 (`deleted_at = now()`, same trash mechanism as the Phase 4b UI feature — reversible, not a hard delete) so the next scraper run re-inserts them with correct URLs for postings still live upstream. 3,546 active jobs remain, 0 with bare-origin URLs. Not yet done: no fixture test added for the `speedyapply.ts`/`vanshb03.ts` link-extraction fix or the new bare-origin-URL rejection guardrail; next scraper cron run (nightly) hasn't executed yet to confirm the 345 soft-deleted postings actually repopulate cleanly.

**[2026-07-04] `jobs` table cleared and re-swept from empty, ad hoc (human request, "clear the database and re-sweep").** Hard-deleted all rows from `jobs` (3,896 rows; cascaded cleanly to `job_matches`, which was already 0 rows) via a one-off script using the service-role client, confirmed via count queries before/after. Ran `npm run scraper:dev` to repopulate from the 4 live sources.

Discovered mid-run: with the table empty, every listing from every source counts as "new," so the scraper's per-new-candidate inline pipeline (`fetchTextWithTimeout` → `checkListingLiveness` → `classifyUrlQuality`, added in the Phase 6/6.1 fetch-layer work above) tries to live-fetch and classify the *entire* ~3,900-listing corpus inline, one candidate at a time (concurrency 5), instead of the small nightly delta it's designed for. This is architecturally the same workload `link-health` exists to do in resumable batches — running it inline during a full-corpus scrape is just slow, not broken. First run (~1h06m–1h36m elapsed, exact kill time not logged) only got 387 rows in (one source) before the backgrounded shell process was killed externally (machine stayed up, not another Ollama-style crash — just the task itself was terminated, cause not determined). Restarted as a properly-backgrounded task; scraper is resumable via the existing `(company,title,url)` dedup check, so it continues from 387 rather than restarting. As of this entry it's still running (394 active rows so far) — **not yet complete**, whoever picks this up next should check final row count and total elapsed time before assuming the corpus is fully repopulated. Given the same slowness would recur on any future full-from-empty reload, worth considering for a future session: have the scraper insert with `url_quality`/`last_checked_at` left `null` and let `link-health` classify the backlog afterward in batches, rather than classifying inline when the whole table is empty.

**[2026-07-04] Phase 7 — Resume Matcher Refinement & Live Deep-Compare, implemented (7.1-7.3).** Reshaped `/resume` into a single-page workflow: paste-resume textarea (unchanged autosave mechanism in `ResumeEditor`, just shrunk from a full-viewport-height editor to a fixed `h-64` box and placeholder text changed from "Paste or write" to "Paste your resume" — it was already a plain `<Textarea>` with no rich-text/formatting controls, so 7.1's "kill any editing/formatting controls" was already true going in) → "Run Match" button → ranked results table, all server-rendered on initial load (resume content + `job_matches` joined with `jobs(title, company)` fetched in parallel via `Promise.all` in `app/resume/page.tsx`) and client-refreshed after actions via `router.refresh()`. New `components/resume/match-results.tsx` (`MatchResults`) replaces the old `components/matches/matches-list.tsx`, adding a per-row expand/collapse ("Deep Compare") toggle backed by a single `expandedJobId` string-or-null state (accordion-style, one row open at a time) — expanding mounts `JobComparePanel` inside a `<TableRow><TableCell colSpan={5}>`, which triggers a fresh `POST /api/resume/match/[jobId]` call every time a row is (re)opened, matching the fresh-fetch-per-visit semantics the old `/resume?jobId=X` flow already had (no new caching behavior added). Neither `/api/resume/match` route needed any changes — both were already correct from Phase 5.2/5.3; this was purely a frontend consolidation. See the §2.9 entry above for the `/matches` page removal this entailed and the reasoning.

Verified: `npm run lint` clean, `npm run build` succeeds (Next.js 16.2.9/Turbopack, TypeScript pass), route manifest confirms `/matches` is gone (404) and `/resume` still renders correctly for the signed-out case (checked via the human's already-running local dev server on :3000, which picked up the changes via Fast Refresh — confirmed `<title>Resume — CareerForge CRM</title>` and the "Authentication Required" gate render correctly). **Not verified**: the actual authenticated interactive flow (typing/saving resume text, clicking "Run Match" against the real ~394-job corpus, expanding a row to trigger a real Deep Compare) — this requires signing in as the real single user account, which Claude Code has no credentials for and did not attempt to bypass (no magic-link/cookie injection was used). No test suite exists in the repo to run instead (`tests/` doesn't exist, no `test` script in `package.json`, despite §2.6's Vitest/Playwright conventions being aspirational, same gap noted in earlier entries) — this is a pre-existing gap, not something this session introduced or was in scope to fix. **Recommend the human do one real click-through** (paste/confirm resume text → Run Match → expand a row) before checking off 7.1-7.3 in §3.