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
  yield { text: '# Revised Barcelona Itinerary\n' };
  yield { text: 'Updated content.\n' };
});

const mockGetUsageFn = vi.fn(async () => ({
  inputTokens: 400,
  outputTokens: 1800,
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

// ─── Mock R2 + DOCX (not used in revise routes, but other routes need them) ──
vi.mock('../services/docxGenerator', () => ({
  generateDocx: vi.fn(async () => Buffer.from('mock')),
}));
vi.mock('../lib/r2', () => ({
  uploadToR2: vi.fn(),
  downloadFromR2ToTemp: vi.fn(),
  deleteFromR2: vi.fn(),
  uploadDocxToR2: vi.fn(async () => 'itineraries/fake.docx'),
  downloadR2AsBuffer: vi.fn(async () => Buffer.from('mock')),
}));

// ─── In-memory DB ─────────────────────────────────────────────────────────────
const CONSULTANT_ID       = 'a0000000-0000-0000-0000-000000000001';
const OTHER_CONSULTANT_ID = 'a0000000-0000-0000-0000-000000000099';
const TRIP_ID             = 'a0000000-0000-0000-0000-000000000003';

type TripRow = {
  id: string;
  destination: string;
  destination_country: string;
  status: string;
  clients: { consultant_id: string };
};

type VersionRow = {
  id: string;
  trip_id: string;
  version_number: number;
  markdown_content: string;
  docx_r2_key: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

let mockTrip: TripRow;
let mockVersions: VersionRow[];
let mockInsertedVersions: VersionRow[];
let tripStatusUpdates: Array<Record<string, unknown>>;

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function parseSSEBody(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice(6)));
}

// ─── Supabase mock ────────────────────────────────────────────────────────────
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {

      // ── consultants ────────────────────────────────────────────────────────
      if (table === 'consultants') {
        const consultant = {
          id: CONSULTANT_ID,
          name: 'Tom Baker',
          email: 'tdbaker@gmail.com',
          auth_user_id: 'user_test_consultant',
        };
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: consultant, error: null }) }),
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
              eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
              single: async () => {
                const tripMatches = filters['id'] === mockTrip?.id;
                const ownerMatches =
                  filters['clients.consultant_id'] === mockTrip?.clients.consultant_id;
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

      // ── itinerary_versions ─────────────────────────────────────────────────
      if (table === 'itinerary_versions') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
              not: () => builder,
              order: () => builder,
              limit: () => ({
                single: async () => {
                  const matches = mockVersions
                    .filter((v) => v.trip_id === filters['trip_id'])
                    .sort((a, b) => b.version_number - a.version_number);
                  return { data: matches[0] ?? null, error: null };
                },
              }),
            };
            return builder;
          },
          insert: (row: Record<string, unknown>) => {
            const newVersion: VersionRow = {
              id: `ver-${Date.now()}`,
              trip_id: row.trip_id as string,
              version_number: row.version_number as number,
              markdown_content: row.markdown_content as string,
              docx_r2_key: null,
              input_tokens: (row.input_tokens as number) ?? null,
              output_tokens: (row.output_tokens as number) ?? null,
              created_at: new Date().toISOString(),
            };
            mockVersions.push(newVersion);
            mockInsertedVersions.push(newVersion);
            return Promise.resolve({ data: null, error: null });
          },
          update: (data: Record<string, unknown>) => ({
            eq: (_col: string, _val: unknown) => {
              void data;
              return Promise.resolve({ data: null, error: null });
            },
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

      // ── other tables ───────────────────────────────────────────────────────
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
            single: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },

    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === 'insert_itinerary_version') {
        const tripId = args.p_trip_id as string;
        const existing = mockVersions.filter((v) => v.trip_id === tripId);
        const nextVersion = existing.length > 0
          ? Math.max(...existing.map((v) => v.version_number)) + 1
          : 1;
        const newVersion: VersionRow = {
          id: `ver-${Date.now()}`,
          trip_id: tripId,
          version_number: nextVersion,
          markdown_content: args.p_markdown as string,
          docx_r2_key: null,
          input_tokens: args.p_input_tokens as number,
          output_tokens: args.p_output_tokens as number,
          created_at: new Date().toISOString(),
        };
        mockVersions.push(newVersion);
        mockInsertedVersions.push(newVersion);
        return Promise.resolve({ data: nextVersion, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('revise routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockTrip = {
      id: TRIP_ID,
      destination: 'Barcelona, Spain',
      destination_country: 'Spain',
      status: 'draft',
      clients: { consultant_id: CONSULTANT_ID },
    };

    mockVersions = [
      {
        id: 'ver-1',
        trip_id: TRIP_ID,
        version_number: 1,
        markdown_content: '# Barcelona Itinerary\n## Day 1\nOriginal content.',
        docx_r2_key: null,
        input_tokens: null,
        output_tokens: null,
        created_at: '2026-04-21T00:00:00Z',
      },
    ];

    mockInsertedVersions = [];
    tripStatusUpdates = [];

    mockGetAuth.mockReturnValue({ userId: 'user_test_consultant' });
    mockStreamFn.mockImplementation(async function* () {
      yield { text: '# Revised Barcelona Itinerary\n' };
      yield { text: 'Updated content.\n' };
    });
    mockGetUsageFn.mockResolvedValue({
      inputTokens: 400,
      outputTokens: 1800,
      model: 'claude-sonnet-4-6',
    });

    app = await buildApp();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('POST /revise/stream returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum for gallery.' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  // ── IDOR prevention ────────────────────────────────────────────────────────

  it('POST /revise/stream returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('POST /revise/stream returns 404 for a non-existent trip ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trips/00000000-0000-0000-0000-000000000000/revise/stream',
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Gate checks ────────────────────────────────────────────────────────────

  it('POST /revise/stream returns 400 when status is setup', async () => {
    mockTrip.status = 'setup';

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/draft/i);
  });

  it('POST /revise/stream returns 400 when status is ingestion', async () => {
    mockTrip.status = 'ingestion';

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /revise/stream returns 400 when status is research', async () => {
    mockTrip.status = 'research';

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /revise/stream returns 400 when feedback is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/feedback/i);
  });

  it('POST /revise/stream returns 400 when feedback is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /revise/stream returns 400 when no itinerary version exists', async () => {
    mockVersions = [];

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/draft/i);
  });

  // ── Happy path — SSE stream ────────────────────────────────────────────────

  it('POST /revise/stream returns SSE content-type header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('POST /revise/stream emits chunk events followed by done', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    const events = parseSSEBody(res.body);
    expect(events.filter((e) => e.type === 'chunk').length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('POST /revise/stream done event includes versionNumber', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    const events = parseSSEBody(res.body);
    const done = events.find((e) => e.type === 'done');
    expect(typeof done?.versionNumber).toBe('number');
  });

  it('POST /revise/stream chunk text concatenates to the full AI output', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    const events = parseSSEBody(res.body);
    const assembled = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.text as string)
      .join('');

    expect(assembled).toBe('# Revised Barcelona Itinerary\nUpdated content.\n');
  });

  // ── Side-effects ───────────────────────────────────────────────────────────

  it('POST /revise/stream saves revised content as a new itinerary version', async () => {
    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(mockInsertedVersions).toHaveLength(1);
    expect(mockInsertedVersions[0].trip_id).toBe(TRIP_ID);
    expect(mockInsertedVersions[0].markdown_content).toBe(
      '# Revised Barcelona Itinerary\nUpdated content.\n',
    );
  });

  it('POST /revise/stream saves as version 2 when v1 exists', async () => {
    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(mockInsertedVersions[0].version_number).toBe(2);
  });

  it('POST /revise/stream advances status from draft to review', async () => {
    mockTrip.status = 'draft';

    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(tripStatusUpdates.some((u) => u.status === 'review')).toBe(true);
  });

  it('POST /revise/stream does NOT update status when already review', async () => {
    mockTrip.status = 'review';

    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(tripStatusUpdates.some((u) => u.status === 'review')).toBe(false);
  });

  it('POST /revise/stream does NOT update status when already complete', async () => {
    mockTrip.status = 'complete';

    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(tripStatusUpdates.some((u) => u.status === 'review')).toBe(false);
  });

  it('POST /revise/stream works when status is review', async () => {
    mockTrip.status = 'review';

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(mockInsertedVersions).toHaveLength(1);
  });

  it('POST /revise/stream works when status is complete', async () => {
    mockTrip.status = 'complete';

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(mockInsertedVersions).toHaveLength(1);
  });

  // ── AI provider failure ────────────────────────────────────────────────────

  it('POST /revise/stream emits an error event when the AI provider throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      yield { text: 'Partial\n' };
      throw new Error('Rate limit exceeded');
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    const events = parseSSEBody(res.body);
    const errorEvent = events.find((e) => e.type === 'error');

    expect(errorEvent).toBeDefined();
    expect(typeof errorEvent!.message).toBe('string');
    expect(errorEvent!.message).not.toContain('Rate limit');
  });

  it('POST /revise/stream does not save a version when AI throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      throw new Error('Rate limit exceeded');
    });

    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(mockInsertedVersions).toHaveLength(0);
  });

  it('POST /revise/stream does not advance status when AI throws', async () => {
    mockStreamFn.mockImplementation(async function* () {
      throw new Error('Rate limit exceeded');
    });

    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(tripStatusUpdates).toHaveLength(0);
  });

  // ── AI usage logging ───────────────────────────────────────────────────────

  it('POST /revise/stream saves input_tokens and output_tokens from the AI provider', async () => {
    await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(mockInsertedVersions).toHaveLength(1);
    expect(mockInsertedVersions[0].input_tokens).toBe(400);
    expect(mockInsertedVersions[0].output_tokens).toBe(1800);
  });

  // ── Resume path ────────────────────────────────────────────────────────────

  it('POST /revise/stream?resumeFrom=N replays the latest saved version from that offset', async () => {
    const savedContent = '# Barcelona Itinerary\n## Day 1\nOriginal content.';
    // mockVersions already has v1 set up in beforeEach

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/revise/stream?resumeFrom=22`,
      payload: { feedback: 'Swap museum.' },
    });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSSEBody(res.body);
    const assembled = events
      .filter((e) => e.type === 'chunk')
      .map((e) => e.text as string)
      .join('');
    expect(assembled).toBe(savedContent.slice(22));
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', versionNumber: 1 });
    // AI should NOT have been called — this was a replay
    expect(mockStreamFn).not.toHaveBeenCalled();
  });
});
