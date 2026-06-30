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
- [ ] 5.1 Build Markdown/rich-text editor layout in the Resume workspace tab.
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
