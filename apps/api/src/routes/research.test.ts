import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app';

// ─── Mock Clerk ───────────────────────────────────────────────────────────────
// getAuth is a vi.fn so individual tests can override userId (e.g. unauthenticated)
const mockGetAuth = vi.fn((_req?: unknown): { userId: string | undefined } => ({ userId: 'user_test_consultant' }));

vi.mock('@clerk/fastify', () => ({
  clerkPlugin: async () => {},
  getAuth: (req: unknown) => mockGetAuth(req),
  createClerkClient: () => ({
    users: {
      getUser: async () => ({
        firstName: 'Tom',
        lastName: 'Baker',
        emailAddresses: [{ emailAddress: 'tdbaker@gmail.com' }],
      }),
    },
  }),
}));

// ─── Mock AI provider ─────────────────────────────────────────────────────────
// Default: yields two chunks and finishes cleanly.
const mockStreamFn = vi.fn(async function* (_p?: unknown, _o?: unknown) {
  yield { text: '# Research: Barcelona\n' };
  yield { text: 'Some content here.\n' };
});

const mockGetUsageFn = vi.fn(async () => ({
  inputTokens: 150,
  outputTokens: 300,
  model: 'claude-sonnet-4-6',
}));

vi.mock('../ai/anthropic.provider', () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({
    streamWithUsage: (p: unknown, o: unknown) => {
      const gen = mockStreamFn(p, o);
      return Object.assign(gen, { getUsage: mockGetUsageFn });
    },
    complete: vi.fn(),
  })),
}));

// ─── In-memory DB ─────────────────────────────────────────────────────────────
const CONSULTANT_ID       = 'a0000000-0000-0000-0000-000000000001';
const OTHER_CONSULTANT_ID = 'a0000000-0000-0000-0000-000000000099';
const TRIP_ID             = 'a0000000-0000-0000-0000-000000000003';

type TripRow = {
  id: string;
  destination: string;
  destination_country: string;
  departure_city: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  purpose: string;
  purpose_notes: string;
  status: string;
  documents_ingested: boolean;
  clients: { consultant_id: string };
};

type ResearchNote = {
  id: string;
  trip_id: string;
  content: string;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

// Mutable state reset before each test
let mockTrip: TripRow;
let mockResearchNotes: ResearchNote[];
let tripStatusUpdates: Array<Record<string, unknown>>;

// Canonical brief used across tests
const MOCK_BRIEF_JSON = {
  traveler_profile: {
    travelers: [{ role: 'primary', age_group: '40s', notes: '' }],
    daily_walking: 'medium',
    activity_level: 'moderate',
    physical_limitations: '',
    interests: ['architecture', 'food-wine'],
    dietary_restrictions: ['shellfish'],
    dining_style: 'mixed',
    budget_tier: 'upscale',
    itinerary_pace: 'balanced',
  },
  discovery: {
    destination_visits: 0,
    previously_seen: [],
    ratio_classic_pct: 50,
    ratio_hidden_pct: 50,
    ratio_label: 'balanced',
    must_sees: ['Casa Batlló exterior'],
    already_done: [],
    notes: 'First visit.',
  },
};

// ─── Supabase mock ────────────────────────────────────────────────────────────
// The trips query builder tracks eq() filters so it can enforce ownership.
// This is what actually prevents IDOR — the mock mirrors the DB's behaviour
// of returning nothing when consultant_id doesn't match.
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {

      // ── consultants ────────────────────────────────────────────────────────
      if (table === 'consultants') {
        const consultant = { id: CONSULTANT_ID, name: 'Tom Baker', email: 'tdbaker@gmail.com', auth_user_id: 'user_test_consultant' };
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: consultant, error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: consultant, error: null }),
            }),
          }),
        };
      }

      // ── trips ──────────────────────────────────────────────────────────────
      if (table === 'trips') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              },
              single: async () => {
                // Enforce ownership: both the trip ID and the consultant ID
                // must match the mock row. Anything else returns null — same
                // behaviour as the real DB's RLS + inner join filter.
                const tripMatches = filters['id'] === mockTrip?.id;
                const ownerMatches =
                  filters['clients.consultant_id'] === mockTrip?.clients.consultant_id;
                if (tripMatches && ownerMatches) {
                  return { data: mockTrip, error: null };
                }
                return { data: null, error: null };
              },
            };
            return builder;
          },
          update: (data: Record<string, unknown>) => {
            tripStatusUpdates.push(data);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }

      // ── trip_brief ─────────────────────────────────────────────────────────
      if (table === 'trip_brief') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  single: async () => ({
                    data: { brief_json: MOCK_BRIEF_JSON, version: 1 },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      // ── bookings ───────────────────────────────────────────────────────────
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }

      // ── research_notes ─────────────────────────────────────────────────────
      if (table === 'research_notes') {
        return {
          insert: (row: Record<string, unknown>) => {
            mockResearchNotes.push({
              id: `note-${Date.now()}`,
              trip_id: row.trip_id as string,
              content: row.content as string,
              input_tokens: (row.input_tokens as number) ?? null,
              output_tokens: (row.output_tokens as number) ?? null,
              created_at: new Date().toISOString(),
            });
            return Promise.resolve({ data: null, error: null });
          },
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              },
              order: () => builder,
              limit: () => ({
                single: async () => {
                  const note = mockResearchNotes.find(
                    (n) => n.trip_id === filters['trip_id'],
                  );
                  return { data: note ?? null, error: null };
                },
              }),
            };
            return builder;
          },
        };
      }

      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      };
    },
  }),
}));

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function parseSSEBody(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice(6)));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('research routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset all mutable state
    mockTrip = {
      id: TRIP_ID,
      destination: 'Barcelona, Spain',
      destination_country: 'Spain',
      departure_city: 'London',
      start_date: '2026-04-24',
      end_date: '2026-04-26',
      duration_days: 3,
      purpose: 'anniversary',
      purpose_notes: 'Wedding anniversary.',
      status: 'ingestion',
      documents_ingested: true,
      clients: { consultant_id: CONSULTANT_ID },
    };

    mockResearchNotes = [];
    tripStatusUpdates = [];

    // Reset mocks
    mockGetAuth.mockReturnValue({ userId: 'user_test_consultant' });
    mockStreamFn.mockImplementation(async function* () {
      yield { text: '# Research: Barcelona\n' };
      yield { text: 'Some content here.\n' };
    });
    mockGetUsageFn.mockResolvedValue({
      inputTokens: 150,
      outputTokens: 300,
      model: 'claude-sonnet-4-6',
    });

    app = await buildApp();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('POST /research/stream returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  it('GET /research returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/research`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  // ── IDOR prevention ────────────────────────────────────────────────────────
  // A consultant must NOT be able to access another consultant's trip.
  // These tests verify the ownership check works correctly.

  it('POST /research/stream returns 404 when trip belongs to a different consultant', async () => {
    // Trip is owned by OTHER_CONSULTANT_ID — current user is CONSULTANT_ID
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('GET /research returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/research`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('POST /research/stream returns 404 for a trip ID that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trips/00000000-0000-0000-0000-000000000000/research/stream',
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Gate check ─────────────────────────────────────────────────────────────

  it('POST /research/stream returns 400 when documents_ingested is false', async () => {
    mockTrip.documents_ingested = false;

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('documents') });
  });

  // ── Happy path — SSE stream ────────────────────────────────────────────────

  it('POST /research/stream returns SSE content-type header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('POST /research/stream emits chunk events followed by done', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    const events = parseSSEBody(res.body);

    const chunks = events.filter((e) => e.type === 'chunk');
    const done   = events.filter((e) => e.type === 'done');

    expect(chunks.length).toBeGreaterThan(0);
    expect(done.length).toBe(1);
    // done must be the last event
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('POST /research/stream chunk text concatenates to the full AI output', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    const events = parseSSEBody(res.body);
    const assembled = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.text as string)
      .join('');

    expect(assembled).toBe('# Research: Barcelona\nSome content here.\n');
  });

  // ── Side-effects after streaming ───────────────────────────────────────────

  it('POST /research/stream saves the full content to research_notes', async () => {
    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(mockResearchNotes).toHaveLength(1);
    expect(mockResearchNotes[0].trip_id).toBe(TRIP_ID);
    expect(mockResearchNotes[0].content).toBe('# Research: Barcelona\nSome content here.\n');
  });

  it('POST /research/stream advances trip status to research', async () => {
    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(tripStatusUpdates.some((u) => u.status === 'research')).toBe(true);
  });

  // ── AI provider failure ────────────────────────────────────────────────────

  it('POST /research/stream emits an error event when the AI provider throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      yield { text: 'Partial output\n' };
      throw new Error('API quota exceeded');
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    const events = parseSSEBody(res.body);
    const errorEvent = events.find((e) => e.type === 'error');

    expect(errorEvent).toBeDefined();
    expect(typeof errorEvent!.message).toBe('string');
    // Must not leak internal error details to the client
    expect(errorEvent!.message).not.toContain('API quota');
  });

  it('POST /research/stream does not save a research note when the AI provider throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      throw new Error('API quota exceeded');
    });

    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(mockResearchNotes).toHaveLength(0);
  });

  // ── GET /research ──────────────────────────────────────────────────────────

  it('GET /research returns null when no research note exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/research`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('GET /research returns the saved research note', async () => {
    mockResearchNotes.push({
      id: 'note-1',
      trip_id: TRIP_ID,
      content: '# Research: Barcelona\nSome content.',
      input_tokens: null,
      output_tokens: null,
      created_at: '2026-04-21T00:00:00Z',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/research`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { content: string };
    expect(body.content).toBe('# Research: Barcelona\nSome content.');
  });

  // ── AI usage logging ───────────────────────────────────────────────────────

  it('POST /research/stream saves input_tokens and output_tokens from the AI provider', async () => {
    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream`,
    });

    expect(mockResearchNotes).toHaveLength(1);
    expect(mockResearchNotes[0].input_tokens).toBe(150);
    expect(mockResearchNotes[0].output_tokens).toBe(300);
  });

  // ── Resume path ────────────────────────────────────────────────────────────

  it('POST /research/stream?resumeFrom=N replays saved note from that offset', async () => {
    const savedContent = '# Research: Barcelona\nSome content here.\n';
    mockResearchNotes.push({
      id: 'note-1',
      trip_id: TRIP_ID,
      content: savedContent,
      input_tokens: 150,
      output_tokens: 300,
      created_at: '2026-04-21T00:00:00Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream?resumeFrom=22`,
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSSEBody(res.body);
    const assembled = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.text as string)
      .join('');
    // Only the tail starting at offset 22 should be returned
    expect(assembled).toBe(savedContent.slice(22));
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('POST /research/stream?resumeFrom=N falls through to fresh generation when no saved note exists', async () => {
    // No saved notes — should run AI and return full content
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/research/stream?resumeFrom=50`,
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSSEBody(res.body);
    const assembled = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.text as string)
      .join('');
    expect(assembled).toBe('# Research: Barcelona\nSome content here.\n');
    // AI should still have been called
    expect(mockStreamFn).toHaveBeenCalledOnce();
  });
});
