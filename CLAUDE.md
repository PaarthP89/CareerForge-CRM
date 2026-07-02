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
- [ ] 5.2 Build `/app/api/resume/match` route connecting job description + resume text to Gemini API (server-side key only, per 2.3).
- [ ] 5.3 Output keyword match score and missing-term suggestions to the UI.

---

## 4. Current State & Changelog

*(Claude Code: append a dated entry here at the end of every session — what was built, what's still rough, what the next subphase needs to know. Free write, no approval needed.)*

- [2026-06-29] Phases 1 + 2 complete (human approved): DB schema live (`jobs` table, RLS with `user_id = auth.uid()`, private `resumes` bucket). Key files: `lib/supabase.ts` (lazy singleton browser client — can't throw at module level in Next.js build), `lib/supabase-server.ts` (SSR client), `lib/supabase-admin.ts` (service-role, server-only). Dashboard at `/dashboard`: Server Component fetches jobs, passes to `components/dashboard/jobs-table.tsx` (Client) — tabs, dense table, optimistic Applied checkbox with race-condition guard (`inFlightRef`). Seed route at `app/api/seed` requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` — gate before any public deploy. `Vitest` not yet installed. Note: Supabase owns `storage.objects` RLS internally — never try to `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` (errors with permission denied).

- [2026-06-30] Phase 3.1 complete (pending human review): `/workers/scraper` ingestion worker using GitHub raw HTTP fetch (not Playwright browser — deferred). 4 sources wired up; soft dedup via SELECT-before-INSERT. `tsx@4.x` installed as dev dep. Worker fails fast if `SCRAPER_USER_ID` is missing. | Notes for 3.2: human must create a bot Supabase Auth user, copy its UUID, add `SCRAPER_USER_ID=<uuid>` to `.env.local` and GitHub Actions secrets — then 3.2 can add the `(company, title, url)` unique constraint migration and swap to `ON CONFLICT DO NOTHING`.

- [2026-06-30] Phases 3.2 + 3.3 + 3.4 complete (pending human review): Migration `20260630120000_add_jobs_dedup_constraint.sql` adds NOT NULL on `company`/`title`/`url` and UNIQUE constraint `jobs_company_title_url_key`. Replaced SELECT-before-INSERT soft dedup with `supabase.upsert({ onConflict: 'company,title,url', ignoreDuplicates: true })` — single batched call per source. Added `workers/scraper/lib/notify.ts` (Discord webhook notifier — DISCORD_WEBHOOK_URL is set in github secrets; `notifyDiscord` fires on source-level errors and top-level fatal). Added scraper fixture tests in `workers/scraper/__tests__/` using `node:test` (8 tests, 8 pass). Added `.github/workflows/scraper-cron.yml` (2 AM UTC cron + `workflow_dispatch`). `npm run lint`, `npm run scraper:test`, `npm run build` all pass. `npm test` has no script (Vitest not yet installed — tracked since Phase 1.1). | Known issues: none. | Notes for human: (1) Run `supabase db push` to apply the dedup constraint migration before the next scraper run — without it the upsert's `onConflict` clause has no constraint to match. (2) `SCRAPER_USER_ID` bot user still needs to be created in Supabase Auth and added to `.env.local` + GitHub Actions Secrets (see Section 2.9). (3) Add `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SCRAPER_USER_ID`, and `DISCORD_WEBHOOK_URL` to GitHub Actions Secrets before the cron job can run end-to-end.

- [2026-06-30] Phase 4.1-4.3 complete (pending human review): Added `app/api/jobs/[id]/resume/route.ts` (POST upload + GET signed-URL handlers, SSR cookie-session client only, ownership check via `id` + `user_id` before touching Storage, `MAX_RESUME_BYTES` = 5MB, `RESUME_URL_TTL_SECONDS` = 900, best-effort Storage cleanup if the DB update fails after upload). Added `components/dashboard/resume-cell.tsx` (three-state Upload/Uploading…/Download button, `inFlightRef` double-submit guard mirroring the Applied-checkbox pattern, secondary "Replace" icon button once a resume exists, fetches a fresh signed URL on every Download click and opens it via `window.open`). Wired into `components/dashboard/jobs-table.tsx` as a new "Resume" column with a `handleResumeUploaded` callback that patches local `jobs` state. Added migration `20260630180000_add_resumes_storage_policies.sql` — drops the blanket bucket-wide storage.objects policies from `20260629143000_enable_rls_and_storage.sql` and replaces with SELECT/INSERT/UPDATE policies scoped to `(storage.foldername(name))[1] = auth.uid()::text`, matching the `{user_id}/{job_id}/resume.pdf` path convention (see proposal appended to 2.9). `npm run lint` and `npm run build` both pass clean; `npm test` and `npm run test:e2e` still have no script in `package.json` (pre-existing gap from Phase 1.1, not introduced here). Migration `20260630180000_add_resumes_storage_policies.sql` was applied to the linked remote project (`pmcsmfwgsiuqletfeoqx`) via `supabase db push`, confirmed via `supabase migration list`. Also reconciled the auth-pattern split flagged in review: `app/api/jobs/[id]` PATCH route was switched from its manual Bearer-token client to `lib/supabase-server.ts` (matching the new resume routes), with an explicit `user_id` ownership scope added to the update query; `components/dashboard/jobs-table.tsx` no longer fetches a session/access_token before calling it, since cookies now carry auth automatically. | Known issues: No DELETE storage policy was added (matches the architect spec, which only called for SELECT/INSERT/UPDATE) — the best-effort cleanup-on-DB-failure path in the POST handler will silently no-op under RLS rather than actually removing the orphaned object; an orphaned Storage object can be left behind in that rare failure case. | Notes for Phase 5: no overlap expected; resume sandbox/editor and Gemini matching are untouched.

- [2026-06-30] Phase 4.4 (ad hoc, human-requested, not in original subphase scope) complete (pending human review): Added `app/login/page.tsx` — minimal email+password sign-in form using the existing browser client (`lib/supabase.ts` → `signInWithPassword`), redirects to `/dashboard` + `router.refresh()` on success. Reason: discovered while trying to manually verify Phase 4.1-4.3 that no login page or `middleware.ts` existed anywhere in the app — the dashboard's old "Sign in via the Supabase Dashboard" copy was inaccurate leftover text (the Supabase project dashboard doesn't grant an app session). Updated `app/dashboard/page.tsx`'s unauthenticated-state copy to link to `/login` instead. Verified live: `GET /login` returns 200 and renders against the running dev server. `npm run lint` and `npm run build` both pass. | Known issues: assumes the user already has a Supabase Auth user with a password set (e.g. via Supabase Studio → Auth → Users → set password directly) — there is still no signup flow, magic-link option, or sign-out affordance; none were added since they weren't requested. No `middleware.ts` was added either — session refresh on long-lived visits is still unhandled, only this subphase's immediate "I can't get in to test" blocker was addressed. | Notes for human: per CLAUDE.md Section 2.8 item 5 and the Section 0 permission table, checkboxes in Section 3 are checked by the human, not Claude Code — none were checked for 4.1-4.4; please verify the upload/download flow yourself via `/login` and confirm before checking boxes.

- [2026-06-30] Human manually verified upload/download end-to-end via `/login` → `/dashboard` on the real dev server — confirmed working. Definition of Done (2.8) now fully satisfied for 4.1-4.4: lint clean, build clean, migration applied to remote, manual UI verification passed. Section 3 checkboxes for 4.1/4.2/4.3 still need to be checked by the human (not done here, per 2.8 item 5); 4.4 was ad hoc and isn't in the original Section 3 list.

- [2026-06-30] Scraper data-quality bugfixes (pending human review): the human noticed the dashboard only showed 5 placeholder internships and asked whether the scraper actually runs — it did not; `jobs` only held the 10-row `MOCK_JOBS` seed data from `app/api/seed/route.ts`. Ran `npm run scraper:dev` directly against the real DB and found 2 of 4 sources broken by upstream repo changes (not introduced by us): (1) `speedyapply` hardcoded `INTERN_USA.md`, which the upstream repo deleted — USA internship listings were consolidated into `README.md` under `<!-- TABLE_FAANG_START/END -->`-style HTML-comment sections; fixed by pointing `INTERN_URL` at `README.md` (`workers/scraper/sources/speedyapply.ts`). (2) `vanshb03` (New-Grad-2027) fetch succeeded but silently returned 0 listings — its table now uses HTML `<a href="...">` anchors instead of markdown `[text](url)` links, and `extractUrl`/the local `extractText` in `lib/markdown.ts` only recognized markdown syntax. Fixed by adding an HTML-anchor fallback to `extractUrl` and promoting a shared `extractText` (strips HTML tags) into `lib/markdown.ts`, removing the duplicated local copies in `speedyapply.ts`/`vanshb03.ts`. Added a regression fixture (`__tests__/fixtures/html-anchor-table-sample.md`) and 3 new tests covering HTML-anchor parsing (11/11 pass). Re-ran the scraper after the fix: all 4 sources succeeded, 3,145 listings attempted, 0 errors, DB now at 3,118 real jobs (399 internship / 2,719 new_grad) after dedup. | Separately found and fixed a dashboard bug: `app/dashboard/page.tsx` fetched all jobs in one `.select('*')` with no `.limit()`/pagination — PostgREST silently caps this at 1000 rows, and with no deterministic tiebreaker on `discovered_at`, internships (inserted before new_grad rows in the same scrape run) were getting truncated out entirely. Fixed by splitting into separate per-stream queries with a secondary `.order('id')` tiebreaker. Known residual limitation: new_grad alone (2,719 rows) still exceeds the 1000-row-per-query cap, so the table currently shows at most 1000 of them — flagged to the human as a problem the planned AI relevance-filtering feature (see below) should solve by reducing what's *shown*, rather than building out generic pagination for its own sake.

- [2026-06-30] Phase 4b (ad hoc, human-requested, not in original Section 3 roadmap) complete (pending human review): human asked for (1) soft-delete + a restorable Trash view, since the scraper now surfaces thousands of jobs and some inevitably get deleted by accident, and (2) a manual "Add Job" dialog for entries that don't come from the scraper. Added migration `20260630190000_add_jobs_deleted_at.sql` (`ALTER TABLE jobs ADD COLUMN deleted_at timestamptz`, nullable, no default — applied to remote via `supabase db push`); added `deleted_at: string | null` to the `Job` type in `types/index.ts`. Extended `app/api/jobs/[id]/route.ts`: `PATCH` now accepts either `{ applied }` (existing) or `{ restore: true }` (new, sets `deleted_at: null`); added a `DELETE` handler that soft-deletes (`deleted_at = now()`), both still scoped by `.eq('user_id', user.id)` per the existing ownership pattern. Added `app/api/jobs/route.ts` (new) — `POST` for manual entry, validating `company`/`title`/`url`/`stream` as required (`stream` checked against the `JobStream` union), `posted_at` optional; catches the `jobs_company_title_url_key` unique-violation (Postgres code `23505`) and returns a clean `409` instead of a raw 500. `app/dashboard/page.tsx` now filters the two active-stream queries with `.is('deleted_at', null)` and adds a third query (`.not('deleted_at', 'is', null)`) for trash, passed to `JobsTable` as a new `initialTrash` prop. `components/dashboard/jobs-table.tsx`: added a third "Trash" tab (Restore button via lucide `RotateCcw` instead of the Applied checkbox/Resume cell), a delete button (lucide `Trash2`) on active rows that optimistically moves the row to local trash state and shows a toast with an inline "Undo" action (mirrors the existing `inFlightRef` optimistic-update/revert pattern from `handleAppliedChange`), and an "Add Job" button next to the stream-count badges opening the new `components/dashboard/add-job-dialog.tsx` (Company/Role/URL required, Stream select, Posted optional date — Discovered is not user-entered, it uses the same DB `now()` default as scraper rows). Added 4 new shadcn components (`dialog`, `input`, `label`, `select`) via `npx shadcn@latest add` — pre-approved under CLAUDE.md §2.5 ("shadcn/ui components" is a pre-approved dependency category), no new npm packages. `npm run lint` and `npm run build` both pass clean. Verified the underlying DB logic directly against the real Supabase project (insert → soft-delete → restore → duplicate-conflict-returns-23505, all confirmed) since I don't hold login credentials to drive a real authenticated browser session — **the actual UI click-through (Add Job dialog, delete→Trash tab→Restore) still needs to be manually verified by the human via `/login` → `/dashboard` on the running dev server**, consistent with how Phase 4.1-4.4's UI was verified. | Known issues: no "permanently delete" / empty-trash action was added — out of scope per the request, which only asked for delete + restore; trashed rows currently persist indefinitely. | Notes for Phase 5 / AI matching: the human separately asked about scoring scraped jobs against their resume — deferred since it depends on Phase 5.1 (resume editor, not yet built) per their own answer to use the editor's text as the matching baseline, plus installing `@google/generative-ai` (needs explicit approval per §1.4 rule 6). Agreed approach once 5.1 lands: cheap keyword/title pre-filter over all jobs, then batch Gemini relevance-scoring (~50-100 titles/call) only over the survivors — not yet started.

- [2026-06-30] Phase 5 readiness snapshot, written so the next Architect prompt for 5.1 doesn't need to re-derive any of this from chat history:
  - **Confirmed not started**: `/app/resume/` does not exist; `@google/generative-ai` is not in `package.json`; no `GEMINI_API_KEY` usage anywhere in the repo.
  - **What 5.1 (editor) needs to additionally do, beyond what §3 currently says**: persist the edited resume as plain text somewhere durable (not just component state), because the agreed bulk-matching design (see §2.9 proposal above) reads from that text as its baseline. There is no `profile`/`resumes`-as-text table yet — only the unrelated per-job PDF storage from Phase 4 (`resume_file_path` on `jobs`, private `resumes` bucket, `{user_id}/{job_id}/resume.pdf`, no text extraction). These are two separate concerns: per-job PDF attachments (done, Phase 4) vs. one master resume's text (not started, needed for 5.1+).
  - **What 5.2/5.3 will have to work with**: `jobs` rows only carry `title`/`company`/`url` — no stored job description — so initial relevance scoring can only reason over title/company text. Fetching full JDs from `url` would be a separate, later subphase if matching quality off title-only proves too weak.
  - **Current job corpus** (as of this entry): 3,118 real rows (399 internship / 2,719 new_grad) from the now-fixed scraper, spanning a wide mix of SWE/data/business roles per source — this is *why* the human wants relevance scoring in the first place, and also why the dashboard's residual 1000-row-per-query display cap (noted above) matters less once filtering ships.
  - **Pending human action before any of this is "done" on paper**: Phase 4.1/4.2/4.3 boxes in §3 were never checked off despite DoD being satisfied (manual UI verification confirmed) — per §2.8 item 5, that checkbox action belongs to the human, not Claude Code, so it's still sitting unchecked. Phase 4b's UI click-through (Add Job / delete / restore) is also still awaiting human verification on the running dev server. Neither blocks starting Phase 5.1 work, but both are open loops worth closing before treating Phase 4 as fully signed off.

- [2026-06-30] Both open loops above are now closed. (1) Phase 4.1/4.2/4.3 boxes in §3 were checked — turned out they'd already been checked off in an earlier pass; the §4 entries above just hadn't been updated to reflect it. (2) Human manually tested Phase 4b's full UI click-through on the running dev server (`/login` → `/dashboard`) and confirmed all three flows work: Add Job dialog creates a row in the correct tab, deleting a row moves it to the Trash tab, and restoring from Trash brings it back to the active tab. Phase 4b is now fully done per §2.8 (lint/build clean, migration applied to remote, DB logic + UI both verified) — no remaining known issues beyond the previously-flagged absence of a permanent-delete/empty-trash action, which was never in scope.

  **Stopping point — read this first when picking Phase 5.1 back up:** Phases 1-4 (plus ad hoc 4.4 login page and 4b trash/manual-add) are fully built, reviewed, and verified. Nothing is mid-flight; it is safe to start a fresh Architect prompt for Phase 5.1 with no cleanup required first. Before drafting that prompt, pull in: the §2.9 "Proposed scope refinement for Phase 5" entry (resume-text-persistence requirement + two-stage keyword-then-Gemini matching strategy, both agreed with the human) and the "Phase 5 readiness snapshot" entry directly above this one (confirms `@google/generative-ai` still isn't installed and will need explicit approval, `/app/resume/` doesn't exist yet, and `jobs` rows only carry `title`/`company`/`url` for matching purposes). Current job corpus is ~3,118 real rows from the live scraper (not mock data) — relevance filtering remains the human's stated motivation for Phase 5.

- [2026-07-01] Phase 5.1 complete (pending human review): Built the Resume workspace editor per the one-shot builder prompt. Added migration `20260701000000_add_resumes_table.sql` (new `resumes` table + RLS, applied to remote — see 2.9 proposal above) and `Resume` type in `types/index.ts`. Added `app/api/resume/route.ts` — `GET` returns `{ content: '' }` for a first-time user (not an error), `PUT` validates `content` is a string ≤100,000 chars (400 on either failure, no truncation) and upserts on `onConflict: 'user_id'`; both handlers use `lib/supabase-server.ts` (cookie-session client, no service-role key), matching the Phase 4 route pattern. Added shadcn `Textarea` (`npx shadcn@latest add textarea` — pre-approved dependency category, no new npm package). Added `components/resume/resume-editor.tsx` (Client Component): plain `Textarea` with character counter (turns red past 100,000), 1500ms debounced autosave, and a save-status indicator with four states (Saved / Saving… / Unsaved changes / Error saving with a manual Retry button, no auto-retry loop). The autosave path uses a loop-based `performSave` (not recursive, to satisfy the `react-hooks` ESLint rule on self-referencing `useCallback`) guarded by `inFlightRef`/`pendingRef`: if new content arrives while a PUT is in flight, `pendingRef` is set and the loop immediately re-saves the latest `contentRef.current` once the in-flight request resolves, so no keystrokes are dropped. A `beforeunload` listener warns on unload only when there's an un-fired debounce timer with unsynced content, or the last save errored; it's added/removed via `useEffect` cleanup. Added `app/resume/page.tsx` (Server Component) following the exact SSR-fetch-then-pass-to-client pattern from `app/dashboard/page.tsx`, including the same unauthenticated-state shell linking to `/login`. `npm run lint` and `npm run build` both pass clean (one lint error surfaced mid-build — `performSave` referencing itself before declaration inside its own `useCallback` — fixed by converting the recursive retry into an in-place loop, no other issues). `npm test`/`npm run test:e2e` still have no script (pre-existing gap tracked since Phase 1.1, not introduced here). Verified via curl against the running dev server: unauthenticated `GET /resume` returns 200 (renders the sign-in shell), unauthenticated `GET`/`PUT /api/resume` both correctly return 401. No `@google/generative-ai` installed, no Gemini/matching code touched, `/app/dashboard` and `/workers/scraper` untouched — all consistent with the anti-goals for this subphase. | Known issues: none found; the authenticated editor/autosave UX (typing → debounce → save-status transitions → beforeunload prompt) has not been click-tested in a real browser since I don't hold login credentials, consistent with how Phase 4's UI was handed off for human verification. | Notes for Phase 5.2's Architect prompt: the persisted resume text is readable via `GET /api/resume` (SSR: query `resumes` table directly, scoped by `user_id = auth.uid()`) — that's the exact shape/endpoint 5.2's bulk-matching route should read from as the baseline.

- [2026-07-01] Human manually verified the Resume workspace at `/resume` on the running dev server (localhost:3000) — confirmed working. Definition of Done (2.8) now fully satisfied for 5.1: lint clean, build clean, migration applied to remote, manual UI verification passed. Section 3 checkbox for 5.1 checked (human gave explicit permission this session to make the Section 3 edit directly, overriding the usual human-only checkbox rule in Section 0/2.8 item 5). Next up: 5.2 (Gemini matching route) — will need `@google/generative-ai` installed, which still requires explicit approval per Section 1.4 rule 6.

- [2026-07-01] Bugfix (unrelated to 5.1, found while the human was verifying `/dashboard` in the same session): browser console showed a React hydration error (`<button> cannot contain a nested <button>`) on `/dashboard`. Root cause was in `components/dashboard/add-job-dialog.tsx` (Phase 4b) — `<DialogTrigger><Button>...</Button></DialogTrigger>` nested a `<Button>` (renders its own `<button>`) inside base-ui's `DialogPrimitive.Trigger` (which also renders a `<button>` by default), producing invalid nested-button DOM that the browser silently restructures, causing server/client HTML to diverge. Fixed by switching to the `render` prop pattern (`<DialogTrigger render={<Button variant="outline" size="sm" />}>...</DialogTrigger>`), the same merge-props idiom `components/ui/dialog.tsx` already uses for `DialogClose` — this makes base-ui apply the trigger's a11y/click behavior directly onto the `Button` element instead of wrapping it. `npm run lint` and `npm run build` pass clean; confirmed no more nested `<button>` markup via curl against `/dashboard`. The console also showed a `<script>`-tag-in-React-tree warning — not fixed, because there is no literal `<script>` anywhere in `app/` or `components/` (confirmed via grep); this is very likely a browser extension modifying the DOM before hydration, which React's own error message calls out as a known false-positive source, not an app bug.
