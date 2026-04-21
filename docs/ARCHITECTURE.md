# TripPlanner — Architecture Reference

> Last updated: 2026-04-20  
> Build status: Sprint 2, Week 9 complete  
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
id              uuid PK
trip_id         uuid FK → trips.id
version_number  int
docx_r2_key     text
created_at      timestamptz
```

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

**`research_notes`** — not yet wired to API; reserved for Phase 3
```
id         uuid PK
trip_id    uuid FK → trips.id
content    text
created_at timestamptz
```

### Migrations (run in order in Supabase SQL editor)

| File | What it does | Status |
|---|---|---|
| `20260420000000_initial_schema.sql` | All 8 tables + RLS | ✅ Run |
| `20260420000001_encrypt_allergy_flags.sql` | Change allergy_flags to text for encrypted storage | ✅ Run |
| `20260420000002_clients_contact_fields.sql` | Add phone, address_line, city, country, postal_code to clients | ⬅ **Run this next** |

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

---

## 7. File Storage (Cloudflare R2)

R2 key format: `bookings/{tripId}/{uuid}{ext}`  
Original filename is never used in the R2 key.  
Files are downloaded to a temp path for processing, then deleted from temp after ingestion.

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
├── App.tsx             — Route definitions
├── lib/
│   ├── api.ts          — useApi() hook: attaches Clerk JWT to every fetch
│   └── queryClient.ts  — TanStack Query client config
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx  — Outer layout with sidebar + main content area
│   │   └── Sidebar.tsx   — Nav links (Dashboard, Clients, New Trip)
│   └── ui/
│       ├── LoadingSpinner.tsx
│       └── ErrorMessage.tsx
└── pages/
    ├── SignInPage.tsx     — Clerk <SignIn> component
    ├── DashboardPage.tsx  — Trip list with client filter
    ├── ClientsPage.tsx    — Client list, create/edit modal
    └── NewTripPage.tsx    — 5-step trip creation wizard
```

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
pnpm --filter @trip-planner/api test  # Vitest (4 tests)
pnpm --filter @trip-planner/api typecheck
pnpm --filter @trip-planner/web typecheck
```
