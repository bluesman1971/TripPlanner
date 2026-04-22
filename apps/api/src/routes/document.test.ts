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

// ─── Mock document queue ──────────────────────────────────────────────────────
const FAKE_JOB_ID = 'doc-job-abc123';
const mockQueueAdd  = vi.fn(async () => ({ id: FAKE_JOB_ID }));
const mockQueueGetJob = vi.fn();

vi.mock('../queues/document.queue', () => ({
  getDocumentQueue: () => ({
    add: mockQueueAdd,
    getJob: mockQueueGetJob,
  }),
}));

// ─── Mock R2 ──────────────────────────────────────────────────────────────────
const FAKE_R2_KEY = 'itineraries/trip-id/fake-uuid.docx';
const mockDownloadR2AsBuffer = vi.fn(async (_key?: unknown) => Buffer.from('MOCK_DOCX_CONTENT'));

vi.mock('../lib/r2', () => ({
  uploadToR2: vi.fn(),
  downloadFromR2ToTemp: vi.fn(),
  deleteFromR2: vi.fn(),
  uploadDocxToR2: vi.fn(),
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
                excludeNullDocx = true;
                return builder;
              },
              order: () => builder,
              limit: () => ({
                single: async () => {
                  let matches = mockVersions.filter((v) => v.trip_id === filters['trip_id']);
                  if (excludeNullDocx) matches = matches.filter((v) => v.docx_r2_key != null);
                  const sorted = [...matches].sort((a, b) => b.version_number - a.version_number);
                  return { data: sorted[0] ?? null, error: null };
                },
              }),
            };
            return builder;
          },
        };
      }

      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => ({ single: async () => ({ data: null, error: null }) }) }),
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

    mockGetAuth.mockReturnValue({ userId: 'user_test_consultant' });
    mockQueueAdd.mockResolvedValue({ id: FAKE_JOB_ID });
    mockDownloadR2AsBuffer.mockResolvedValue(Buffer.from('MOCK_DOCX_CONTENT'));

    // Default: job is active (not yet done) and belongs to this trip
    mockQueueGetJob.mockResolvedValue({
      data: { tripId: TRIP_ID, consultantId: CONSULTANT_ID },
      getState: async () => 'active',
      returnvalue: null,
    });

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

  it('GET /document/job/:jobId returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/${FAKE_JOB_ID}` });
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
  });

  it('GET /document/download returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /document/job/:jobId returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/${FAKE_JOB_ID}` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /document/job/:jobId returns 404 when job belongs to a different trip (IDOR on job)', async () => {
    mockQueueGetJob.mockResolvedValueOnce({
      data: { tripId: 'different-trip-id', consultantId: CONSULTANT_ID },
      getState: async () => 'completed',
      returnvalue: { versionNumber: 99, downloadPath: '/trips/other/document/download' },
    });
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/${FAKE_JOB_ID}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/job not found/i);
  });

  it('POST /document returns 404 for a non-existent trip ID', async () => {
    const res = await app.inject({ method: 'POST', url: '/trips/00000000-0000-0000-0000-000000000000/document' });
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

  // ── POST happy path (async — enqueues job) ─────────────────────────────────

  it('POST /document returns 202 with jobId', async () => {
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { jobId: string };
    expect(body.jobId).toBe(FAKE_JOB_ID);
  });

  it('POST /document enqueues job with correct tripId, versionId, and markdown', async () => {
    await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });
    expect(mockQueueAdd).toHaveBeenCalledOnce();
    const callArgs = mockQueueAdd.mock.calls[0] as unknown[];
    const jobData = callArgs[1] as Record<string, unknown>;
    expect(jobData.tripId).toBe(TRIP_ID);
    expect(jobData.versionId).toBe(VERSION_ID);
    expect(jobData.markdownContent).toBe('# Barcelona Itinerary\n## Day 1\nSome content.');
  });

  it('POST /document also accepts review status', async () => {
    mockTrip.status = 'review';
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });
    expect(res.statusCode).toBe(202);
  });

  it('POST /document also accepts complete status', async () => {
    mockTrip.status = 'complete';
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });
    expect(res.statusCode).toBe(202);
  });

  it('POST /document returns 500 when queue.add throws', async () => {
    mockQueueAdd.mockRejectedValueOnce(new Error('Redis unavailable'));
    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/document` });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).not.toContain('Redis');
    expect(body.error).toMatch(/failed/i);
  });

  // ── GET /document/job/:jobId ───────────────────────────────────────────────

  it('GET /document/job/:jobId returns 404 when job does not exist', async () => {
    mockQueueGetJob.mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/nonexistent` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /document/job/:jobId returns active status while job is running', async () => {
    mockQueueGetJob.mockResolvedValueOnce({ data: { tripId: TRIP_ID }, getState: async () => 'active', returnvalue: null });
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/${FAKE_JOB_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe('active');
  });

  it('GET /document/job/:jobId returns waiting status when job is queued', async () => {
    mockQueueGetJob.mockResolvedValueOnce({ data: { tripId: TRIP_ID }, getState: async () => 'waiting', returnvalue: null });
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/${FAKE_JOB_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe('waiting');
  });

  it('GET /document/job/:jobId returns completed with result', async () => {
    const mockResult = { versionNumber: 1, downloadPath: `/trips/${TRIP_ID}/document/download` };
    mockQueueGetJob.mockResolvedValueOnce({
      data: { tripId: TRIP_ID },
      getState: async () => 'completed',
      returnvalue: mockResult,
    });
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/${FAKE_JOB_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; result: typeof mockResult };
    expect(body.status).toBe('completed');
    expect(body.result.versionNumber).toBe(1);
    expect(body.result.downloadPath).toContain('/document/download');
  });

  it('GET /document/job/:jobId returns failed status with generic message', async () => {
    mockQueueGetJob.mockResolvedValueOnce({ data: { tripId: TRIP_ID }, getState: async () => 'failed', returnvalue: null });
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/job/${FAKE_JOB_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; error: string };
    expect(body.status).toBe('failed');
    expect(body.error).toMatch(/failed/i);
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
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /document/download returns DOCX content-type header', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('GET /document/download returns Content-Disposition with version number in filename', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });
    const disposition = res.headers['content-disposition'] as string;
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('itinerary-v1.docx');
  });

  it('GET /document/download returns the DOCX buffer from R2', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });
    expect(Buffer.from(res.rawPayload).toString()).toBe('MOCK_DOCX_CONTENT');
    expect(mockDownloadR2AsBuffer).toHaveBeenCalledWith(FAKE_R2_KEY);
  });

  it('GET /document/download returns 500 when R2 download throws', async () => {
    mockVersions[0].docx_r2_key = FAKE_R2_KEY;
    mockDownloadR2AsBuffer.mockRejectedValueOnce(new Error('R2 network error'));
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/document/download` });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).not.toContain('network error');
    expect(body.error).toMatch(/failed/i);
  });
});
