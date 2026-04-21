# TripPlanner — Project Task List

> Last updated: 2026-04-20  
> Current position: Sprint 2, Week 9 complete  
> Next task: Week 10 — Trip workspace page

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

### Week 10: Trip Workspace Page ⬅ START HERE
- [ ] `apps/web/src/pages/TripPage.tsx` — GET /trips/:id
  - Trip header: destination, dates, status badge (colour-coded by status)
  - Traveler profile summary card (group composition, pace, budget, interests)
  - Brief panel: expandable JSON viewer or structured field display
  - Bookings list: table of ingested bookings (date, type, time, meeting point)
  - Empty state for each section
- [ ] Wire route: `/trips/:id` in App.tsx
- [ ] Link from DashboardPage trip rows → `/trips/:id`
- [ ] Status badge colour map: setup=gray, ingestion=yellow, research=blue, draft=orange, review=purple, complete=green

### Week 11: Document Upload UI
- [ ] Upload button on TripPage (only shown when status = setup or ingestion)
- [ ] File picker → POST /trips/:tripId/bookings/upload (multipart)
- [ ] Job polling: GET /trips/:tripId/bookings/job/:jobId every 2s → show progress bar
- [ ] On job complete: invalidate /trips/:id query → bookings list refreshes
- [ ] Error state: show job error message if ingestion fails
- [ ] After upload: PATCH /trips/:id/brief { documentsIngested: true, status: 'ingestion' } if first document

### Week 12: Sprint 2 Polish
- [ ] Dashboard: add client filter (URL param `?client=id` already read; hook up dropdown)
- [ ] Dashboard: empty state with CTA to create first trip
- [ ] Navigation: active link highlight in Sidebar
- [ ] Error boundaries on each page
- [ ] Loading skeleton components (replace spinner with content-shaped skeletons)
- [ ] Responsive layout check (tablet minimum)
- [ ] Run full typecheck + tests; fix any drift

---

## Sprint 3 — AI Integration (Weeks 13–18)

> Sprint 3 detail will be fleshed out when Sprint 2 is done. High-level plan:

### Week 13: Research Phase (Phase 3)
- [ ] SSE streaming endpoint: POST /trips/:id/research/stream
- [ ] AnthropicProvider `stream()` method wired to destination research prompt
- [ ] Gate check: documents_ingested must be true before research can start
- [ ] Research output saved to `research_notes` table
- [ ] Web: "Start Research" button on TripPage (shown when status = ingestion and documents_ingested = true)
- [ ] Web: streaming output display (live text as tokens arrive)

### Week 14: Itinerary Draft (Phase 5)
- [ ] POST /trips/:id/draft/stream — quality tier, full itinerary prompt
- [ ] Dedup check logic (no venue appears twice without reason)
- [ ] Draft saved to `itinerary_versions` (version 1)
- [ ] Web: draft viewer on TripPage (markdown rendered)

### Week 15: Document Generation (Phase 6)
- [ ] POST /trips/:id/document — generates .docx, uploads to R2, saves itinerary_versions row
- [ ] Google Maps Static API integration for day maps (addresses, not venue names)
- [ ] Web: "Generate Document" button; download link on completion

### Week 16: Revision Flow (Phase 7)
- [ ] POST /trips/:id/revise — balanced tier; takes client feedback, returns diff
- [ ] Writes itinerary-v[N+1].md and triggers document re-generation
- [ ] Web: feedback input panel; version history list

### Weeks 17–18: Context Manager + Streaming Polish
- [ ] Context manager — caps token budget per phase, summarises prior context when over limit
- [ ] Streaming error recovery (reconnect on drop)
- [ ] AI usage logging (token counts per trip, per phase) — not PII

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

1. **Run Supabase migration** (if not done yet):
   ```sql
   -- File: supabase/migrations/20260420000002_clients_contact_fields.sql
   alter table clients
     add column if not exists phone        text not null default '',
     add column if not exists address_line text not null default '',
     add column if not exists city         text not null default '',
     add column if not exists country      text not null default '',
     add column if not exists postal_code  text not null default '';
   ```

2. **Begin Week 10** — Trip workspace page (`apps/web/src/pages/TripPage.tsx`)

3. **Route to add** in `apps/web/src/App.tsx`:
   ```tsx
   <Route path="/trips/:id" element={<TripPage />} />
   ```

4. **API shape** for `GET /trips/:id` response (already implemented):
   ```typescript
   {
     id, destination, destination_slug, destination_country, departure_city,
     start_date, end_date, duration_days, purpose, purpose_notes,
     status, documents_ingested, created_at, updated_at,
     clients: { consultant_id },
     brief: { brief_json, version, created_at } | null,
     bookings: Booking[],
     itineraryVersions: { id, version_number, docx_r2_key, created_at }[]
   }
   ```
