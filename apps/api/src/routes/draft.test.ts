import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app';

// ─── Mock Clerk ───────────────────────────────────────────────────────────────
const mockGetAuth = vi.fn((_req?: unknown): { userId: string | undefined } => ({
  userId: 'user_test_consultant',
}));

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
const mockStreamFn = vi.fn(async function* (_p?: unknown, _o?: unknown) {
  yield { text: '# Barcelona — Tom\n' };
  yield { text: '**April 24–26, 2026**\n' };
  yield { text: '\n## Day 1\nGreat day.\n' };
});

const mockGetUsageFn = vi.fn(async () => ({
  inputTokens: 500,
  outputTokens: 2000,
  model: 'claude-opus-4-6',
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

const FULL_DRAFT_CONTENT = '# Barcelona — Tom\n**April 24–26, 2026**\n\n## Day 1\nGreat day.\n';

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
  clients: { consultant_id: string };
};

type ItineraryVersion = {
  id: string;
  trip_id: string;
  version_number: number;
  markdown_content: string;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

let mockTrip: TripRow;
let mockItineraryVersions: ItineraryVersion[];
let tripStatusUpdates: Array<Record<string, unknown>>;

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
};

const MOCK_RESEARCH_CONTENT = '# Research: Barcelona\nVerified venues here.';

// ─── Supabase mock ────────────────────────────────────────────────────────────
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {

      // ── consultants ────────────────────────────────────────────────────────
      if (table === 'consultants') {
        const row = { id: CONSULTANT_ID, name: 'Tom Baker', email: 'tdbaker@gmail.com', auth_user_id: 'user_test_consultant' };
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: row, error: null }) }) }),
        };
      }

      // ── trips ──────────────────────────────────────────────────────────────
      if (table === 'trips') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
              single: async () => {
                const tripMatches   = filters['id'] === mockTrip?.id;
                const ownerMatches  = filters['clients.consultant_id'] === mockTrip?.clients.consultant_id;
                if (tripMatches && ownerMatches) return { data: mockTrip, error: null };
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
          select: () => {
            const builder = {
              eq: () => builder,
              order: () => builder,
              limit: () => ({
                single: async () => ({
                  data: { content: MOCK_RESEARCH_CONTENT },
                  error: null,
                }),
              }),
            };
            return builder;
          },
        };
      }

      // ── itinerary_versions ─────────────────────────────────────────────────
      if (table === 'itinerary_versions') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
              order: () => builder,
              limit: () => ({
                single: async () => {
                  const versions = mockItineraryVersions.filter(
                    (v) => v.trip_id === filters['trip_id'],
                  );
                  if (!versions.length) return { data: null, error: null };
                  const latest = versions.reduce((a, b) =>
                    a.version_number > b.version_number ? a : b,
                  );
                  return { data: latest, error: null };
                },
              }),
            };
            return builder;
          },
          insert: (row: Record<string, unknown>) => {
            mockItineraryVersions.push({
              id: `ver-${Date.now()}`,
              trip_id: row.trip_id as string,
              version_number: row.version_number as number,
              markdown_content: row.markdown_content as string,
              input_tokens: (row.input_tokens as number) ?? null,
              output_tokens: (row.output_tokens as number) ?? null,
              created_at: new Date().toISOString(),
            });
            return Promise.resolve({ data: null, error: null });
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

describe('draft routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();

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
      status: 'research',
      clients: { consultant_id: CONSULTANT_ID },
    };

    mockItineraryVersions = [];
    tripStatusUpdates = [];

    mockGetAuth.mockReturnValue({ userId: 'user_test_consultant' });
    mockStreamFn.mockImplementation(async function* () {
      yield { text: '# Barcelona — Tom\n' };
      yield { text: '**April 24–26, 2026**\n' };
      yield { text: '\n## Day 1\nGreat day.\n' };
    });
    mockGetUsageFn.mockResolvedValue({
      inputTokens: 500,
      outputTokens: 2000,
      model: 'claude-opus-4-6',
    });

    app = await buildApp();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('POST /draft/stream returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  it('GET /draft returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/draft` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  // ── IDOR prevention ────────────────────────────────────────────────────────

  it('POST /draft/stream returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('GET /draft returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/draft` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('POST /draft/stream returns 404 for a non-existent trip ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trips/00000000-0000-0000-0000-000000000000/draft/stream',
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Gate check ─────────────────────────────────────────────────────────────

  it('POST /draft/stream returns 400 when status is setup (research not done)', async () => {
    mockTrip.status = 'setup';
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/research/i);
  });

  it('POST /draft/stream returns 400 when status is ingestion', async () => {
    mockTrip.status = 'ingestion';
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(res.statusCode).toBe(400);
  });

  it('POST /draft/stream returns 400 when status is already draft (cannot regenerate without explicit re-trigger)', async () => {
    mockTrip.status = 'draft';
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(res.statusCode).toBe(400);
  });

  // ── SSE stream ─────────────────────────────────────────────────────────────

  it('POST /draft/stream returns SSE content-type header', async () => {
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('POST /draft/stream emits chunk events followed by a done event', async () => {
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    const events = parseSSEBody(res.body);

    const chunks = events.filter((e) => e.type === 'chunk');
    const done   = events.find((e) => e.type === 'done');

    expect(chunks.length).toBeGreaterThan(0);
    expect(done).toBeDefined();
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('POST /draft/stream done event includes the version number', async () => {
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    const events = parseSSEBody(res.body);
    const done = events.find((e) => e.type === 'done');

    expect(done).toMatchObject({ type: 'done', versionNumber: 1 });
  });

  it('POST /draft/stream chunks reassemble to the full AI output', async () => {
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    const events = parseSSEBody(res.body);
    const assembled = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.text as string)
      .join('');

    expect(assembled).toBe(FULL_DRAFT_CONTENT);
  });

  // ── Side-effects ───────────────────────────────────────────────────────────

  it('POST /draft/stream saves the full markdown to itinerary_versions', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });

    expect(mockItineraryVersions).toHaveLength(1);
    expect(mockItineraryVersions[0].trip_id).toBe(TRIP_ID);
    expect(mockItineraryVersions[0].markdown_content).toBe(FULL_DRAFT_CONTENT);
  });

  it('POST /draft/stream saves as version 1 when no prior versions exist', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(mockItineraryVersions[0].version_number).toBe(1);
  });

  it('POST /draft/stream saves as version 2 when version 1 already exists', async () => {
    // Seed an existing version
    mockItineraryVersions.push({
      id: 'ver-existing',
      trip_id: TRIP_ID,
      version_number: 1,
      markdown_content: '# Old draft',
      input_tokens: null,
      output_tokens: null,
      created_at: '2026-04-20T00:00:00Z',
    });

    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });

    // Two versions now: original v1 + new v2
    expect(mockItineraryVersions).toHaveLength(2);
    const newVersion = mockItineraryVersions.find((v) => v.version_number === 2);
    expect(newVersion).toBeDefined();
    expect(newVersion!.markdown_content).toBe(FULL_DRAFT_CONTENT);
  });

  it('POST /draft/stream does NOT overwrite the existing version', async () => {
    const originalContent = '# Original draft — must not be overwritten';
    mockItineraryVersions.push({
      id: 'ver-v1',
      trip_id: TRIP_ID,
      version_number: 1,
      markdown_content: originalContent,
      input_tokens: null,
      output_tokens: null,
      created_at: '2026-04-20T00:00:00Z',
    });

    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });

    const v1 = mockItineraryVersions.find((v) => v.version_number === 1);
    expect(v1!.markdown_content).toBe(originalContent);
  });

  it('POST /draft/stream advances trip status to draft', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(tripStatusUpdates.some((u) => u.status === 'draft')).toBe(true);
  });

  // ── AI provider failure ────────────────────────────────────────────────────

  it('POST /draft/stream emits an error event when the AI provider throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      yield { text: 'Partial draft\n' };
      throw new Error('Context window exceeded');
    });

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    const events = parseSSEBody(res.body);
    const errorEvent = events.find((e) => e.type === 'error');

    expect(errorEvent).toBeDefined();
    expect(typeof errorEvent!.message).toBe('string');
    // Internal error detail must not be exposed to the client
    expect(errorEvent!.message).not.toContain('Context window');
  });

  it('POST /draft/stream does not save a version when the AI provider throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      throw new Error('Context window exceeded');
    });

    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(mockItineraryVersions).toHaveLength(0);
  });

  it('POST /draft/stream does not advance status when the AI provider throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      throw new Error('Context window exceeded');
    });

    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });
    expect(tripStatusUpdates.some((u) => u.status === 'draft')).toBe(false);
  });

  // ── GET /draft ─────────────────────────────────────────────────────────────

  it('GET /draft returns null when no draft exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/draft` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('GET /draft returns the latest version when a draft exists', async () => {
    mockItineraryVersions.push(
      { id: 'v1', trip_id: TRIP_ID, version_number: 1, markdown_content: '# Old draft', input_tokens: null, output_tokens: null, created_at: '2026-04-20T00:00:00Z' },
      { id: 'v2', trip_id: TRIP_ID, version_number: 2, markdown_content: '# Latest draft', input_tokens: null, output_tokens: null, created_at: '2026-04-21T00:00:00Z' },
    );

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/draft` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version_number: number; markdown_content: string };
    expect(body.version_number).toBe(2);
    expect(body.markdown_content).toBe('# Latest draft');
  });

  it('GET /draft returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;
    mockItineraryVersions.push({
      id: 'v1', trip_id: TRIP_ID, version_number: 1,
      markdown_content: '# Secret draft', input_tokens: null, output_tokens: null,
      created_at: '2026-04-20T00:00:00Z',
    });

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/draft` });
    expect(res.statusCode).toBe(404);
    // Must not return any draft content
    expect(res.body).not.toContain('Secret draft');
  });

  // ── AI usage logging ───────────────────────────────────────────────────────

  it('POST /draft/stream saves input_tokens and output_tokens from the AI provider', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });

    expect(mockItineraryVersions).toHaveLength(1);
    expect(mockItineraryVersions[0].input_tokens).toBe(500);
    expect(mockItineraryVersions[0].output_tokens).toBe(2000);
  });

  // ── Context manager — research notes budget ───────────────────────────────
  // Truncation logic is unit-tested in contextManager.test.ts.
  // Here we verify the route passes through research content to the AI prompt,
  // confirming the context manager integration path is wired up (route reaches AI).

  it('POST /draft/stream passes research content to the AI (context manager wired)', async () => {
    // Route uses research content from mock (MOCK_RESEARCH_CONTENT = ~43 chars, well under budget).
    // AI should be called once, receiving a user message.
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/draft/stream` });

    expect(mockStreamFn).toHaveBeenCalledOnce();
    const [[promptArg]] = mockStreamFn.mock.calls as [[unknown, unknown]];
    // The user message should contain the research content
    expect(JSON.stringify(promptArg)).toContain('Verified venues here');
  });

  // ── Resume path ────────────────────────────────────────────────────────────

  it('POST /draft/stream?resumeFrom=N replays saved draft from that offset', async () => {
    const savedContent = FULL_DRAFT_CONTENT;
    mockItineraryVersions.push({
      id: 'v1',
      trip_id: TRIP_ID,
      version_number: 1,
      markdown_content: savedContent,
      input_tokens: 500,
      output_tokens: 2000,
      created_at: '2026-04-21T00:00:00Z',
    });

    // Trip can be in any status for a resume
    mockTrip.status = 'draft';

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/draft/stream?resumeFrom=20`,
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSSEBody(res.body);
    const assembled = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.text as string)
      .join('');
    expect(assembled).toBe(savedContent.slice(20));
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', versionNumber: 1 });
    // AI should NOT have been called — this was a replay
    expect(mockStreamFn).not.toHaveBeenCalled();
  });
});
