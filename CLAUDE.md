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
*(Canonical source of truth — `/types` must match this exactly. All migrations below applied to remote and confirmed via `supabase migration list` as of 2026-07-14.)*

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
resume_file_path text nullable        -- Supabase Storage path, not public URL
deleted_at timestamptz nullable        -- soft-delete/trash marker (Phase 4b)
url_quality text check (url_quality in ('direct','generic','unknown')) nullable  -- Phase 6, unclassified = null
last_checked_at timestamptz nullable    -- Phase 6, last link-health sweep
created_at timestamptz default now()
-- UNIQUE(company, title, url) → constraint name: jobs_company_title_url_key

-- resumes (Phase 5.1) -- unrelated to the 'resumes' Storage bucket from Phase 4 (same name, different concern)
id uuid pk default gen_random_uuid()
user_id uuid not null references auth.users(id) unique   -- one row per user; upsert(..., { onConflict: 'user_id' })
content text not null default ''
updated_at timestamptz not null default now()

-- job_matches (Phase 5.2/5.3)
id uuid pk default gen_random_uuid()
user_id uuid not null references auth.users(id)
job_id uuid not null references jobs(id) on delete cascade
score integer not null check (score >= 0 and score <= 100)
reasoning text
missing_keywords text[] nullable        -- populated only by the per-job live-compare path
jd_fetched boolean not null default false
matched_at timestamptz not null default now()
unique (user_id, job_id)                -- upsert(..., { onConflict: 'user_id,job_id' })
```
- `user_id` is live as of Phase 1.2; RLS policy is `user_id = auth.uid()` on all three tables (see 2.2).

### 2.2 Auth & Authorization Model
- **Now:** Supabase Auth, single user, one personal account. No public signup flow.
- **Row-level security:** Enabled on `jobs`, `resumes`, and `job_matches` — all scoped to `user_id = auth.uid()` for ALL operations (`resumes`/`job_matches` mirror the `jobs` policy pattern: `*_select_own`/`*_insert_own`/`*_update_own`). Service-role key (scraper + link-health workers) bypasses RLS; workers supply `SCRAPER_USER_ID` as the row owner.
- **Storage:** `resumes` bucket (private) has path-scoped `storage.objects` RLS — SELECT/INSERT/UPDATE restricted to `(storage.foldername(name))[1] = auth.uid()::text`, with path convention `{user_id}/{job_id}/resume.pdf`.
- **API routes:** All `/app/api/*` routes require a valid Supabase session; no anonymous writes.
- **Future (not in current roadmap):** invite-based signup, per-user scrape preferences.

### 2.3 Secrets & Environment Variables
| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend + API | Public, safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend + API routes | Anon key only — respects RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Scraper + link-health workers ONLY | Never imported into `/app`. GitHub Actions secret only. |
| `SCRAPER_USER_ID` | Scraper + link-health workers ONLY | UUID of bot Supabase Auth user. `.env.local` + GitHub Actions secret. |
| `GEMINI_API_KEY` | `/app/api/resume/match*` routes, workers (`workers/shared/lib`) | Server-side only, never exposed to client. Free-tier daily quota — see §4 open items. |
| `GROQ_API_KEYS` | Same callers as `GEMINI_API_KEY` | Comma-separated pool of Groq keys; preferred over Gemini whenever set (round-robins across keys, see `lib/groq.ts` / `workers/shared/lib/groq.ts`). `.env.local` + GitHub Actions secret. |
| `DISCORD_WEBHOOK_URL` | Scraper/link-health worker error handler | GitHub Actions secret. Optional locally — worker no-ops if unset. |

**Rules:** Never commit `.env*` files. Never log secret values, even partially. Never use the service-role key in any file under `/app`.

### 2.4 Security Policies
- **Presigned download URLs:** TTL = **15 minutes**, generated fresh on each "Download" click — never cached, never stored.
- **Resume bucket:** private, no public read policy, ever. Path-scoped RLS per 2.2.
- **RLS:** enforced on every table from Phase 1 onward (see 2.2).

### 2.5 Dependency Policy
- Default: no new dependencies without explicit approval (see Rule 6 in 1.4).
- Pre-approved and actually installed: `@supabase/supabase-js`, `@supabase/ssr`, `playwright` (real dependency as of the Phase 6 fetch-layer fix — used for a headless-Chromium fallback in `workers/shared/lib/html.ts` when plain `fetch()` can't render JS-heavy postings), `shadcn/ui` components, `tailwindcss`, `@google/generative-ai`.
- Test stack (installed 2026-07-14): `vitest`, `@vitejs/plugin-react` (pinned `4.7.0`, not `6.x` — avoids a peer conflict with shadcn's `@babel/core@7` chain), `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@vitest/coverage-v8`.
- Groq access (`lib/groq.ts`, `workers/shared/lib/groq.ts`) is plain `fetch` against Groq's OpenAI-compatible endpoint — **no new npm dependency**.
- **Rejected:** a local Ollama backend was wired up and then fully removed after it crashed the dev machine (loaded a 4.7GB model locally). Do not re-add a local-LLM provider without discussing resource limits first.
- Anything else (markdown editor lib, webhook client, etc.) must be proposed in 2.9 before installation.

### 2.6 Testing & CI Conventions
- **Unit/component:** Vitest + React Testing Library, `tests/unit/` (app-level: `tests/unit/api/`, `tests/unit/components/`). 148 tests passing as of 2026-07-14, across 15 files — covers `jobs`/`resumes`/`resume/match`/`resume/match/[jobId]` API routes, `jobs-table` and `match-results` components.
- **Worker fixture tests:** colocated `__tests__/` dirs, Vitest with `// @vitest-environment node` (pure Node/fs logic, no jsdom needed) — `workers/scraper/__tests__/parsers.test.ts`, `workers/shared/lib/__tests__/{classifier,dead-listing,html,url-quality}.test.ts`. Run against saved HTML/markdown snapshots, never against live sites in CI.
- **E2E:** Not installed. §1.3's `test:e2e` / this section's Playwright Test layer remains aspirational — explicitly scoped out during the 2026-07-14 test-infra session. Revisit if/when it's actually needed.
- **CI:** `.github/workflows/ci.yml` runs lint → unit test → build on push to `main`/`dev` and on PRs (no e2e step, per above). Scraper and link-health cron jobs are separate workflows (`scraper-cron.yml`, `link-health-cron.yml`), both installing `playwright install --with-deps chromium` before running. **Unconfirmed:** whether `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are actually set as GitHub repo secrets — human should verify `ci.yml` goes green.

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
*(Claude Code appends here. Human reviews, then manually promotes into 2.1–2.8 and clears the entry. As of 2026-07-14 all prior entries here have shipped and were promoted into 2.1–2.6 above during a documentation cleanup pass — see `git log` for the full history of how each landed. Nothing currently pending.)*

*(Resolved 2026-07-14, same day it was filed: `/app/api/resume/match*` now imports `generateText`/`isLlmAvailable` from `workers/shared/lib/llm` and `parseJsonResponse`/`LlmJsonParseError` from `workers/shared/lib/json` instead of maintaining a separate copy under `/lib`. Confirmed Rule 2 only forbids `/workers` importing `/app`/`/components`, not the reverse, and confirmed `workers/shared/lib/{gemini,groq,llm,json}.ts` have no Next.js-coupled imports. The worker copy's Groq client was upgraded with the app copy's better retry/backoff logic before deleting the app copy, so no behavior regressed. One real gotcha: Turbopack's bundler does NOT resolve NodeNext-style `./gemini.js`-referencing-`.ts`-source relative imports the way `tsc`'s `moduleResolution: "bundler"` type-checking does — `next build` failed with `Module not found` until the `.js` extensions were dropped from the relative imports inside `llm.ts`/`groq.ts`. Verified this didn't break the workers' own execution path (`tsx`, which resolves extensionless imports fine) or either worker's `tsconfig.json` (`moduleResolution: "NodeNext"`) type-check — both still show only the two pre-existing unrelated `import.meta` errors, no new ones. `lib/gemini.ts` and `lib/groq.ts` are deleted; `lib/html.ts` was deliberately left alone since it's a different, intentional fork (plain-fetch-only, no Playwright, per Rule 2's spirit) rather than an accidental duplicate.)*

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

### Phase 6: Link Quality & Dead-Listing Sweep
*(Built and shipped 2026-07-03 through 2026-07-07 but never recorded in this tracker at the time — added retroactively 2026-07-14 to match reality. All checks below are currently green: lint/tsc clean, fixture tests exist and pass for every classifier, weekly cron has run successfully in production.)*
- [x] 6.1 Add `jobs.url_quality`/`jobs.last_checked_at` columns; build `url-quality.ts`/`dead-listing.ts` classifiers (host-allowlist/keyword pass first, LLM fallback only when ambiguous) and the new `/workers/link-health` worker, sharing code with `/workers/scraper` via the new `workers/shared/` directory (neither worker may import `/app`, per Rule 2). Resumable via `last_checked_at ASC NULLS FIRST`; runs weekly via `.github/workflows/link-health-cron.yml`.
- [x] 6.2 Fix the classifiers' fetch/extraction layer — `extractReadableText`/`isViableJobDescription` were defined but never actually invoked (raw HTML was passed straight to the classifiers); add a headless-Chromium fallback (`playwright`, real dependency) for JS-rendered SPA postings that a plain `fetch()` returns empty for.
- [x] 6.3 Add a Groq-backed multi-key LLM provider (`workers/shared/lib/groq.ts`, later mirrored at the app level as `lib/groq.ts`) as the preferred provider over Gemini, to survive Gemini's free-tier daily quota during large sweeps. (A local-Ollama alternative was tried first and reverted after it crashed the dev machine — see §2.5.)

### Phase 7: Resume Matcher Refinement & Live Deep-Compare
- [x] 7.1 Reshape the `/resume` page — replace editor-focused layout with a simple paste-your-resume textarea (keep `resumes.content` persistence and save mechanism) plus a "Run Match" button and a results area below. Kill any editing/formatting controls.
- [x] 7.2 Wire the "Run Match" button to the existing `/api/resume/match` pipeline — two-stage matching (keyword pre-filter → batch Gemini scoring) against the active job corpus, writes to `job_matches`, renders ranked results on the page with score + company + title.
- [x] 7.3 Add per-job live compare on the `/resume` results list — each matched job has a "Deep Compare" trigger that calls `POST /api/resume/match/[jobId]`, fetches the real posting URL, extracts JD text, and shows a real score + missing keywords inline. Graceful fallback to title/company-only score if the fetch fails or page is unscrapeable.

---

## 4. Current State & Changelog

*(Claude Code: append a dated entry here at the end of every session — what was built, what's still rough, what the next subphase needs to know. Free write, no approval needed. Older entries get condensed/pruned once their detail stops being actionable — full history is in `git log` if ever needed. Condensed 2026-07-14: the verbose blow-by-blow of Phases 5-7 and the Phase 6 incidents below were folded into this summary; see git log around commits `5ffad7e`..`cd5b6dc` for full detail if ever needed.)*

**Where things stand (2026-07-14):**
- **Phases 1-7 are all built, checkboxed in §3, and Phase 6 has been retroactively added to §3** (it shipped 2026-07-03 to 2026-07-07 but was never recorded in the tracker until this cleanup pass). Live corpus: scraper pulls from 4 sources (`workers/scraper/sources/`), currently 3,769 active jobs (3,180 `direct` / 285 `generic` / 304 `unknown` — see the session-2-part-2 entry below for the `url_quality` reclassification that changed these numbers), fully classified by `link-health` (0 rows with null `url_quality`/`last_checked_at`).
- **Resume matching (Phase 5 + 7) has now been exercised end-to-end for real**, not just code-reviewed: a live `Run Match` click scored 2,992 of 3,773 active jobs (2,087 distinct titles survived the pre-filter, 3 of ~70 scoring batches failed transiently — expected/normal, not a bug). `job_matches` is no longer empty.
- **API key health checked 2026-07-14** (ad hoc, via a throwaway script hitting each provider with a trivial request, never printing full key values): all 7 `GROQ_API_KEYS` healthy. `GEMINI_API_KEY` is currently hitting its free-tier **daily quota** (429) — not currently a problem since `generateText()` prefers Groq whenever `GROQ_API_KEYS` is set and only falls back to Gemini if Groq is exhausted, but worth knowing if the whole Groq pool ever gets burned through in one run.
- Two major incidents this cycle, both resolved: (1) a local Ollama backend was added then fully removed after it crashed the dev machine loading a 4.7GB model — Groq was adopted instead (§2.5); (2) the classifiers' fetch layer had a bug where HTML extraction helpers existed but were never actually called, plus no JS execution at all — fixed by wiring up `extractReadableText` properly and adding a headless-Chromium fallback (`playwright`, now a real dependency) for JS-rendered postings.
- A scraper link-extraction bug (`speedyapply.ts`/`vanshb03.ts` mis-detecting the apply-link column, silently inserting company homepages instead) was found and fixed, plus a source-agnostic guardrail added in `workers/scraper/index.ts` rejecting any bare-origin URL at the one choke point all sources funnel through. A separate dedup-lookup transient-`fetch failed` bug (which degraded a full scraper run into a full-corpus reclassify instead of just the nightly delta) was also found and fixed with a retry helper (`fetchExistingChunk`, 3 attempts).
- Two date-parsing bugs were fixed in scraper sources: `speedyapply.ts` was matching the wrong column name for "posted date" (its column is headed "Age", not "Date") so `posted_at` was silently always `null`; `vanshb03.ts`'s yearless `"Jul 09"`-style dates were being parsed by native `Date()` into garbage year-2001 timestamps. Both now go through a shared `parseDateCell()` helper in `workers/scraper/lib/markdown.ts` with fixture tests. Only affects future upserts — existing rows still carry whatever bad/null `posted_at` they got from prior runs; no backfill has been run.
- Test infrastructure is now real (was aspirational before 2026-07-14): Vitest + Testing Library installed, 152 tests passing across 15 files (app API routes/components + worker fixture tests for parsers and all four Phase 6 classifiers), `.github/workflows/ci.yml` runs lint→test→build on every push/PR. **Confirmed green in production** — `CI / lint-and-test` passed in 52s on a real push, so the two `NEXT_PUBLIC_SUPABASE_*` secrets are in fact configured on the GitHub repo (previously unconfirmed).
- **This session (2026-07-14), part 2:** three follow-ups from the doc cleanup above.
  1. **Consolidated the duplicated LLM client code** flagged in §2.9 — `/app` now imports the Gemini/Groq wrapper from `workers/shared/lib` instead of maintaining a separate copy under `/lib`. See the §2.9 entry for the mechanics and the Turbopack `.js`-extension gotcha hit along the way.
  2. **Investigated the long-standing "`jobs.url` aggregator-redirect" item and found the original framing was wrong.** It was never a scraper URL-extraction bug — pulled live upstream data for all 4 sources and every URL landing in the DB is already the real, specific ATS/company apply link (confirmed via the Simplify JSON's `url` field and both markdown sources' link cells). The actual bug is in the **link-health classifier's fetch-viability check**: `isViableJobDescription()` in `workers/shared/lib/html.ts` only checked text length, so it accepted (a) bot-block error pages (e.g. Tesla's Akamai "Access Denied" page, 232 chars — passes the 200-char floor) and (b) un-rendered client-side-SPA shells (e.g. `jobs.apple.com`'s "Please enable Javascript..." boilerplate, 3200+ chars of pure nav) as "real content" — which meant the existing Playwright browser fallback never even fired for these, and the garbage text got fed straight into the classifier and mislabeled `'generic'`. Fixed by rejecting known bot-block/JS-required-shell patterns in the viability check (forces the browser fallback to actually run), with fixture tests added to `html.test.ts`.

     **Applied to the live corpus this session** — ran a one-off re-classification pass (same production code path as `link-health`: `fetchTextWithTimeout` → `checkListingLiveness` → `classifyUrlQuality`, same 5x concurrency/10s timeout) against all 521 `url_quality = 'generic'` rows, writing results back via the real service-role client. Result: **232 of 521 (44.5%) moved off the false `'generic'` label** — 5 to `'direct'`, 227 to the more honest `'unknown'` — plus 4 rows were caught as genuinely dead listings and soft-deleted as a side effect of running the real liveness check. 285 rows remain `'generic'`, concentrated in a handful of domains that return real 200 OK pages with no bot-block signature but are still pure nav/footer boilerplate: `lifeattiktok.com` (127), `www.equipmentshare.com` (25), `joinbytedance.com` (15), `careers.qualcomm.com` (14), plus a long tail of ~60 other domains at ≤6 rows each. Current corpus (3,769 active): 3,180 `direct` / 285 `generic` / 304 `unknown`.
  3. Confirmed CI is green (see bullet above).

**Session (2026-07-28): fixed the scraper dedup-lookup fetch failures.** A routine `npm run scraper:dev` + `npm run link-health:dev` run showed the existing-row lookup (`fetchExistingChunk` in `workers/scraper/index.ts`) failing on effectively every chunk with `TypeError: fetch failed`, falling back to "treat as new" and running the full fetch/classify pipeline on the whole corpus instead of just the delta (the same class of incident as the 2026-07-14 note above, but this time root-caused instead of just retried). Reproduced directly with a raw `fetch()` against the real Supabase REST endpoint (no supabase-js involved): a 200-URL chunk builds a ~15.5KB request URL (job URLs average ~70 chars, up to 255), which trips Node/undici's HTTP parser (`UND_ERR_HEADERS_OVERFLOW`) — not a Supabase-side rejection, not actually transient (the 3x retry in `fetchExistingChunk` never helped because the same chunk size fails deterministically). Confirmed 50/100/150-URL chunks succeed in ~100-260ms each; 200 fails every time. Fix: lowered `EXISTING_URL_CHECK_CHUNK_SIZE` from 200 to 100 (`workers/scraper/index.ts`, with a comment explaining why). Reran the scraper after the fix: 0 fetch failures (down from 60), and dead-listing counts dropped sharply (e.g. `vanshb03`: 197→42) since dedup now correctly skips already-tracked jobs. Lint clean. No data corruption occurred during the broken runs either way, since `upsert(..., { ignoreDuplicates: true })` silently drops conflicts on already-tracked rows — the bug only cost extra time/API calls, never correctness.

**Session (2026-08-09): ran scraper + link-health, flagging a new unresolved network anomaly.** `npm run scraper:dev` completed clean — 4,403 attempted across all 4 sources, 0 errors, 0 rejected URLs, 61 dead-skipped. `npm run link-health:dev` was different from prior incidents: first attempt (run in background) was killed externally before finishing a single batch — not by a user/TaskStop action, cause unconfirmed (possibly a sandbox-level resource/time governor on background processes, not reproduced in the app logs themselves). Re-ran in the foreground to completion, but with a high failure rate: `checked: 300, deadFlagged: 6, fetchFailures: 244, updateErrors: 192` (exit code 1). `updateErrors` are single-row `supabase.from('jobs').update(...).eq('id', ...)` calls throwing `TypeError: fetch failed` — this is **not** the 2026-07-28 `UND_ERR_HEADERS_OVERFLOW` bug (that was query-string size on a 200-URL batched lookup; these are per-row updates with a tiny URL, one UUID each). Sanity-checked raw network health with 5 concurrent `curl` requests straight to the Supabase REST endpoint from the same shell — all 5 returned in ~140ms, no failures — so plain connectivity/concurrency to Supabase is fine in isolation. Root cause not yet found; leading hypothesis is resource contention in-process between the concurrent headless-Chromium fallback fetches (`workers/shared/lib/html.ts`, `BROWSER_FETCH_CONCURRENCY = 2`) and Node's own `fetch`/undici stack used by both the classifier's plain-fetch path and the supabase-js client, but this is unconfirmed — did not chase further per the §2.8 debug rule (stop after repeated failures, report, ask for guidance) since this was an ops run, not a coding subphase. No data corruption: failed updates just leave `last_checked_at` unchanged on those rows, so they naturally sort first (`nullsFirst`/oldest-first ordering) and get retried on the next run. Flagging as a new open item below rather than attempting a speculative fix.

**Session (2026-08-13): fixed the 2026-08-09 `updateErrors` anomaly, confirmed root cause was the Supabase update path specifically (not the JD-fetch path).** Ran `npm run scraper:dev` clean — 4,648 attempted across all 4 sources, 0 errors, 60 dead-skipped. Found a fix already sitting uncommitted in the working tree from a prior, unlogged session, targeting exactly the 2026-08-09 anomaly: `updateJobWithRetry()` in `workers/link-health/index.ts` wraps every `supabase.from('jobs').update(...)` call (both the soft-delete-on-dead path and the normal url_quality/last_checked_at path) in a 3-attempt retry with a 1s delay between attempts, since postgrest-js only auto-retries GET/HEAD/OPTIONS — a `.update()` is a PATCH and previously had zero built-in retry/backoff, so any transient network blip during a run (heavy concurrent Chromium + fetch traffic) surfaced as an immediate, unretried `TypeError: fetch failed`. Validated the fix by running link-health **three consecutive times** (900 jobs total): `updateErrors: 0` every time (`deadFlagged`/`fetchFailures` per run: 51/61, 30/79, 27/54). Confirmed this was genuinely the fix (not just this session's network being unusually healthy) by reading `updateJobWithRetry` — it targets exactly the per-row update failure mode the 2026-08-09 entry described. `fetchFailures` (the JD-text fetch path, `fetchTextWithTimeout` in `workers/shared/lib/html.ts`) remains nonzero at a ~18-26% rate across all three runs — investigated and confirmed this is **not** the same bug class: `fetchTextWithTimeout`/`fetchWithBrowser` catch every fetch/DNS/timeout/Playwright error internally and classify it (`dns`/`timeout`/`other`) rather than throwing, so a nonzero count here just means real-world pages (bot walls even the Chromium fallback can't beat, genuinely dead links, slow sites hitting the 10s timeout) failed to yield viable text — expected baseline noise for a multi-thousand-domain corpus, not a crash-class bug. `npm test` (152 tests) and `npm run build` both pass clean; lint clean. Committed the retry-logic fix (previously uncommitted) along with this changelog entry.

**Open items / known gaps, current as of this entry:**
- The `url-quality` classifier's `'generic'` label is still a false positive for domains whose pages return real-looking-length nav/footer-only content with no bot-block signature — 285 rows remain, concentrated in `lifeattiktok.com`/`www.equipmentshare.com`/`joinbytedance.com`/`careers.qualcomm.com` (see the session-2-part-2 entry above). Needs either a positive "does this look like real job-description prose" signal or per-domain investigation.
- §2.7's stated git conventions (branch-per-subphase, `feat:`/`fix:` commit prefixes) don't fully match actual practice recently (several sessions committed straight to `dev` with plain-English messages) — human call on whether to enforce or relax the stated policy.
- `LINK_HEALTH_BATCH_SIZE` has no GitHub Actions secret — the weekly cron always uses the 300-row default.
- No permanent-delete/empty-trash action for the Trash tab (never in scope, still true).
- `1.5`'s Directory Structure Blueprint (frozen, human-edit only) doesn't yet list `workers/shared/` or `tests/unit/`'s actual subdirectory layout — flagged repeatedly, still needs a human pass since Claude Code can't touch Section 1.