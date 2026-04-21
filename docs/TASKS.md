# TripPlanner — Project Task List

> Last updated: 2026-04-21  
> Current position: Sprint 3, Weeks 17–18 complete  
> Next task: Sprint 4 — Client Portal (Weeks 19–20)

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

### Weeks 19–20: Client Portal
- [ ] Read-only shareable trip link (no Clerk account needed)
- [ ] Token-based auth for client portal URLs
- [ ] Client portal page: itinerary viewer (final version only)
- [ ] PDF export option for clients

### Weeks 21–22: Email Notifications
- [ ] Email on: trip created, itinerary ready, document ready
- [ ] Transactional email provider (Resend or Postmark)
- [ ] Unsubscribe handling

### Weeks 23–24: Security Audit
- [ ] CI: `npm audit --audit-level=high` on every PR
- [ ] Dependency review: remove any unused packages
- [ ] Penetration test checklist: auth bypass, IDOR, SSRF
- [ ] SSRF: whitelist allowed domains for any server-side URL fetch
- [ ] ClamAV file scanning before ingest pipeline (or use Cloudflare WAFV2 upload scanning)

### Weeks 25–26: Beta + Public Launch
- [ ] Staging environment (separate Supabase project + R2 bucket)
- [ ] Monitoring: Sentry for error tracking
- [ ] Analytics: PostHog for product usage
- [ ] Onboarding flow: first-time consultant setup wizard
- [ ] Pricing page + Stripe integration
- [ ] Public launch

---

## Immediate Next Actions (start of next session)

**All Supabase migrations are up to date** — nothing to run before starting.

**Current test suite:** 114 tests across 6 files, all passing.  
Run with: `pnpm --filter @trip-planner/api test`

**Next task: Sprint 4 — Client Portal (Weeks 19–20)**

1. **Read-only shareable trip link** — no Clerk account needed; token-based auth for client portal URLs
2. **Client portal page** — itinerary viewer (final version only, read-only)
3. **PDF export option** — for clients to download a PDF version of the itinerary
