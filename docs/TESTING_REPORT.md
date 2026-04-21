# TripPlanner — API Testing Report

> Updated: Sprint 4 (Weeks 19–20, continued) | Prepared: 2026-04-21  
> Reviewed by: Claude Code (Anthropic) on behalf of Tom Baker  
> Status: **143 tests, all passing**

---

## 1. Scope

This report covers automated API tests written and executed during Sprint 3, Weeks 13–18. It documents:

- What was tested and why each test exists
- Security-specific test cases and the threats they guard against
- Failures encountered during development, root cause, and mitigation applied
- Known gaps that the QA/security team should review manually

Tests cover three new route modules, each representing an AI pipeline phase:

| Route module | Phase | Tests |
|---|---|---|
| `research.ts` | Phase 3 — Destination research | 18 |
| `draft.ts` | Phase 5 — Itinerary draft | 26 |
| `document.ts` | Phase 6 — Document generation | 28 |
| `revise.ts` | Phase 7 — Itinerary revision | 25 |
| `portal.ts` | Client Portal — token + view + PDF | 15 |
| `trips.ts` | Core CRUD + DELETE trip | 6 |
| `bookings.ts` | Booking CRUD (delete, manual, list) | 10 |
| `contextManager.ts` | Context budget utilities | 13 |
| **Total** | | **143** |

> Route counts include new tests from Weeks 17–18 (usage logging, resume path), Weeks 19–20 (portal), and the continued Weeks 19–20 session (booking management). The contextManager unit tests are in `services/contextManager.test.ts`.

---

## 2. Framework and Methodology

**Runner:** Vitest v2.1.9  
**Test style:** Black-box HTTP integration tests using Fastify's `app.inject()` — each test fires a real HTTP request through the full middleware stack (Clerk auth, rate limiting, ownership checks) and asserts on the response.

**What is mocked:**

| Dependency | Why mocked |
|---|---|
| Clerk (`@clerk/fastify`) | No real JWT tokens in CI; `mockGetAuth` lets tests switch between authenticated and unauthenticated per-test |
| Supabase (`../lib/supabase`) | Avoids live DB; ownership-enforcing mock mirrors the DB's behaviour of returning null when `consultant_id` doesn't match |
| Anthropic AI provider (`../ai/anthropic.provider`) | Avoids real API calls; deterministic streaming output for assertion |
| DOCX generator (`../services/docxGenerator`) | Isolates route logic from document building; returns a fixed `Buffer` |
| R2 (`../lib/r2`) | Avoids real cloud storage; returns fake R2 keys and buffers |

**What is NOT mocked:**

- Fastify middleware pipeline (auth preHandler, rate limiting, CORS, Helmet)
- Route handlers themselves (full execution path)
- SSE response framing and event format

**Supabase ownership mock design:**

The Supabase mock for `trips` tracks `eq()` filter accumulation in a closure, then evaluates both `id` and `clients.consultant_id` at query execution time. This mirrors PostgreSQL RLS + inner join behaviour: a query for trip X by consultant Y returns null if X belongs to consultant Z. This is what makes the IDOR tests meaningful rather than trivially passing.

---

## 3. Authentication Tests

Every protected endpoint has a dedicated 401 test. These verify that the `requireAuth` middleware correctly rejects requests with no user session.

| Endpoint | Test | Expected |
|---|---|---|
| `POST /research/stream` | Unauthenticated | 401 `{ error: 'Unauthorized' }` |
| `GET /research` | Unauthenticated | 401 |
| `POST /draft/stream` | Unauthenticated | 401 |
| `GET /draft` | Unauthenticated | 401 |
| `POST /document` | Unauthenticated | 401 |
| `GET /document` | Unauthenticated | 401 |
| `GET /document/download` | Unauthenticated | 401 |

**Mechanism:** `mockGetAuth` returns `{ userId: undefined }` for these tests. The `requireAuth` middleware reads `getAuth(request).userId` and sends 401 if falsy.

---

## 4. IDOR (Insecure Direct Object Reference) Tests

IDOR is the highest-priority security concern for a multi-consultant SaaS: consultant A must never access consultant B's trip data.

**Threat model:** An authenticated consultant sends a request to a trip ID that they do not own (e.g., guessed by incrementing a UUID, or found via another leak channel).

**Control:** Every route fetches the trip with an `eq('clients.consultant_id', consultant.id)` filter. If the trip exists but belongs to a different consultant, the query returns null and the route returns 404 (not 403, to avoid confirming the resource exists).

**Tests per route:**

| Endpoint | Test | Expected |
|---|---|---|
| `POST /research/stream` | Trip owned by another consultant | 404 `{ error: 'Trip not found' }` |
| `POST /research/stream` | Trip ID that does not exist | 404 |
| `GET /research` | Trip owned by another consultant | 404 |
| `POST /draft/stream` | Trip owned by another consultant | 404 |
| `POST /draft/stream` | Trip ID that does not exist | 404 |
| `GET /draft` | Trip owned by another consultant | 404 |
| `POST /document` | Trip owned by another consultant | 404 |
| `POST /document` | Trip ID that does not exist | 404 |
| `GET /document` | Trip owned by another consultant | 404 |
| `GET /document/download` | Trip owned by another consultant | 404 |

**Why 404 not 403:** Returning 403 would confirm the resource exists, allowing enumeration. 404 is the correct response for both "not found" and "not yours".

---

## 5. Gate / Precondition Tests

Each AI phase has a gate condition that must be satisfied before the phase can run. These tests verify the gates reject requests with the correct status code and an explanatory message.

### Research gate

| Condition | Expected |
|---|---|
| `documents_ingested = false` | 400 with message containing "documents" |

### Draft gate

| Condition | Expected |
|---|---|
| Status = `setup` | 400 with message matching `/research/i` |
| Status = `ingestion` | 400 |
| Status = `draft` | 400 (draft already exists — must not overwrite) |
| No research notes found | 400 |

### Document gate

| Condition | Expected |
|---|---|
| Status = `setup` | 400 with message matching `/draft/i` |
| Status = `ingestion` | 400 |
| Status = `research` | 400 |
| No itinerary version found | 400 |

---

## 6. Happy-Path / Functional Tests

### Research streaming (POST /research/stream)

| Test | What it verifies |
|---|---|
| SSE `content-type` header | `text/event-stream` is set before streaming |
| Chunk events followed by `done` | SSE event sequence is correct; `done` is last |
| Text concatenation | All chunk texts join to exactly match AI output |
| Saves to `research_notes` | Side-effect: note is inserted with correct `trip_id` and `content` |
| Advances status to `research` | Trip status update is issued with `status: 'research'` |

### Research GET (GET /research)

| Test | What it verifies |
|---|---|
| Returns `null` when no note | Correct null response when table is empty |
| Returns saved note | Content field matches what was inserted |

### Draft streaming (POST /draft/stream)

| Test | What it verifies |
|---|---|
| SSE content-type header | `text/event-stream` |
| Chunk + done events | Correct event sequence; `done` carries `versionNumber` |
| Text concatenation | Assembled content matches AI output |
| Saves to `itinerary_versions` | Version row inserted with correct `trip_id`, `markdown_content` |
| Version numbering — first run | `versionNumber = 1` when no prior versions |
| Version numbering — second run | `versionNumber = 2` when v1 exists |
| No overwrite | Second run inserts a new row; does not update existing |
| Advances status to `draft` | Status update issued |

### Draft GET (GET /draft)

| Test | What it verifies |
|---|---|
| Returns `null` when none | Correct null response |
| Returns draft content | `markdown_content` matches inserted row |

### Document generation (POST /document)

| Test | What it verifies |
|---|---|
| Calls `generateDocx` with markdown | Correct markdown content passed to generator |
| Uploads buffer to R2 | `uploadDocxToR2` called once with correct `tripId` |
| Saves `docx_r2_key` to version row | Correct version ID updated with R2 key |
| Advances status to `review` | Status update issued |
| Returns `versionNumber` + `downloadPath` | Response shape is correct |
| Works at `review` status | Re-generation is allowed |
| Works at `complete` status | Re-generation is allowed |

### Document GET (GET /document)

| Test | What it verifies |
|---|---|
| Returns `null` when none | No docx_r2_key in DB |
| Returns metadata when generated | `versionNumber` + `downloadPath` correct |

### Document download (GET /document/download)

| Test | What it verifies |
|---|---|
| Correct `Content-Type` | DOCX MIME type |
| `Content-Disposition` includes version | Filename is `itinerary-v{N}.docx` |
| Returns R2 buffer | Buffer bytes match mock; `downloadR2AsBuffer` called with correct key |

---

## 7. AI Provider Failure Tests

These tests verify that failures in the AI provider or downstream services are handled gracefully: the client receives a generic error message, internal details are never leaked, and side-effects (DB writes, status changes) are not applied to partial results.

### Research failure

| Scenario | Expected |
|---|---|
| AI provider throws mid-stream | SSE `error` event emitted |
| Error message | Generic string; must NOT contain the raw exception message (`API quota exceeded`) |
| Research note | NOT saved when AI throws |

### Draft failure

| Scenario | Expected |
|---|---|
| AI provider throws | SSE `error` event emitted |
| Error message | Generic; no internal detail |
| Itinerary version | NOT saved |
| Trip status | NOT advanced to `draft` |

### Document failure

| Scenario | Expected |
|---|---|
| `generateDocx` throws | HTTP 500 |
| Error response | Generic; no internal detail (`Out of memory` not present) |
| Trip status | NOT advanced to `review` |
| R2 upload throws | HTTP 500; `docx_r2_key` NOT saved to version row |
| R2 download throws (GET /download) | HTTP 500; generic message; no internal detail |

**Principle:** The error surface exposed to the client is a fixed generic string per route. Stack traces, exception messages, and system details never reach the HTTP response. This is enforced both in the route `catch` blocks and verified by assertions on the response body.

---

## 8. Test Failures During Development

Three failures were encountered and resolved during this sprint. All are documented here for the QA team.

---

### Failure 1 — TypeScript compilation errors in `research.test.ts`

**When:** Before first test run of Week 13.

**Symptoms:** TypeScript reported errors on mock function signatures:
- Spread operator on `vi.fn()` arguments incompatible with expected type
- `{ userId: null }` not assignable to `{ userId: string | undefined }`

**Root cause:** Initial mock signatures used rest-parameter spread (`...args: unknown[]`) which TypeScript couldn't unify with the Clerk type. The `null` type was used for "unauthenticated" but Clerk's type declares `string | undefined`.

**Fix:** Changed all mock wrappers to explicit single-parameter form `(req: unknown) => mockGetAuth(req)`. Changed unauthenticated mock value from `null` to `undefined`. Added explicit return type annotation `{ userId: string | undefined }` to `mockGetAuth`.

**Impact:** Compile-time only; no runtime behaviour changed.

---

### Failure 2 — Case mismatch on gate error message (`draft.test.ts`)

**When:** First test run of Week 14, 1 test failed.

**Test:** `POST /draft/stream returns 400 when status is setup (research not done)`

**Assertion:** `expect(res.json().error).toContain('research')` (lowercase)

**Actual message:** `"Cannot generate draft: trip status is 'setup'. Research must be complete first."` (capital R)

**Root cause:** The error message uses sentence case ("Research must be complete first") but the test asserted lowercase "research".

**Fix:** Changed assertion from `.toContain('research')` to `.toMatch(/research/i)` (case-insensitive regex). The route message was not changed — sentence case is correct for a user-facing error string.

**Impact:** Test assertion only; no route logic changed.

---

### Failure 3 — Spy call count not reset between tests (`document.test.ts`)

**When:** First test run of Week 15, 1 test failed.

**Test:** `POST /document uploads the DOCX to R2`

**Assertion:** `expect(mockUploadDocxToR2).toHaveBeenCalledOnce()`

**Actual:** Called twice — once from the preceding test (`calls generateDocx with the markdown content`) and once from this test.

**Root cause:** `vi.mock()` creates module-level mock functions. Call history accumulates across tests unless explicitly cleared. The `beforeEach` block called `.mockResolvedValue()` to set return values, but that does not reset the call count.

**Fix:** Added `vi.clearAllMocks()` at the top of `beforeEach`. This resets call counts and instances for all mocks before each test. Mock return values are then re-assigned after the clear, so they are always fresh.

**Impact:** Test isolation only; no route logic changed.

**Note for QA:** `vi.clearAllMocks()` is now in `beforeEach` across all five route test files. Any new test file that uses `vi.fn()` and asserts on call counts must include this — omitting it causes counts to accumulate across the suite.

---

## 9. Known Gaps and Issues for QA Review

### ~~CRITICAL~~ RESOLVED — research_notes column name mismatch

**File:** `apps/api/src/routes/research.ts`  
**Issue (original):** The route inserted/selected using column name `content`, but the initial schema migration defined it as `content_markdown`.

**Resolution:** Migration `20260420000003_research_notes_rename_column.sql` — renames `content_markdown` → `content` in `research_notes`. **Migration confirmed run.**

---

### Google Maps SSRF surface

**File:** `apps/api/src/services/docxGenerator.ts`, `fetchMapImage()`  
**Design:** Addresses from the markdown are embedded into a Google Maps Static API URL. The hostname is locked to `maps.googleapis.com` in the code and verified with `new URL(rawUrl).hostname` before the `https.get()` call.  
**Gap to verify:** Ensure the addresses themselves (extracted from `**Meeting point:**` lines in AI-generated markdown) cannot contain URL-injection sequences (e.g., `@`, newlines). The current implementation uses string concatenation + space→`+` substitution; it does not percent-encode the full address.  
**Recommendation:** Add a strict address sanitiser that strips any character outside `[A-Za-z0-9 ,.-]` before embedding in the URL.

---

### No rate limiting on AI streaming endpoints

**Issue:** The global `@fastify/rate-limit` is set at 120 req/min per IP. The AI streaming endpoints (`/research/stream`, `/draft/stream`) each trigger a full Anthropic API call that can cost thousands of tokens. A single user could trigger 120 AI calls per minute before being rate-limited.  
**Recommendation:** Add a tighter per-route rate limit on these three endpoints (e.g., 5 req/min per user).

---

### Document generation is synchronous

**Issue:** `POST /trips/:id/document` runs DOCX generation + R2 upload synchronously in the request handler. For a long itinerary with Google Maps fetches (up to 8 seconds per image × N days), this could approach the 30-second timeout on many reverse proxies.  
**Recommendation:** Either move to async job queue (BullMQ, consistent with the booking ingestion pattern) or add a request timeout with a clear error.

---

### SSE endpoints have no heartbeat

**Issue:** The research and draft streaming endpoints do not emit periodic keep-alive events. If AI generation is slow to produce the first chunk, proxies or load balancers with short idle timeouts may drop the connection.  
**Recommendation:** Emit a `{ type: 'ping' }` event every 15 seconds until the first chunk arrives.

---

### No input validation on POST /document

**Issue:** `POST /trips/:id/document` accepts the request body without a schema. There is no body expected (the trip ID comes from the URL), but Fastify will still parse any body sent without rejecting unknown fields.  
**Recommendation:** Add an empty body schema (`body: { type: 'object', additionalProperties: false }`) to explicitly reject unexpected body content.

---

### Mock test coverage vs. real DB behaviour

**Issue:** All Supabase interactions are mocked. The mock enforces ownership logic (IDOR protection) by replicating the expected query filter behaviour, but it does not test:
- RLS policies on the real database
- Transaction isolation (e.g., concurrent document generation for the same trip)
- Supabase client error codes and retry behaviour

**Recommendation:** Add a staging environment integration test suite that runs against a real (non-production) Supabase project. These tests should be marked `@integration` and excluded from the standard CI run.

---

## 10. Weeks 17–18 New Tests

### Context manager unit tests (`contextManager.test.ts`)

| Test | What it verifies |
|---|---|
| `estimateTokens` — empty string | Returns 0 |
| `estimateTokens` — 4-char string | Returns 1 (1 token) |
| `estimateTokens` — rounds up | ceil(3/4) = 1, ceil(5/4) = 2 |
| `estimateTokens` — scales linearly | 400 chars = 100 tokens |
| `fitToTokenBudget` — under budget | Returns content unchanged, truncated=false |
| `fitToTokenBudget` — exactly at boundary | truncated=false |
| `fitToTokenBudget` — over budget | Leading chars preserved, truncated=true |
| `fitToTokenBudget` — truncation flag | true when over budget |
| `fitToTokenBudget` — appends notice | Truncation notice present when truncated |
| `fitToTokenBudget` — no notice when fits | No notice when content fits |
| `fitToTokenBudget` — empty at 0-token budget | Empty string unchanged |
| `CONTEXT_BUDGETS.draft.researchNotes` | Number > 0 |
| `CONTEXT_BUDGETS.revision.currentItinerary` | Number > 0 |

### AI usage logging tests

| Endpoint | Test |
|---|---|
| `POST /research/stream` | Saves `input_tokens` and `output_tokens` from AI provider |
| `POST /draft/stream` | Saves `input_tokens` and `output_tokens` from AI provider |
| `POST /revise/stream` | Saves `input_tokens` and `output_tokens` from AI provider |

### Resume path tests

| Endpoint | Test |
|---|---|
| `POST /research/stream?resumeFrom=N` | Replays saved note from offset N; emits `done` |
| `POST /research/stream?resumeFrom=N` | Falls through to fresh AI generation when no saved note |
| `POST /draft/stream?resumeFrom=N` | Replays saved version from offset N; AI not called |
| `POST /revise/stream?resumeFrom=N` | Replays latest saved version from offset N; AI not called |

**Failure during development (Weeks 17–18):**

*Mock call-count isolation* — `expect(mockStreamFn).not.toHaveBeenCalled()` failed in the draft resume test (14 calls) and `expect(mockStreamFn).toHaveBeenCalledOnce()` failed in the research fallthrough test (9 calls). Root cause: `research.test.ts` and `draft.test.ts` lacked `vi.clearAllMocks()` in `beforeEach` — call counts accumulated across the test suite. Fix: added `vi.clearAllMocks()` at the top of `beforeEach` in both files, matching the pattern already established in `document.test.ts` and `revise.test.ts`.

---

## 11. Test File Locations

| File | Route | Tests |
|---|---|---|
| `apps/api/src/routes/trips.test.ts` | Trips CRUD | 4 |
| `apps/api/src/routes/research.test.ts` | Research phase | 18 |
| `apps/api/src/routes/draft.test.ts` | Draft phase | 26 |
| `apps/api/src/routes/document.test.ts` | Document generation | 28 |
| `apps/api/src/routes/revise.test.ts` | Revision phase | 25 |
| `apps/api/src/routes/portal.test.ts` | Client portal | 15 |
| `apps/api/src/services/contextManager.test.ts` | Context manager utilities | 13 |

Run all: `pnpm --filter @trip-planner/api test`

---

## 12. Weeks 19–20 New Tests (Client Portal)

### Portal route tests (`portal.test.ts`)

| Test | What it verifies |
|---|---|
| `POST /trips/:id/portal/token` — 401 unauthenticated | Clerk auth required to create tokens |
| `POST` — 404 for another consultant's trip | IDOR: ownership check prevents cross-tenant token creation |
| `POST` — 404 for non-existent trip | Non-existent trip returns 404 |
| `POST` — 201 with token and portalUrl | Token returned; portalUrl contains the token |
| `POST` — inserts token with correct trip_id | DB side-effect verified |
| `GET /portal/:token` — 404 for unknown token | Invalid token → 404 (not 403, to avoid enumeration) |
| `GET /portal/:token` — 404 for revoked token | Revoked token → 404 |
| `GET /portal/:token` — 404 for expired token | `expires_at` in the past → 404 |
| `GET /portal/:token` — 200 with trip + itinerary | Full response shape verified |
| `GET /portal/:token` — 404 when no itinerary exists | Trip with no versions returns 404 |
| `GET /portal/:token/pdf` — 200 with correct content-type | `application/pdf` |
| `GET /portal/:token/pdf` — attachment content-disposition | Filename includes `.pdf` |
| `GET /portal/:token/pdf` — calls generatePdf with markdown | Correct content passed to generator |
| `GET /portal/:token/pdf` — 500 on generator failure | Generic message; internal error not leaked |
| `GET /portal/:token/pdf` — 404 for unknown token | Token validated before PDF generation |

**Mock design:** `generatePdf` is mocked (returns `Buffer.from('%PDF-mock-content')`) — isolates the route from puppeteer. The Supabase mock handles `portal_tokens` table lookups with revocation and expiry logic. `vi.clearAllMocks()` in `beforeEach` per established pattern.

**Security note on token enumeration:** All invalid token states (unknown, revoked, expired) return 404. Returning 403 for revoked/expired would confirm that the token once existed — information that should not be disclosed.

---

## 13. Weeks 19–20 (continued) New Tests (Booking Management)

### Trips route tests — DELETE trip (`trips.test.ts`, 2 new tests)

| Test | What it verifies |
|---|---|
| `DELETE /trips/:id` — 404 when trip belongs to another consultant (IDOR) | Ownership check prevents cross-tenant deletion |
| `DELETE /trips/:id` — 204, trip deleted | Trip row removed; `deletedTripIds` side-effect verified |

### Bookings route tests (`bookings.test.ts`, 10 tests — new file)

| Test | What it verifies |
|---|---|
| `DELETE /trips/:tripId/bookings/:bookingId` — 401 unauthenticated | Clerk auth required |
| `DELETE` — 404 when trip belongs to another consultant (IDOR) | Ownership check on trip before touching bookings |
| `DELETE` — 404 when booking does not exist | Booking not found in this trip |
| `DELETE` — 204, booking deleted | Booking row removed; R2 cleanup attempted |
| `POST /trips/:tripId/bookings/manual` — 401 unauthenticated | Clerk auth required |
| `POST` — 404 when trip belongs to another consultant (IDOR) | Ownership check |
| `POST` — 400 when booking_slug is missing | Required field validation |
| `POST` — 400 when booking_type is invalid | Enum validation (7 allowed types) |
| `POST` — 201 with new booking record | Happy path; `insertedBookings` side-effect verified |
| `GET /trips/:tripId/bookings` — 401, 404 (IDOR), 200 | Auth + ownership + list |

**Mock design:** Separate `bookings.test.ts` with full in-memory mock for `bookings`, `documents`, `trips`, and `consultants` tables. R2 mocked (`deleteFromR2` → no-op). Encryption mocked (identity transforms with `enc:` prefix). `vi.clearAllMocks()` in `beforeEach`.

---

## 14. Live Debug Session — Bugs Found in Manual Testing

No new automated tests added in this session (bugs were in frontend logic and prompt content, not API route logic). All 143 tests continue to pass.

| Bug | Root cause | Fix |
|---|---|---|
| Research stream → 400 Bad Request | `apiStream` always set `Content-Type: application/json` even when no body sent; Fastify v5 rejects empty JSON body (`FST_ERR_CTP_EMPTY_JSON_BODY`) | Made `Content-Type` conditional on `options.body` being present in both `apiFetch` and `apiStream` |
| Manual booking insert → 500 (`PGRST204`) | Insert included `meeting_point` field which does not exist in the `bookings` schema (only `meeting_point_address` exists) | Removed `meeting_point` from the insert payload in `bookings.ts` |
| Document generation → 400 Bad Request | Same empty-body `Content-Type` issue — `apiFetch({ method: 'POST' })` with no body | Same fix as research stream (same root cause, same code path) |
| Research gate → always 400 after adding manual bookings | `isFirstUpload` checked `trip.bookings.length === 0` — manual bookings set length > 0 so `documentsIngested: true` PATCH never fired | Changed condition to `!trip.documents_ingested` only |

**Pattern:** Fastify v5 is stricter than v4 about `Content-Type: application/json` with empty bodies. Any future bodyless POST must not set this header. The fix is in `apps/web/src/lib/api.ts` — applies globally to all `apiFetch` and `apiStream` calls.

---

## 15. Summary

| Category | Count | Pass |
|---|---|---|
| Auth (401) tests | 11 | ✅ 11/11 |
| IDOR prevention tests | 16 | ✅ 16/16 |
| Token validation tests (portal) | 3 | ✅ 3/3 |
| Gate / precondition tests | 10 | ✅ 10/10 |
| Happy-path functional tests | 33 | ✅ 33/33 |
| AI provider / PDF failure tests | 11 | ✅ 11/11 |
| Usage logging tests | 3 | ✅ 3/3 |
| Resume path tests | 3 | ✅ 3/3 |
| Context manager unit tests | 13 | ✅ 13/13 |
| Other (headers, content-type, versioning, side-effects, validation) | 40 | ✅ 40/40 |
| **Total** | **143** | **✅ 143/143** |

Failures during development: **6 total** — all resolved before merge. 3 from Weeks 13–16 (documented in section 8); 3 from Weeks 17–18 (mock call-count isolation). Weeks 19–20 (portal): zero failures on first run. Weeks 19–20 (booking management): zero failures on first run.  
Critical production bug found: **1** — `research_notes` column name mismatch (section 9, first item). Resolved.
