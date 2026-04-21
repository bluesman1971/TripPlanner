# TripPlanner — Architecture Reference

> Last updated: 2026-04-21  
> Build status: Sprint 4, Weeks 21–24 complete (Email Notifications + Security Audit)  
> Prototype validated on Barcelona trip (April 19 2026)

---

## 1. What This Is

AI-powered trip planning SaaS for solo travel consultants. The consultant uses the app to plan and produce bespoke client itineraries. The AI handles research, draft generation, and document production. The consultant reviews, adjusts, and publishes.

---

## 2. Monorepo Layout

```
TripPlanner/
├── apps/
│   ├── api/          — Fastify + TypeScript backend (Node.js)
│   └── web/          — React + Vite + TypeScript frontend
├── packages/
│   └── shared/       — Zod schemas, AI provider interface, shared types
├── supabase/
│   └── migrations/   — SQL migration files (run manually in Supabase SQL editor)
├── docs/
│   ├── ARCHITECTURE.md  ← this file
│   └── TASKS.md         ← sprint task tracker
└── pnpm-workspace.yaml
```

Package manager: **pnpm** with workspaces + **Turborepo**  
Node version: 22.x

---

## 3. Stack

| Layer | Technology |
|---|---|
| Backend framework | Fastify v5 + TypeScript |
| Frontend framework | React 19 + Vite 6 + Tailwind CSS v4 |
| Database | PostgreSQL via Supabase (service-role client on backend) |
| Auth | Clerk — JWT tokens; `@clerk/fastify` on API, `@clerk/react` on web |
| File storage | Cloudflare R2 (AWS S3-compatible, SDK v3) |
| Job queue | BullMQ + Upstash Redis (ioredis over `rediss://`) |
| AI | Anthropic Claude via `AIProvider` abstraction |
| Server state (web) | TanStack React Query v5 |
| Routing (web) | react-router-dom v7 |
| Validation | Zod (shared package) |
| Testing | Vitest + Fastify inject (API) |
| Encryption | AES-256-GCM application-level (sensitive columns only) |

---

## 4. Environment Variables

### `apps/api/.env`

```
# Clerk
CLERK_SECRET_KEY=sk_...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Cloudflare R2
CLOUDFLARE_ACCOUNT_ID=...   # used by r2.ts — NOT R2_ACCOUNT_ID
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=trip-planner-bookings
R2_PUBLIC_URL=https://pub-xxx.r2.dev   # or custom domain

# Upstash Redis
UPSTASH_REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# Encryption
ENCRYPTION_KEY=75109dddb84c28ba5915b3938ec8e8bb0c5f6109dd4cbf59d4d409694fc7bcd1

# Server
PORT=3000
CORS_ORIGIN=http://localhost:5174    # must match actual Vite dev port
```

### `apps/web/.env`

```
VITE_CLERK_PUBLISHABLE_KEY=pk_...
VITE_API_URL=http://localhost:3000
```

### Optional env vars (feature-gated)

```
# Google Maps Static API — enables day map images in generated DOCX files.
# Without this key, maps are silently skipped and generation still succeeds.
GOOGLE_MAPS_API_KEY=AIza...
```

**Critical:** `import 'dotenv/config'` must be the **first import** in `apps/api/src/index.ts`. tsx does not auto-load `.env`.

---

## 5. Database Schema (Supabase / PostgreSQL)

All tables have RLS enabled. Policy pattern: `consultant_id = (auth.jwt() ->> 'sub')`.  
The backend uses the **service-role** Supabase client and enforces ownership manually via `consultant_id` filters on every query.

### Tables

**`consultants`**
```
id            uuid PK (= Clerk user ID)
email         text
created_at    timestamptz
```

**`clients`**
```
id            uuid PK
consultant_id uuid FK → consultants.id
name          text NOT NULL
email         text NOT NULL
phone         text default ''
address_line  text default ''
city          text default ''
country       text default ''
postal_code   text default ''
created_at    timestamptz
```

**`trips`**
```
id                   uuid PK
client_id            uuid FK → clients.id
destination          text
destination_slug     text
destination_country  text
departure_city       text
start_date           date nullable
end_date             date nullable
duration_days        int nullable
purpose              text  (enum: leisure|business|anniversary|honeymoon|family|other)
purpose_notes        text
status               text  (enum: setup|ingestion|research|draft|review|complete)
documents_ingested   boolean default false
created_at           timestamptz
updated_at           timestamptz
```

**`trip_brief`** — versioned JSONB, one row per version
```
id          uuid PK
trip_id     uuid FK → trips.id
version     int
brief_json  jsonb   ← contains traveler_profile, discovery, pre_booked, version_history
created_at  timestamptz
```

`brief_json` shape:
```json
{
  "trip_id": "...",
  "destination": "...",
  "destination_slug": "...",
  "destination_country": "...",
  "departure_city": "...",
  "purpose": "...",
  "purpose_notes": "...",
  "status": "setup",
  "documents_ingested": false,
  "discovery": {
    "visitCount": 0,
    "classicBespoke": 50,
    "mustSees": [],
    "alreadyDone": []
  },
  "traveler_profile": {
    "travelers": [{ "role": "primary", "age_group": "40s", "notes": "" }],
    "daily_walking": "medium",
    "activity_level": "moderate",
    "physical_limitations": "",
    "interests": ["food-wine", "architecture"],
    "dietary_restrictions": [],
    "dining_style": "mixed",
    "budget_tier": "upscale",
    "itinerary_pace": "balanced"
  },
  "pre_booked": [],
  "version_history": [{ "date": "2026-04-20", "note": "Trip created" }]
}
```

**`bookings`**
```
id                    uuid PK
trip_id               uuid FK → trips.id
booking_slug          text
booking_type          text  (flight|hotel|tour|transfer|activity|restaurant|other)
date                  date
start_time            text
end_time              text
meeting_point_address text
r2_key                text  ← R2 object key, never original filename
raw_text              text  ← AES-256-GCM encrypted
allergy_flags         text  ← AES-256-GCM encrypted JSON array
ingested_at           timestamptz
```

**`itinerary_versions`**
```
id                    uuid PK
trip_id               uuid FK → trips.id
version_number        int
markdown_content      text NOT NULL   ← AI-generated itinerary markdown
generator_script_path text            ← nullable; reserved for future use
docx_r2_key           text            ← nullable until document is generated
created_at            timestamptz
unique(trip_id, version_number)
```
Note: ARCHITECTURE.md previously omitted `markdown_content`; the migration always had it.

**`documents`**
```
id          uuid PK
trip_id     uuid FK → trips.id
r2_key      text
filename    text
mime_type   text
size_bytes  int
uploaded_at timestamptz
```

**`portal_tokens`**
```
id         uuid PK
trip_id    uuid FK → trips.id (ON DELETE CASCADE)
token      text UNIQUE NOT NULL   ← 256-bit base64url random token
created_at timestamptz
expires_at timestamptz nullable   ← null = never expires
revoked    boolean default false
```
Token auth: `GET /portal/:token` and `GET /portal/:token/pdf` are public routes. Token validity = exists AND revoked=false AND (expires_at IS NULL OR expires_at > now()).

**`research_notes`**
```
id         uuid PK
trip_id    uuid FK → trips.id
content    text NOT NULL   ← renamed from content_markdown by migration 000003
model_used text
input_tokens  int
output_tokens int
created_at timestamptz
```
Note: initial schema named this column `content_markdown`; migration 000003 renames it
to `content` to match application code.

### Migrations (run in order in Supabase SQL editor)

| File | What it does | Status |
|---|---|---|
| `20260420000000_initial_schema.sql` | All 8 tables + RLS | ✅ Run |
| `20260420000001_encrypt_allergy_flags.sql` | Change allergy_flags to text for encrypted storage | ✅ Run |
| `20260420000002_clients_contact_fields.sql` | Add phone, address_line, city, country, postal_code to clients | ✅ Run |
| `20260420000003_research_notes_rename_column.sql` | Rename `content_markdown` → `content` in research_notes | ✅ Run |
| `20260420000004_itinerary_versions_token_columns.sql` | Add input_tokens, output_tokens, model_used to itinerary_versions | ✅ Run |
| `20260421000005_portal_tokens.sql` | portal_tokens table for shareable client links | ⏳ Pending |

---

## 6. API Routes

Base URL: `http://localhost:3000`  
All routes require `Authorization: Bearer {clerk_jwt}` except `/health`.

### Health
```
GET  /health           → { status: 'ok' }
```

### Clients
```
GET    /clients         → Client[]
POST   /clients         → Client (201)
GET    /clients/:id     → Client
PATCH  /clients/:id     → Client
```

Client payload: `{ name, email, phone?, addressLine?, city?, country?, postalCode? }`

### Trips
```
GET    /trips           → TripSummary[]  (with nested client name)
POST   /trips           → Trip (201)
GET    /trips/:id       → Trip + brief + bookings + itineraryVersions
PATCH  /trips/:id/brief → BriefVersion
```

Trip create payload: `{ clientId, destination, destinationSlug, destinationCountry, departureCity?, startDate?, endDate?, durationDays?, purpose, purposeNotes?, discovery, travelerProfile }`

### Bookings
```
POST /trips/:tripId/bookings/upload         → { jobId } (202)
GET  /trips/:tripId/bookings/job/:jobId     → { status, result?, error? }
GET  /trips/:tripId/bookings                → Booking[]
```

Upload: multipart `file` field. Accepted types: `.pdf .docx .doc .html .htm .txt .md .jpg .jpeg .png .webp`. Max 20 MB.

### Research (Phase 3) — Week 13
```
POST /trips/:id/research/stream → SSE stream (text/event-stream)
GET  /trips/:id/research        → ResearchNote | null
```

SSE events: `{ type: 'chunk', text }` | `{ type: 'done' }` | `{ type: 'error', message }`  
Gate: `documents_ingested = true`. Model tier: **balanced**. Saves to `research_notes`. Advances status → `research`.

### Draft (Phase 5) — Week 14
```
POST /trips/:id/draft/stream → SSE stream (text/event-stream)
GET  /trips/:id/draft        → ItineraryVersion | null
```

SSE events: `{ type: 'chunk', text }` | `{ type: 'done', versionNumber }` | `{ type: 'error', message }`  
Gate: status must be `research`. Model tier: **quality** (claude-opus-4-6), maxTokens: 12 000. Saves to `itinerary_versions` with auto-incrementing version_number. Never overwrites. Advances status → `draft`.

### Document (Phase 6) — Week 15 (async rewrite: Tier 2)
```
POST /trips/:id/document              → { jobId } (202)
GET  /trips/:id/document/job/:jobId   → { status, result?, error? }
GET  /trips/:id/document              → { versionNumber, createdAt, downloadPath } | null
GET  /trips/:id/document/download     → DOCX binary (attachment)
```

POST gate: status must be `draft`, `review`, or `complete` (re-generation is allowed).  
POST enqueues a BullMQ job on the `document-generation` queue and returns `{ jobId }` immediately (202).  
Poll `GET /document/job/:jobId` for `{ status: 'waiting'|'active'|'completed'|'failed', result?, error? }`.  
Worker (`document.worker.ts`) generates DOCX via `docxGenerator.ts`, uploads to R2, saves `docx_r2_key` on the version row, and advances trip status → `review`.  
Download endpoint is an authenticated proxy — no presigned URLs, requires Clerk JWT.  
Google Maps day maps require `GOOGLE_MAPS_API_KEY` in `.env`; silently skipped if absent.

### Client Portal — Weeks 19–20
```
POST /trips/:id/portal/token        → { token, portalUrl }  (201; requires Clerk JWT)
GET  /portal/:token                 → { trip, itinerary }   (public — token-based auth)
GET  /portal/:token/pdf             → PDF binary             (public — token-based auth)
```

Token creation: consultant-only; verifies trip ownership. Returns a 256-bit base64url token and the full frontend portal URL.  
Public endpoints: no Clerk JWT. Token validated on every request. Invalid/revoked/expired → 404 (never 403, to prevent enumeration).  
PDF: markdown rendered to styled HTML via `marked`, then printed to PDF via puppeteer headless Chromium.  
`FRONTEND_URL` env var controls the portal URL prefix (falls back to `CORS_ORIGIN`).

### Booking Management — Weeks 19–20 (continued)
```
DELETE /trips/:tripId/bookings/:bookingId  → 204  (requires Clerk JWT)
POST   /trips/:tripId/bookings/manual      → 201 booking record  (requires Clerk JWT)
DELETE /trips/:id                          → 204  (requires Clerk JWT)
```

**DELETE booking**: Verifies trip ownership. Fetches the most recent `documents` row for R2 key. Deletes booking DB row; best-effort R2 file cleanup (failure logged, not propagated).  
**Manual booking**: JSON body; requires `booking_slug` (string) and `booking_type` (one of the 7 allowed types). All other fields optional. `allergy_flags` encrypted before insert. Returns 201 with the new booking row.  
**DELETE trip**: Verifies ownership; gathers all R2 keys from `documents` + `itinerary_versions`; deletes trip row (FK cascade handles bookings, briefs, research_notes, portal_tokens, itinerary_versions); then best-effort `Promise.allSettled()` R2 cleanup.

**Vision extraction** (`ingest.worker.ts`): Image files bypass text extraction. The image is read as base64 from the temp file; the Anthropic SDK is called directly (not through the shared `AIProvider` abstraction — the shared `Message` type only accepts `content: string`, not multipart arrays). Uses the `fast/Haiku` model. The extracted text is then passed to the normal `parseBookingDocument()` pipeline.

**Frontend changes**:
- `BookingsCard` — now receives the full `trip` object and an `onBookingDeleted` callback. Each row has a `×` delete button (confirm dialog, optimistic invalidation). "Add manually" button opens `ManualBookingModal`.
- `ManualBookingModal` — full-screen modal form covering all booking fields.
- `TripPage` — "Delete trip" link in the trip header; calls `DELETE /trips/:id`, invalidates `['trips']` query, navigates to `/`.

### Research Venue Verification — Live Debug Session
No API or DB changes. Two updates only:

**`researchPrompt.ts`**: System prompt updated to instruct Claude to append a `[Verify on Google](https://www.google.com/search?q=Venue+Name+City+Country)` link after every venue name in the CANDIDATE VENUES section. Claude constructs the URL from the venue name and destination city it already knows — spaces replaced by `+`. Explicit instruction: do NOT produce direct website or Maps URLs (hallucination risk); only this search pattern.

**`TripPage.tsx` ResearchPanel**: Switched from `<pre>` plain-text rendering to `ReactMarkdown` with `@tailwindcss/typography` prose styles. External links open in a new tab (`target="_blank" rel="noopener noreferrer"`). Applies to both the idle (saved note) view and the streaming view. Required installing `@tailwindcss/typography` and adding `@plugin "@tailwindcss/typography"` to `index.css`.

### Email Notifications — Weeks 21–22
```
GET /unsubscribe?token=...  → HTML confirmation page  (public — HMAC token auth)
```

Transactional email via **Resend** (`resend` npm package). Fires on three events:
- **Trip created** (`POST /trips`) — consultant notified after successful insert
- **Draft ready** (`POST /trips/:id/draft/stream`) — after version saved to `itinerary_versions`
- **Document ready** (`document.worker.ts`) — after DOCX uploaded and `docx_r2_key` saved

All sends are **fire-and-forget** — email failure never propagates to the HTTP caller or disrupts the SSE stream. If `RESEND_API_KEY` is absent (dev/test), every send is a silent no-op.

**Unsubscribe**: HMAC-SHA256 signed token (reuses `ENCRYPTION_KEY`, timing-safe comparison). Token format: `base64url(consultantId).<hmac-hex>`. No DB storage required. `GET /unsubscribe?token=` verifies the token and sets `consultants.email_notifications = false`.

**New env vars:**
```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=TripPlanner <notifications@yourdomain.com>
APP_URL=https://yourapp.com   # optional; falls back to CORS_ORIGIN
```

**New files:** `lib/unsubscribeToken.ts`, `services/email.ts`, `routes/unsubscribe.ts`  
**Migration:** `20260421000006_consultant_email_notifications.sql` — adds `email_notifications boolean DEFAULT true` to `consultants`

### Revision (Phase 7) — Week 16
```
POST /trips/:id/revise/stream → SSE stream (text/event-stream)
```

Body: `{ feedback: string }` — required, must be non-empty after trim.  
SSE events: `{ type: 'chunk', text }` | `{ type: 'done', versionNumber }` | `{ type: 'error', message }`  
Gate: status must be `draft`, `review`, or `complete`. No revision without an existing draft.  
Model tier: **balanced** (claude-sonnet-4-6), maxTokens: 12 000.  
Saves full revised markdown as `itinerary_versions` v[N+1] — never overwrites.  
Advances status `draft` → `review` only; leaves `review` and `complete` unchanged.  
There is no GET endpoint for revisions — `GET /trips/:id/draft` returns the latest version regardless of how it was created.

---

## 7. File Storage (Cloudflare R2)

| Purpose | Key format |
|---|---|
| Booking uploads | `bookings/{tripId}/{uuid}{ext}` |
| Generated DOCX | `itineraries/{tripId}/{uuid}.docx` |

Original filename is never used in any R2 key.  
Booking files are downloaded to a temp path for processing, then deleted from temp after ingestion.  
DOCX files are served via the authenticated download proxy (`GET /trips/:id/document/download`) — never via presigned URL.

---

## 8. Job Queue (BullMQ + Upstash Redis)

Two queues, both started in `index.ts` alongside the HTTP server.

### `ingest` queue
Worker: `apps/api/src/workers/ingest.worker.ts`

Job flow:
1. POST /bookings/upload → upload file to R2 → insert `documents` row → enqueue job → return `{ jobId }`
2. Worker picks up job → downloads R2 file to temp → extracts text (pdf-parse / mammoth / plain-text) → calls AnthropicProvider (`fast` tier) → encrypts `raw_text` and `allergy_flags` → upserts `bookings` row → deletes temp file

### `document-generation` queue
Worker: `apps/api/src/workers/document.worker.ts` — concurrency: 2

Job flow:
1. POST /trips/:id/document → verify ownership + gate → fetch latest itinerary version → enqueue job → return `{ jobId }` (202)
2. Worker picks up job → calls `generateDocx(markdown)` → uploads DOCX to R2 → updates `itinerary_versions.docx_r2_key` → advances trip status → `review`
3. Frontend polls GET /trips/:id/document/job/:jobId every 2s; on `completed` transitions from "Generating…" to download link

BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false` for Upstash compatibility.

---

## 9. Encryption

Module: `apps/api/src/lib/encryption.ts`  
Algorithm: AES-256-GCM  
Format: `enc:v1:{iv_base64}:{tag_base64}:{ciphertext_base64}`

Functions:
- `encrypt(plaintext)` / `decrypt(ciphertext)` — string in, string out
- `encryptJson(obj)` / `decryptJson(str)` — object in, encrypted string out
- `isEncrypted(str)` — returns true if string starts with `enc:v1:`

Plaintext fallback in `decrypt()` so pre-encryption rows still read correctly.

**Encrypted columns:** `bookings.raw_text`, `bookings.allergy_flags`

---

## 10. AI Provider

Interface: `packages/shared/src/ai/provider.interface.ts`  
Implementations: `apps/api/src/ai/anthropic.provider.ts`, `apps/api/src/ai/openai.provider.ts` (stub)

**Never call the Anthropic SDK directly from route handlers or services. Always go through `AIProvider`.**

### Model tiers (`apps/api/src/config/models.ts`)
```typescript
export const MODEL_CONFIG = {
  fast:     { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  balanced: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  quality:  { provider: 'anthropic', model: 'claude-opus-4-6' },
};
```

### Phase → tier mapping
| Phase | Tier |
|---|---|
| 1 — Client interview | fast |
| 2.5 — Text PDF/DOCX ingestion | fast |
| 2.5 — Image-based PDF (vision) | balanced |
| 3 — Destination research | balanced |
| 4–5 — Itinerary draft + review | quality |
| 6 — Revision | balanced |
| 7 — Generator (if AI-assisted) | fast |

---

## 11. Security Constraints

1. **No PII in logs.** `safeError()` in logger.ts strips full Supabase error objects. `redact()` removes known PII keys.
2. **No API keys in frontend.** Anthropic key, DB credentials, R2 credentials → backend only.
3. **Encrypted at rest.** `trip_brief` JSONB may contain allergy/medical data. `bookings.raw_text` and `bookings.allergy_flags` are encrypted before insert.
4. **RLS on all tables.** Backend enforces additionally via `services/db.ts` scoped helpers. `getDB()` returns the service-role client; `getTripForConsultant(db, tripId, consultantId)` always filters by `clients.consultant_id`. Direct `lib/supabase` imports are banned in route handlers via ESLint `no-restricted-imports` (`apps/api/eslint.config.js`).
5. **File upload whitelist.** `.pdf .docx .doc .html .htm .txt .md .jpg .jpeg .png .webp`, max 20 MB.
6. **Helmet + rate limiting.** `@fastify/helmet` security headers; `@fastify/rate-limit` 120 req/min global; AI streaming endpoints (`/research/stream`, `/draft/stream`, `/revise/stream`) capped at 5 req/min per IP.
7. **No raw SQL.** Parameterized queries only via Supabase client.

---

## 12. Frontend Structure

```
apps/web/src/
├── main.tsx            — ClerkProvider → QueryClientProvider → BrowserRouter → App
├── App.tsx             — Route definitions (all pages wrapped in ErrorBoundary)
├── lib/
│   ├── api.ts          — useApi() hook: apiFetch, apiUpload, apiStream, apiDownload
│   └── queryClient.ts  — TanStack Query client config
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx  — Outer layout with sidebar + main content area
│   │   └── Sidebar.tsx   — Nav links (Dashboard, Clients, New Trip)
│   └── ui/
│       ├── LoadingSpinner.tsx
│       ├── ErrorMessage.tsx
│       ├── ErrorBoundary.tsx  — React class boundary; wraps each route
│       └── Skeleton.tsx       — TripListSkeleton, ClientListSkeleton, TripPageSkeleton
└── pages/
    ├── SignInPage.tsx     — Clerk <SignIn> component
    ├── DashboardPage.tsx  — Trip list; client filter via ?client= URL param
    ├── ClientsPage.tsx    — Client list, create/edit modal
    ├── NewTripPage.tsx    — 5-step trip creation wizard
    ├── PortalPage.tsx     — Public client portal (no Clerk auth); fetches via apiPublicFetch
    └── TripPage.tsx       — Trip workspace; contains:
                              UploadSection        — file upload + job polling
                              ResearchPanel        — stream/display research (Phase 3)
                              DraftPanel           — stream/display draft (Phase 5)
                              RevisionPanel        — feedback textarea + stream revision (Phase 7)
                              DocumentPanel        — generate + download DOCX (Phase 6)
                              VersionHistoryCard   — all versions newest-first; per-version .docx download
```

### useApi() methods

| Method | Purpose |
|---|---|
| `apiFetch<T>(path, options?)` | JSON fetch with Clerk JWT |
| `apiUpload<T>(path, formData)` | Multipart upload with Clerk JWT |
| `apiStream(path, onChunk, options?)` | SSE fetch; calls `onChunk` per text chunk |
| `apiDownload(path, filename)` | Binary fetch → triggers browser download |
| `apiPublicFetch<T>(path)` | JSON fetch **without** Clerk JWT — for portal endpoints |

`apiPublicFetch` is a named export (not inside `useApi()`) since the portal page has no Clerk context.

`apiStream` uses `fetch()` + `ReadableStream.getReader()` (not `EventSource`) because `EventSource` cannot send custom headers (Clerk JWT required).

### Trip Wizard Steps (NewTripPage)
1. **Client** — pick from existing clients (card picker)
2. **Group** — add travelers: role chips, age-group chips, optional notes; add/remove
3. **Preferences** — walking level, activity level, physical limitations, interests (max 4), dining style, budget tier, dietary restrictions (tag input), itinerary pace
4. **Destination & Purpose** — destination, country, departure city, start/end dates, purpose chips, notes
5. **Discovery** — visit count, classic/bespoke slider, must-sees (tag input), already-done (tag input)

---

## 13. Known Gotchas

| Issue | Fix |
|---|---|
| tsx doesn't load .env | `import 'dotenv/config'` must be first import in index.ts |
| CORS mismatch | CORS_ORIGIN must match actual Vite dev port (currently 5174) |
| BullMQ + Upstash | `maxRetriesPerRequest: null`, `enableReadyCheck: false`, `tls: {}` when URL starts with `rediss://` |
| Mammoth ships its own types | Do not install `@types/mammoth` — it doesn't exist on npm |
| pdf-parse version | Pinned to **v1.1.1** in package.json. v2 (by a different author) exports a class, not a function — incompatible API. Do not upgrade. Import: `const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>` |
| tsconfig rootDir | Do not set `rootDir: src` in apps/api — it blocks access to packages/shared |
| Google Docs DOCX | Use `WidthType.DXA` not `WidthType.PERCENTAGE`; `ShadingType.CLEAR` not `ShadingType.SOLID` |
| Itinerary versions | Never overwrite — always write v[N+1] |
| Phase 3 gate | `documents_ingested: true` must be set before research phase can start |
| SSE + Fastify | Set headers via `reply.raw.setHeader()` BEFORE `reply.hijack()`. Set CORS header manually on `reply.raw` — `@fastify/cors` doesn't fire after hijack |
| EventSource auth | `EventSource` API cannot send `Authorization` headers. Use `fetch()` + `ReadableStream.getReader()` for all SSE endpoints |
| research_notes column rename | Initial schema had `content_markdown`; migration 000003 renames it to `content`. Migration confirmed run. |
| docx ImageRun | Pass `type: 'png'` explicitly; accessing `TextRun.root` is protected — filter empty runs before constructing `TextRun` objects |
| StreamHandle + AnthropicProvider | Routes use `provider.streamWithUsage()` (concrete method, not on `AIProvider` interface) which returns a `StreamHandle`. Call `handle.getUsage()` AFTER iterating to completion — `finalMessage()` requires the stream to be exhausted |
| Context budget heuristic | `estimateTokens` uses 4 chars/token. This is a rough estimate — actual token count varies by language and encoding. Good enough for budget gating; do not use for billing |
| setInterval + hijacked SSE | The ping interval MUST be cleared in `finally { stopPing(); }` — if not cleared, it may fire after `reply.raw.end()` and write to a closed stream |
| vi.clearAllMocks() | All test files that assert on mock call counts must call `vi.clearAllMocks()` at the top of `beforeEach`. Omitting it causes call counts to accumulate across tests |
| R2 account ID env var | Code reads `CLOUDFLARE_ACCOUNT_ID` — **not** `R2_ACCOUNT_ID`. Docs previously had the wrong name. Wrong/missing value causes a silent hang on file upload (AWS SDK has no default timeout). |
| Portal token enumeration | Public portal endpoints return 404 (not 403) for invalid/revoked/expired tokens to prevent confirming that a token exists |
| puppeteer on Windows | `--no-sandbox` flag required in `puppeteer.launch()` args; puppeteer downloads Chromium on first `pnpm install` (~200 MB) |
| FRONTEND_URL env var | Optional; controls the portal URL prefix in `POST /trips/:id/portal/token` response. Falls back to `CORS_ORIGIN`. Add to `apps/api/.env` when deploying. |
| Fastify v5 empty JSON body | Fastify v5 rejects any request with `Content-Type: application/json` and an empty body (`FST_ERR_CTP_EMPTY_JSON_BODY`). `apiFetch` and `apiStream` in `api.ts` must NOT set `Content-Type: application/json` on bodyless POSTs. Fixed: header is now conditional on `options.body` being present. Affected: research/stream, portal/token, document generation. |
| `meeting_point` vs `meeting_point_address` | The `bookings` table has `meeting_point_address` only — there is no separate `meeting_point` column. The manual booking insert previously included `meeting_point` which caused a Supabase schema cache error. Removed. |
| Venue URL hallucination | Do NOT ask Claude to produce direct website or Google Maps place URLs — it will hallucinate plausible-looking but incorrect links. Instead, instruct it to construct Google search URLs from venue name + city (`https://www.google.com/search?q=Venue+Name+City`). These are always correct because Claude builds them from text it already wrote. |
| Google Maps address encoding | `fetchMapImage` in `docxGenerator.ts` uses `encodeURIComponent(addr + ', ' + destination)` for the marker location — NOT `replace(/ /g, '+')`. URI encoding handles Unicode addresses (Zürich, Málaga, etc.) and neutralises newline/header injection. The hostname check (`ALLOWED_MAP_HOST`) remains as belt-and-suspenders. (Tier 1 security fix) |
| Route handlers and lib/supabase | Route handlers must NOT import from `lib/supabase` directly. Use `getDB()` and the scoped helpers from `services/db.ts`. Enforced by ESLint `no-restricted-imports` in `eslint.config.js`. Workers and lib files are exempt — they legitimately call the service-role client without a user context. |
| `ReturnType<typeof getSupabase>` in route files | Using `ReturnType<typeof getSupabase>` as a parameter type in route files where `getSupabase` is not imported resolves silently to `any` in TypeScript — no compiler error, but type safety is lost. Use `type DB` imported from `services/db.ts` instead. |
| `getSupabase()` call without import (runtime bug) | `bookings.ts` upload handler previously called `getSupabase()` as a second client for the `documents` insert, but `getSupabase` was not imported. This caused a `ReferenceError` at runtime on every booking upload. Fixed: use the `supabase` variable already in scope from `getDB()`. Always use the client already obtained at the top of the handler. |
| Vitest upgrade to v3+/v4 | Vitest 4 breaks all three streaming test files: `AnthropicProvider` is mocked with `vi.fn().mockImplementation()` but Vitest 4 hoisting changes cause the mock to be applied before `vi.fn()` resolves, resulting in `TypeError: is not a constructor`. Stay on Vitest 2.x until the mock pattern is updated to `vi.hoisted()`. The CVEs in the vitest→vite→esbuild chain are dev-only and do not affect production. |
| Resend email — no-op without API key | `services/email.ts` checks for `RESEND_API_KEY` at send time and returns immediately if absent. This means emails silently do nothing in dev/test — correct behaviour, not a bug. Add the key to `.env` when ready to activate. |
| Unsubscribe token uses ENCRYPTION_KEY | `lib/unsubscribeToken.ts` signs tokens with HMAC-SHA256 keyed on `ENCRYPTION_KEY`. Rotating `ENCRYPTION_KEY` invalidates all outstanding unsubscribe links. Use a dedicated `UNSUBSCRIBE_SECRET` env var if key rotation is required in future. |
| Document generation timeout | Document generation (DOCX + Google Maps fetches) can take 8 s per map image × N days. Moved to BullMQ `document-generation` queue — POST returns 202 + jobId immediately; frontend polls GET /document/job/:jobId. Avoids reverse-proxy 30 s timeout. |
| AI streaming rate limit | `/research/stream`, `/draft/stream`, `/revise/stream` are limited to 5 req/min per IP in production. In `NODE_ENV=test` the limit is set to 1000 to avoid flapping test counts. |
| Portal token expiry | Tokens default to 90 days after `trip.end_date`; if `end_date` is null, 90 days from token creation time (`NOW()`). Never use `created_at + 90d` — the trip may have been created months before the token. |
| POST /document body schema | Fastify v5 validates `undefined` against a JSON Schema body definition and rejects it. Since `POST /trips/:id/document` never reads `request.body`, adding a body schema provides zero security benefit and breaks inject-based tests. Recommendation to add one was evaluated and declined. |
| @tailwindcss/typography | Required for `prose` classes used in ResearchPanel markdown rendering. Install with `pnpm add @tailwindcss/typography` in `apps/web`, then add `@plugin "@tailwindcss/typography";` to `apps/web/src/index.css`. Tailwind v4 plugin syntax — not the v3 `plugins: [require(...)]` approach. |
| `isFirstUpload` gate | The `UploadSection` condition was `!trip.documents_ingested && trip.bookings.length === 0`. The `bookings.length` check blocked the `documentsIngested: true` PATCH when manual bookings existed, leaving `documents_ingested` permanently `false` and blocking research. Fixed to `!trip.documents_ingested` only. |

---

## 14. Test Fixture

`clients/tb-20260329/trips/barcelona-20260424/` — canonical regression test case.

Critical values that must not drift:
- Food tour `start_time` = `10:30` (not `11:00`)
- Park Güell `meeting_point_address` = `Ctra. del Carmel, 23` (not the park entrance)
- Palau de la Música = **self-guided audioguide** (not guided tour)
- Shellfish allergy must appear in `consultant_action_required` when `operator_email` is present

---

## 15. Dev Commands

```bash
# From repo root
pnpm dev                              # starts api + web concurrently via Turborepo
pnpm --filter @trip-planner/api dev   # API only (port 3000)
pnpm --filter @trip-planner/web dev   # Web only (port 5174)
pnpm --filter @trip-planner/api test  # Vitest (151 tests across 9 files — all passing)
pnpm --filter @trip-planner/api lint  # ESLint — enforces no direct lib/supabase imports in routes
pnpm --filter @trip-planner/api typecheck
pnpm --filter @trip-planner/web typecheck
```

### API service files

```
apps/api/src/
├── services/
│   ├── db.ts               — getDB(), getTripForConsultant(), getClientForConsultant(), getClientsForConsultant()
│   │                          All route handlers must import from here — never from lib/supabase directly
│   ├── contextManager.ts   — fitToTokenBudget(), estimateTokens(); phase input budgets
│   ├── contextManager.test.ts — 13 unit tests
│   ├── researchPrompt.ts   — system prompt + user message builder for Phase 3
│   ├── draftPrompt.ts      — system prompt + user message builder for Phase 5
│   ├── revisionPrompt.ts   — system prompt + user message builder for Phase 7
│   ├── docxGenerator.ts    — markdown → DOCX (docx package); Google Maps day maps
│   ├── bookingParser.ts    — AI-assisted booking extraction (fast tier)
│   └── extractor.ts        — PDF/DOCX/HTML text extraction
├── queues/
│   ├── ingest.queue.ts         — BullMQ Queue for booking ingestion
│   └── document.queue.ts       — BullMQ Queue for async DOCX generation
├── workers/
│   ├── ingest.worker.ts        — booking ingestion pipeline
│   └── document.worker.ts      — DOCX generation + R2 upload (concurrency: 2)
├── routes/
│   ├── research.ts + research.test.ts   — Phase 3 SSE stream + GET   (18 tests)
│   ├── draft.ts    + draft.test.ts      — Phase 5 SSE stream + GET   (26 tests)
│   ├── document.ts + document.test.ts   — Phase 6 POST/job/GET/download (30 tests)
│   ├── revise.ts   + revise.test.ts     — Phase 7 SSE stream         (25 tests)
│   ├── portal.ts   + portal.test.ts     — Client portal              (15 tests)
│   ├── trips.ts    + trips.test.ts      — CRUD                        (6 tests)
│   ├── clients.ts
│   ├── bookings.ts + bookings.test.ts  — Booking CRUD               (10 tests)
│   └── unsubscribe.ts + unsubscribe.test.ts — Email opt-out          (6 tests)
└── lib/
    ├── r2.ts          — uploadToR2, downloadFromR2ToTemp, deleteFromR2,
    │                    uploadDocxToR2, downloadR2AsBuffer
    ├── encryption.ts  — AES-256-GCM encrypt/decrypt
    ├── logger.ts      — safeError, safeReqSerializer, redact
    ├── supabase.ts    — service-role client singleton (use via services/db.ts in routes)
    ├── consultant.ts  — getOrCreateConsultant
    └── redis.ts       — Upstash-compatible ioredis client
```
