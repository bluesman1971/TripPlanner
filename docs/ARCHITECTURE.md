# TripPlanner — Architecture Reference

> Last updated: 2026-04-21  
> Build status: Sprint 3, Weeks 17–18 complete (AI Integration sprint done)  
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
R2_ACCOUNT_ID=...
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

### Document (Phase 6) — Week 15
```
POST /trips/:id/document          → { versionNumber, downloadPath }
GET  /trips/:id/document          → { versionNumber, createdAt, downloadPath } | null
GET  /trips/:id/document/download → DOCX binary (attachment)
```

POST gate: status must be `draft`, `review`, or `complete` (re-generation is allowed).  
Generates DOCX from latest `itinerary_versions.markdown_content` via `docxGenerator.ts`.  
Uploads to R2 at `itineraries/{tripId}/{uuid}.docx`. Saves `docx_r2_key` on the version row. Advances status → `review`.  
Download endpoint is an authenticated proxy — no presigned URLs, requires Clerk JWT.  
Google Maps day maps require `GOOGLE_MAPS_API_KEY` in `.env`; silently skipped if absent.

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

Queue name: `ingest`  
Worker: `apps/api/src/workers/ingest.worker.ts`  
Started in `index.ts` alongside the HTTP server.

Job flow:
1. POST /bookings/upload → upload file to R2 → insert `documents` row → enqueue job → return `{ jobId }`
2. Worker picks up job → downloads R2 file to temp → extracts text (pdf-parse / mammoth / plain-text) → calls AnthropicProvider (`fast` tier) → encrypts `raw_text` and `allergy_flags` → upserts `bookings` row → deletes temp file

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
4. **RLS on all tables.** Backend enforces additionally via explicit `consultant_id` filters.
5. **File upload whitelist.** `.pdf .docx .doc .html .htm .txt .md .jpg .jpeg .png .webp`, max 20 MB.
6. **Helmet + rate limiting.** `@fastify/helmet` security headers; `@fastify/rate-limit` 120 req/min global.
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
| pdf-parse v2 import | Use `const pdfMod = require('pdf-parse') as any; const pdfParse = typeof pdfMod === 'function' ? pdfMod : (pdfMod.default ?? pdfMod)` |
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
pnpm --filter @trip-planner/api test  # Vitest (114 tests across 6 files — all passing)
pnpm --filter @trip-planner/api typecheck
pnpm --filter @trip-planner/web typecheck
```

### API service files

```
apps/api/src/
├── services/
│   ├── contextManager.ts   — fitToTokenBudget(), estimateTokens(); phase input budgets
│   ├── contextManager.test.ts — 13 unit tests
│   ├── researchPrompt.ts   — system prompt + user message builder for Phase 3
│   ├── draftPrompt.ts      — system prompt + user message builder for Phase 5
│   ├── revisionPrompt.ts   — system prompt + user message builder for Phase 7
│   ├── docxGenerator.ts    — markdown → DOCX (docx package); Google Maps day maps
│   ├── bookingParser.ts    — AI-assisted booking extraction (fast tier)
│   └── extractor.ts        — PDF/DOCX/HTML text extraction
├── routes/
│   ├── research.ts + research.test.ts   — Phase 3 SSE stream + GET   (18 tests)
│   ├── draft.ts    + draft.test.ts      — Phase 5 SSE stream + GET   (26 tests)
│   ├── document.ts + document.test.ts   — Phase 6 POST/GET/download  (28 tests)
│   ├── revise.ts   + revise.test.ts     — Phase 7 SSE stream         (25 tests)
│   ├── trips.ts    + trips.test.ts      — CRUD                        (4 tests)
│   ├── clients.ts
│   └── bookings.ts
└── lib/
    ├── r2.ts          — uploadToR2, downloadFromR2ToTemp, deleteFromR2,
    │                    uploadDocxToR2, downloadR2AsBuffer
    ├── encryption.ts  — AES-256-GCM encrypt/decrypt
    ├── logger.ts      — safeError, safeReqSerializer, redact
    ├── supabase.ts    — service-role client singleton
    ├── consultant.ts  — getOrCreateConsultant
    └── redis.ts       — Upstash-compatible ioredis client
```
