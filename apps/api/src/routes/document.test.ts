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

// ─── Mock AI provider (research/draft routes need this) ───────────────────────
vi.mock('../ai/anthropic.provider', () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({
    stream: async function* () { yield { text: 'mock' }; },
    complete: vi.fn(),
  })),
}));

// ─── Mock DOCX generator ──────────────────────────────────────────────────────
const mockGenerateDocx = vi.fn(async (_markdown?: unknown, _opts?: unknown) => Buffer.from('MOCK_DOCX_CONTENT'));

vi.mock('../services/docxGenerator', () => ({
  generateDocx: (markdown: unknown, opts: unknown) => mockGenerateDocx(markdown, opts),
}));

// ─── Mock R2 ──────────────────────────────────────────────────────────────────
const FAKE_R2_KEY = 'itineraries/trip-id/fake-uuid.docx';
const mockUploadDocxToR2 = vi.fn(async (_buf?: unknown, _tripId?: unknown) => FAKE_R2_KEY);
const mockDownloadR2AsBuffer = vi.fn(async (_key?: unknown) => Buffer.from('MOCK_DOCX_CONTENT'));

vi.mock('../lib/r2', () => ({
  uploadToR2: vi.fn(),
  downloadFromR2ToTemp: vi.fn(),
  deleteFromR2: vi.fn(),
  uploadDocxToR2: (buf: unknown, tripId: unknown) => mockUploadDocxToR2(buf, tripId),
  downloadR2AsBuffer: (key: unknown) => mockDownloadR2AsBuffer(key),
}));

// ─── In-memory DB ─────────────────────────────────────────────────────────────
const CONSULTANT_ID       = 'a0000000-0000-0000-0000-000000000001';
const OTHER_CONSULTANT_ID = 'a0000000-0000-0000-0000-000000000099';
const TRIP_ID             = 'a0000000-0000-0000-0000-000000000003';
const VERSION_ID          = 'a0000000-0000-0000-0000-000000000010';

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
  created_at: string;
};

let mockTrip: TripRow;
let mockVersions: VersionRow[];
let tripStatusUpdates: Array<Record<string, unknown>>;
let versionUpdates: Array<{ id: string; data: Record<string, unknown> }>;

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
            let excludeNullDocx = false;
            const builder = {
              eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
              not: (_col: string, _op: string, _val: unknown) => {
                // Handles .not('docx_r2_key', 'is', null) — only used for docx queries
                excludeNullDocx = true;
                return builder;
              },
              order: () => builder,
              limit: () => ({
                single: async () => {
                  let matches = mockVersions.filter(
                    (v) => v.trip_id === filters['trip_id'],
                  );
                  if (excludeNullDocx) {
                    matches = matches.filter((v) => v.docx_r2_key != null);
                  }
                  // Return highest version_number
                  const sorted = [...matches].sort(
                    (a, b) => b.version_number - a.version_number,
                  );
                  return { data: sorted[0] ?? null, error: null };
                },
              }),
            };
            return builder;
          },
          update: (data: Record<string, unknown>) => {
            return {
              eq: (col: string, val: unknown) => {
                if (col === 'id') {
                  const v = mockVersions.find((v) => v.id === val);
                  if (v) Object.assign(v, data);
                }
                versionUpdates.push({ id: val as string, data });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      }

      // ── other tables (research_notes, trip_brief, bookings) ───────────────
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
  }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('document routes', () => {
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
        id: VERSION_ID,
        trip_id: TRIP_ID,
        version_number: 1,
        markdown_content: '# Barcelona Itinerary\n## Day 1\nSome content.',
        docx_r2_key: null,
        created_at: '2026-04-21T00:00:00Z',
      },
    ];

    tripStatusUpdates = [];
    versionUpdates = [];

    mockGetAuth.mockReturnValue({ userId: 'user_test_consultant' });
    mockGenerateDocx.mockResolvedValue(Buffer.from('MOCK_DOCX_CONTENT'));
    mockUploadDocxToR2.mockResolvedValue(FAKE_R2_KEY);
    mockDownloadR2AsBuffer.mockResolvedValue(Buffer.from('MOCK_DOCX_CONTENT'));

    app = await buildApp();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('POST /document returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  it('GET /document returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(401);
  });

  it('GET /document/download returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });

    expect(res.statusCode).toBe(401);
  });

  // ── IDOR prevention ────────────────────────────────────────────────────────

  it('POST /document returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('GET /document returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('GET /document/download returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });

    expect(res.statusCode).toBe(404);
  });

  it('POST /document returns 404 for a non-existent trip ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trips/00000000-0000-0000-0000-000000000000/document',
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Gate checks ────────────────────────────────────────────────────────────

  it('POST /document returns 400 when trip status is setup', async () => {
    mockTrip.status = 'setup';

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/draft/i);
  });

  it('POST /document returns 400 when trip status is ingestion', async () => {
    mockTrip.status = 'ingestion';

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(400);
  });

  it('POST /document returns 400 when trip status is research', async () => {
    mockTrip.status = 'research';

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(400);
  });

  it('POST /document returns 400 when no itinerary version exists', async () => {
    mockVersions = [];

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/draft/i);
  });

  // ── Happy path — POST ──────────────────────────────────────────────────────

  it('POST /document calls generateDocx with the markdown content', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(mockGenerateDocx).toHaveBeenCalledOnce();
    const [markdownArg] = mockGenerateDocx.mock.calls[0] as unknown as [string, unknown];
    expect(markdownArg).toBe('# Barcelona Itinerary\n## Day 1\nSome content.');
  });

  it('POST /document uploads the DOCX to R2', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(mockUploadDocxToR2).toHaveBeenCalledOnce();
    const [, tripIdArg] = mockUploadDocxToR2.mock.calls[0] as unknown as [Buffer, string];
    expect(tripIdArg).toBe(TRIP_ID);
  });

  it('POST /document saves the R2 key to itinerary_versions', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(versionUpdates).toHaveLength(1);
    expect(versionUpdates[0].data.docx_r2_key).toBe(FAKE_R2_KEY);
    // Also verify it updated the correct version row
    expect(versionUpdates[0].id).toBe(VERSION_ID);
  });

  it('POST /document advances trip status to review', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(tripStatusUpdates.some((u) => u.status === 'review')).toBe(true);
  });

  it('POST /document returns versionNumber and downloadPath', async () => {
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { versionNumber: number; downloadPath: string };
    expect(body.versionNumber).toBe(1);
    expect(body.downloadPath).toBe(`/trips/${TRIP_ID}/document/download`);
  });

  it('POST /document also works when status is review (re-generation)', async () => {
    mockTrip.status = 'review';

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(200);
  });

  it('POST /document also works when status is complete', async () => {
    mockTrip.status = 'complete';

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(200);
  });

  // ── Failure path ───────────────────────────────────────────────────────────

  it('POST /document returns 500 when generateDocx throws', async () => {
    mockGenerateDocx.mockRejectedValueOnce(new Error('Out of memory'));

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).not.toContain('Out of memory');
    expect(body.error).toMatch(/failed/i);
  });

  it('POST /document does not update trip status when generateDocx throws', async () => {
    mockGenerateDocx.mockRejectedValueOnce(new Error('Out of memory'));

    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(tripStatusUpdates.some((u) => u.status === 'review')).toBe(false);
  });

  it('POST /document does not save R2 key when upload throws', async () => {
    mockUploadDocxToR2.mockRejectedValueOnce(new Error('R2 unavailable'));

    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });

    expect(versionUpdates).toHaveLength(0);
  });

  // ── GET /document ──────────────────────────────────────────────────────────

  it('GET /document returns null when no document has been generated', async () => {
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('GET /document returns document info when document exists', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { versionNumber: number; downloadPath: string };
    expect(body.versionNumber).toBe(1);
    expect(body.downloadPath).toBe(`/trips/${TRIP_ID}/document/download`);
  });

  // ── GET /document/download ─────────────────────────────────────────────────

  it('GET /document/download returns 404 when no document exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/document/download`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /document/download returns DOCX content-type header', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/document/download`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('GET /document/download returns Content-Disposition with version number in filename', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/document/download`,
    });

    const disposition = res.headers['content-disposition'] as string;
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('itinerary-v1.docx');
  });

  it('GET /document/download returns the DOCX buffer from R2', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/document/download`,
    });

    expect(Buffer.from(res.rawPayload).toString()).toBe('MOCK_DOCX_CONTENT');
    expect(mockDownloadR2AsBuffer).toHaveBeenCalledWith(FAKE_R2_KEY);
  });

  it('GET /document/download returns 500 when R2 download throws', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;
    mockDownloadR2AsBuffer.mockRejectedValueOnce(new Error('R2 network error'));

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/document/download`,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    // Internal error detail must not leak
    expect(body.error).not.toContain('network error');
    expect(body.error).toMatch(/failed/i);
  });
});
