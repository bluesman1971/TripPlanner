# TripPlanner — Project Task List

> Last updated: 2026-04-21  
> Current position: Sprint 4, Weeks 21–24 complete (Email Notifications + Security Audit)  
> Next task: Sprint 4 — Beta + Public Launch (Weeks 25–26)

---

## How to Read This File

- ✅ Done and committed
- ⬅ Next up (pick this up at the start of a new session)
- 🔲 Pending
- Each week maps to roughly one work session

---

## Sprint 1 — Foundation (Weeks 1–6)

### Week 1–2: Monorepo + DB + Auth ✅
- [x] pnpm workspaces + Turborepo setup
- [x] TypeScript config for all three packages
- [x] Supabase project created; all 8 tables created with RLS
- [x] Clerk account + application created
- [x] `apps/api/src/lib/supabase.ts` — service-role client
- [x] `apps/api/src/lib/consultant.ts` — getOrCreateConsultant()
- [x] `apps/api/src/middleware/auth.ts` — requireAuth using @clerk/fastify
- [x] `apps/api/src/app.ts` — Fastify app with Clerk plugin + all route registration

### Week 3: Core API Routes ✅
- [x] `apps/api/src/routes/clients.ts` — GET /clients, POST /clients, PATCH /clients/:id, GET /clients/:id
- [x] `apps/api/src/routes/trips.ts` — GET /trips, POST /trips, GET /trips/:id, PATCH /trips/:id/brief
- [x] `apps/api/src/routes/bookings.ts` — upload, job status, list
- [x] Integration tests in `trips.test.ts` (4 tests, all passing)

### Week 4: BullMQ Job Queue ✅
- [x] Upstash Redis account created; `UPSTASH_REDIS_URL` set in .env
- [x] `apps/api/src/lib/redis.ts` — getRedis() with Upstash-compatible options
- [x] `apps/api/src/queues/ingest.queue.ts` — BullMQ Queue setup
- [x] `apps/api/src/workers/ingest.worker.ts` — job processor skeleton
- [x] Worker started alongside HTTP server in index.ts

### Week 5: Cloudflare R2 File Storage ✅
- [x] Cloudflare account + R2 bucket created; API key set in .env
- [x] `apps/api/src/lib/r2.ts` — uploadToR2, downloadFromR2ToTemp, deleteFromR2
- [x] File upload multipart handler wired to R2 (POST /bookings/upload)
- [x] `apps/api/src/services/extractor.ts` — pdf-parse, mammoth, plain-text extraction
- [x] `apps/api/src/services/bookingParser.ts` — AnthropicProvider (`fast` tier) structured extraction

### Week 6: Security Hardening ✅
- [x] Supabase migration 20260420000001 — allergy_flags column type change to text
- [x] `apps/api/src/lib/encryption.ts` — AES-256-GCM encrypt/decrypt
- [x] `apps/api/src/lib/logger.ts` — safeError(), safeReqSerializer, redact()
- [x] @fastify/helmet + @fastify/rate-limit added to app.ts
- [x] Worker updated to encrypt raw_text and allergy_flags before upsert
- [x] Worker updated to decrypt allergy_flags on GET /bookings read

---

## Sprint 2 — Frontend (Weeks 7–12)

### Week 7: App Shell ✅
- [x] `apps/web/src/main.tsx` — ClerkProvider → QueryClientProvider → BrowserRouter → App
- [x] `apps/web/src/App.tsx` — protected routes, sign-in redirect
- [x] `apps/web/src/lib/api.ts` — useApi() hook with Clerk JWT
- [x] `apps/web/src/lib/queryClient.ts` — TanStack Query client
- [x] `apps/web/src/components/layout/AppShell.tsx` + Sidebar.tsx
- [x] `apps/web/src/components/ui/LoadingSpinner.tsx` + ErrorMessage.tsx
- [x] `apps/web/src/pages/SignInPage.tsx` — Clerk <SignIn>
- [x] `apps/web/src/pages/DashboardPage.tsx` — trip list

### Week 8: Clients Page ✅
- [x] `apps/web/src/pages/ClientsPage.tsx` — list, create modal
- [x] Phone, home address fields added to client record (schema + API + UI)
- [x] Edit modal (PATCH /clients/:id)
- [x] Supabase migration 20260420000002 — clients contact fields (**still needs to be run**)

### Week 9: Trip Creation Wizard ✅
- [x] `packages/shared/src/schemas/travelerProfile.ts` — TravelerProfileSchema
- [x] `apps/api/src/routes/trips.ts` — travelerProfile added to CreateTripSchema + initialBrief
- [x] `apps/web/src/pages/NewTripPage.tsx` — 5-step wizard rewrite
  - Step 1: Client picker
  - Step 2: Group (travelers array — role, age group, notes)
  - Step 3: Preferences (walking, activity, interests, dining, budget, pace, dietary)
  - Step 4: Destination & Purpose
  - Step 5: Discovery
- [x] trips.test.ts updated with travelerProfile fixture — all 4 tests passing

---

### Week 10: Trip Workspace Page ✅
- [x] `apps/web/src/pages/TripPage.tsx` — GET /trips/:id
  - Trip header: destination, dates, status badge (colour-coded by status)
  - Traveler profile summary card (group composition, pace, budget, interests)
  - Discovery card (visit count, classic/bespoke ratio, must-sees, already-done)
  - Bookings list: table of ingested bookings (date, type, time, meeting point)
  - Itinerary versions list (if any)
  - Empty state for each section
- [x] Wire route: `/trips/:id` in App.tsx
- [x] Link from DashboardPage trip rows → `/trips/:id` (was already wired)
- [x] Status badge colour map: setup=gray, ingestion=yellow, research=blue, draft=orange, review=purple, complete=green

### Week 11: Document Upload UI ✅
- [x] Upload button on TripPage (only shown when status = setup or ingestion)
- [x] File picker → POST /trips/:tripId/bookings/upload (multipart)
- [x] Job polling: GET /trips/:tripId/bookings/job/:jobId every 2s → progress bar (indeterminate until worker starts, then 40/80/100%)
- [x] On job complete: invalidate ['trip', id] query → bookings list refreshes
- [x] Error state: show job error message with dismiss button
- [x] After first upload: PATCH /trips/:id/brief { documentsIngested: true, status: 'ingestion' }

### Week 12: Sprint 2 Polish ✅
- [x] Dashboard: client filter dropdown (reads/writes `?client=id` URL param; filters trip list)
- [x] Dashboard: empty state with CTA to create first trip; separate message for filtered empty state
- [x] Navigation: active link highlight in Sidebar (NavLink with isActive — was already correct)
- [x] ErrorBoundary component wrapping each page route in App.tsx
- [x] Skeleton components: TripListSkeleton, ClientListSkeleton, TripPageSkeleton (shimmer, content-shaped)
- [x] Schema drift fixed: TripStatusSchema updated to match DB (review/complete, not revision/delivered); Discovery field names fixed in TripPage (destination_visits, ratio_classic_pct, must_sees, already_done)
- [x] Full typecheck (web + api) and 4 tests — all passing

---

## Sprint 3 — AI Integration (Weeks 13–18)

> Sprint 3 detail will be fleshed out when Sprint 2 is done. High-level plan:

### Week 13: Research Phase (Phase 3) ✅
- [x] `apps/api/src/services/researchPrompt.ts` — system prompt + user message builder (mirrors Barcelona research.md structure)
- [x] `POST /trips/:id/research/stream` — SSE endpoint (gate: documents_ingested required; streams balanced-tier response; saves to research_notes; advances status to 'research')
- [x] `GET /trips/:id/research` — returns latest saved research note
- [x] `apiStream()` added to useApi hook (fetch + ReadableStream, Clerk JWT, SSE parser)
- [x] ResearchPanel on TripPage: "Start Research" button (ingestion + documents_ingested gate), live streaming with cursor, loads existing note if already generated

### Week 14: Itinerary Draft (Phase 5) ✅
- [x] POST /trips/:id/draft/stream — quality tier, full itinerary prompt
- [x] Dedup check logic in prompt (no venue appears twice without reason)
- [x] Draft saved to `itinerary_versions` (version 1, increments on re-run)
- [x] Web: DraftPanel on TripPage — "Generate draft" button, live streaming, loads existing draft
- [x] 23 tests all passing

### Week 15: Document Generation (Phase 6) ✅
- [x] `apps/api/src/services/docxGenerator.ts` — markdown → DOCX (docx package); Google Maps Static API for day maps (addresses, not venue names; SSRF protection)
- [x] `apps/api/src/lib/r2.ts` — uploadDocxToR2, downloadR2AsBuffer
- [x] POST /trips/:id/document — generates DOCX, uploads to R2, saves docx_r2_key, advances status to 'review'
- [x] GET /trips/:id/document — returns latest document metadata or null
- [x] GET /trips/:id/document/download — authenticated download proxy (no presigned URLs; requires Clerk JWT)
- [x] Web: DocumentPanel on TripPage — "Generate document" button, download link; apiDownload() in api.ts
- [x] 25 tests all passing

### Week 16: Revision Flow (Phase 7) ✅
- [x] `apps/api/src/services/revisionPrompt.ts` — system prompt + user message builder (current itinerary + feedback + booking constraints)
- [x] `POST /trips/:id/revise/stream` — balanced tier; gate: status must be draft/review/complete; saves as v[N+1]; advances draft→review; never overwrites
- [x] Web: RevisionPanel on TripPage — feedback textarea, streaming display, "Make another revision" after done
- [x] Web: VersionHistoryCard — replaces old version list; shows all versions sorted descending, per-version .docx download button (if document exists)
- [x] 23 tests all passing (first run, zero failures)

### Weeks 17–18: Context Manager + Streaming Polish ✅
- [x] `apps/api/src/services/contextManager.ts` — `fitToTokenBudget()` + `estimateTokens()`; budgets: draft.researchNotes=8000, revision.currentItinerary=10000
- [x] Context manager integrated in `draft.ts` (research notes) and `revise.ts` (current itinerary); truncation logged as warning
- [x] Keep-alive ping: `{ type: 'ping' }` SSE every 15 s on all three streaming endpoints, cleared on first chunk
- [x] Streaming error recovery: `?resumeFrom=charOffset` query param on all three streaming endpoints; replays saved content from offset; falls through to fresh generation if no saved content
- [x] AI usage logging: `input_tokens`, `output_tokens`, `model_used` saved on `research_notes` (was already designed); new migration adds same columns to `itinerary_versions`
- [x] `AnthropicProvider.streamWithUsage()` — `StreamHandle` class wrapping Anthropic message stream; `getUsage()` method called after iteration
- [x] `supabase/migrations/20260420000004_itinerary_versions_token_columns.sql` — adds three columns
- [x] `apps/api/src/services/contextManager.test.ts` — 13 unit tests, all passing
- [x] Route tests updated: `streamWithUsage` mock across research/draft/revise; 9 new tests (usage logging, resume); vi.clearAllMocks() added to research.test.ts and draft.test.ts
- [x] 114 tests all passing (first run after fixes: 3 failures resolved — all mock call-count isolation)

---

## Sprint 4 — Polish + Launch (Weeks 19–26)

### Weeks 19–20: Client Portal ✅
- [x] `supabase/migrations/20260421000005_portal_tokens.sql` — portal_tokens table (token, trip_id, revoked, expires_at)
- [x] `POST /trips/:id/portal/token` — Clerk-protected; generates 256-bit base64url token; returns { token, portalUrl }
- [x] `GET /portal/:token` — public (no Clerk); validates token; returns trip metadata + latest itinerary markdown
- [x] `GET /portal/:token/pdf` — public; generates PDF via puppeteer + marked; streams as attachment
- [x] `apps/api/src/services/pdfGenerator.ts` — markdown → styled HTML → PDF via puppeteer headless Chromium
- [x] `apps/api/src/routes/portal.ts` + `portal.test.ts` — 15 tests all passing
- [x] `apps/web/src/pages/PortalPage.tsx` — public-facing itinerary viewer; react-markdown renderer; Download PDF button
- [x] `/portal/:token` route in App.tsx outside Clerk auth guard
- [x] `apiPublicFetch<T>()` exported from api.ts (no auth header)
- [x] ShareButton component on TripPage — visible at review/complete status; generates token, shows copyable URL

### Weeks 19–20 (continued): Booking Management + Vision Extraction ✅
- [x] `DELETE /trips/:tripId/bookings/:bookingId` — ownership check, deletes booking row + associated R2 source document (best-effort)
- [x] `DELETE /trips/:id` — ownership check; fetches all R2 keys (documents + itinerary versions); deletes trip row (FK cascades); best-effort R2 cleanup
- [x] `POST /trips/:tripId/bookings/manual` — JSON body; validates booking_slug + booking_type; encrypts allergy_flags; returns 201 with new record
- [x] Vision extraction in `ingest.worker.ts` — reads image as base64, calls Anthropic SDK directly with image content block (fast/Haiku tier), extracted text fed into normal parsing pipeline
- [x] BookingsCard UI — delete button per row (× with confirm dialog), "Add manually" button opens ManualBookingModal
- [x] ManualBookingModal — form for all booking fields (slug, type, ref, date, times, address, summary, meals/transport checkboxes)
- [x] TripPage — "Delete trip" link in header with confirmation dialog; navigates to dashboard after deletion
- [x] `apps/api/src/routes/bookings.test.ts` — NEW file; 10 tests covering DELETE booking, manual booking POST, and GET list (all passing)
- [x] `apps/api/src/routes/trips.test.ts` — 2 new tests for DELETE trip; 143 total tests all passing

### Weeks 19–20 (live debug + polish) ✅
- [x] **Bug fix**: `apiFetch` and `apiStream` now only set `Content-Type: application/json` when a body is present — Fastify v5 rejects the header on bodyless POSTs. Fixed research/stream, document generation, and portal token creation.
- [x] **Bug fix**: Manual booking insert removed non-existent `meeting_point` column (only `meeting_point_address` exists in schema). Was causing Supabase `PGRST204` schema cache error.
- [x] **Bug fix**: `isFirstUpload` condition in `UploadSection` changed from `!trip.documents_ingested && trip.bookings.length === 0` to `!trip.documents_ingested` — manual bookings were preventing `documents_ingested` from ever being set `true`, blocking research.
- [x] **Feature**: Research prompt updated to include `[Verify on Google]` search links per venue (search URL constructed from venue name + city — no hallucination risk). Prompt explicitly forbids direct website/Maps URLs.
- [x] **Feature**: `ResearchPanel` switched from `<pre>` to `ReactMarkdown` with `@tailwindcss/typography` prose styles — venue links are now clickable, open in new tab.

### Security Hardening — Tier 1 (Weeks 21–22, done before email) ✅
- [x] AI streaming rate limit: 5 req/min per IP on `/research/stream`, `/draft/stream`, `/revise/stream` (1000 in test mode to avoid false failures)
- [x] Google Maps SSRF: `encodeURIComponent()` replaces `replace(/ /g, '+')` in `docxGenerator.ts` — supports Unicode destinations, neutralises injection
- [x] Portal token default expiry: 90 days after `trip.end_date`, or 90 days from NOW() if end_date is null
- [x] Portal token revoke: `DELETE /trips/:id/portal/token` revokes all active tokens; "Revoke link" button added to ShareButton in TripPage
- [x] POST /document body schema: evaluated and declined — handler never reads body, Fastify v5 rejects `undefined` against schema, zero security benefit

### Security Hardening — Tier 2 (architectural, done before email) ✅
- [x] `apps/api/src/services/db.ts` — `getDB()` wraps service-role client; `getTripForConsultant(db, tripId, consultantId, select?)`, `getClientForConsultant()`, `getClientsForConsultant()` enforce ownership at query level
- [x] `apps/api/eslint.config.js` — `no-restricted-imports` rule bans direct `lib/supabase` imports in all `src/routes/**/*.ts` files; TypeScript parser via `typescript-eslint`; script `pnpm --filter @trip-planner/api lint`
- [x] All route handlers (`research.ts`, `draft.ts`, `revise.ts`, `document.ts`, `trips.ts`, `clients.ts`, `bookings.ts`, `portal.ts`) migrated from `getSupabase()` → `getDB()` + shared `getTripForConsultant()`; local duplicate functions removed
- [x] `apps/api/src/queues/document.queue.ts` — BullMQ queue for async DOCX generation (`DocumentJobData`, `DocumentJobResult`, `getDocumentQueue()`)
- [x] `apps/api/src/workers/document.worker.ts` — `processDocumentJob()` generates DOCX, uploads to R2, updates `itinerary_versions.docx_r2_key`, advances trip status → `review`; `startDocumentWorker()` with concurrency 2
- [x] `apps/api/src/routes/document.ts` — POST now returns 202 + `{ jobId }`; new `GET /trips/:id/document/job/:jobId` polling endpoint; generation moved to worker
- [x] `apps/api/src/index.ts` — `startDocumentWorker()` wired alongside `startIngestWorker()`; both closed on SIGTERM/SIGINT
- [x] `apps/web/src/pages/TripPage.tsx` (DocumentPanel) — polls job status every 2s; "Queued…" / "Generating…" states while job runs; transitions to download link on completion
- [x] `apps/api/src/routes/document.test.ts` — rewritten for async pattern; job-queue mocked; tests for 202 response, job-not-found 404, active/waiting/completed/failed states; 30 tests total
- [x] 145 tests all passing; ESLint lint clean; web typecheck clean

### Weeks 21–22: Email Notifications ✅
- [x] Transactional email provider: **Resend** (`resend` package); fire-and-forget; no-op when `RESEND_API_KEY` absent
- [x] `apps/api/src/services/email.ts` — `sendTripCreatedEmail`, `sendDraftReadyEmail`, `sendDocumentReadyEmail`
- [x] `apps/api/src/lib/unsubscribeToken.ts` — HMAC-SHA256 signed tokens (reuses `ENCRYPTION_KEY`, timing-safe)
- [x] `apps/api/src/routes/unsubscribe.ts` — `GET /unsubscribe?token=` public endpoint; sets `email_notifications=false`; returns HTML confirmation
- [x] `apps/api/src/routes/unsubscribe.test.ts` — 6 tests (missing token, tampered token, happy path, DB side-effect, DB error 500)
- [x] `supabase/migrations/20260421000006_consultant_email_notifications.sql` — `email_notifications boolean DEFAULT true` on consultants (**migration applied**)
- [x] `lib/consultant.ts` — `email_notifications` added to `Consultant` interface and SELECT query
- [x] Email triggers wired: `trips.ts` (trip created), `draft.ts` (draft ready), `document.worker.ts` (document ready)
- [x] 151 tests all passing
- [ ] **Deferred**: Create Resend account, add `RESEND_API_KEY` + `RESEND_FROM_EMAIL` to `.env` — code is ready, no-op until keys are added

### Weeks 23–24: Security Audit ✅
- [x] `pnpm audit` — 2 moderate vulns found, both in `vitest→vite→esbuild` dev-dependency chain (dev-only, no production exposure)
- [x] Vitest upgrade attempt (v4): broke streaming test mocks (`vi.fn().mockImplementation()` incompatible with v4 hoisting). Held at vitest 2.x; documented gotcha.
- [x] **Auth sweep**: All 27 protected routes confirmed `requireAuth` ✓; 3 intentionally public routes correct (`/portal/:token`, `/portal/:token/pdf`, `/unsubscribe`) ✓
- [x] **SSRF sweep**: One surface only (Google Maps in `docxGenerator.ts`); hostname locked + `encodeURIComponent`; no other outbound fetches found
- [x] **Runtime bug fixed**: `bookings.ts:83` — `getSupabase()` called without import; would throw `ReferenceError` on every booking upload. Fixed to use `supabase` already in scope.
- [x] **Type safety fixed**: `trips.ts:52` and `portal.ts:24` — `ReturnType<typeof getSupabase>` with unimported identifier resolved silently to `any`. Fixed to use `type DB` from `services/db.ts`.
- [x] No TODO/FIXME/HACK comments found in codebase
- [ ] **Deferred**: CI `pnpm audit` on every PR (no CI pipeline exists yet — addressed in Weeks 25–26)
- [ ] **Deferred**: ClamAV / Cloudflare WAF file scanning (infrastructure dependency; low priority for solo-consultant tool)

### Weeks 25–26: Beta + Public Launch
- [ ] Staging environment (separate Supabase project + R2 bucket)
- [ ] Monitoring: Sentry for error tracking
- [ ] Analytics: PostHog for product usage
- [ ] Onboarding flow: first-time consultant setup wizard
- [ ] Pricing page + Stripe integration
- [ ] Public launch

---

## Immediate Next Actions (start of next session)

**Supabase migrations — all applied:**
- `20260421000005_portal_tokens.sql` ✅
- `20260421000006_consultant_email_notifications.sql` ✅

**Current test suite:** 151 tests across 9 files, all passing.  
Run with: `pnpm --filter @trip-planner/api test`  
Lint: `pnpm --filter @trip-planner/api lint`

**Known outstanding issue:** Delete trip button not confirmed working on pre-existing trips — test on a newly created trip before relying on it.

**Deferred activation:** Email notifications are fully coded. To activate: create Resend account → add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to `.env`. No code changes required.

**Next task: Sprint 4 — Beta + Public Launch (Weeks 25–26)**

1. **Staging environment** — separate Supabase project + R2 bucket
2. **Monitoring** — Sentry for error tracking
3. **Analytics** — PostHog for product usage
4. **Onboarding flow** — first-time consultant setup wizard
5. **Pricing + Stripe** — pricing page + subscription billing
6. **Public launch**
