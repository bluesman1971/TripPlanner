import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app';

// ─── Mock Clerk ───────────────────────────────────────────────────────────────
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

// ─── Mock PDF generator ───────────────────────────────────────────────────────
const mockGeneratePdf = vi.fn(async (_markdown: string, _title: string) =>
  Buffer.from('%PDF-mock-content'),
);

vi.mock('../services/pdfGenerator', () => ({
  generatePdf: (...args: Parameters<typeof mockGeneratePdf>) => mockGeneratePdf(...args),
}));

// ─── In-memory DB state ───────────────────────────────────────────────────────
const CONSULTANT_ID       = 'a0000000-0000-0000-0000-000000000001';
const OTHER_CONSULTANT_ID = 'a0000000-0000-0000-0000-000000000099';
const TRIP_ID             = 'a0000000-0000-0000-0000-000000000003';
const VALID_TOKEN         = 'valid-portal-token-abc123';
const REVOKED_TOKEN       = 'revoked-portal-token-xyz';
const EXPIRED_TOKEN       = 'expired-portal-token-def';
const UNKNOWN_TOKEN       = 'completely-unknown-token';

type TripRow = {
  id: string;
  destination: string;
  destination_country: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  purpose: string;
  status: string;
  clients: { consultant_id: string; name: string };
};

type PortalTokenRow = {
  id: string;
  trip_id: string;
  token: string;
  revoked: boolean;
  expires_at: string | null;
};

type ItineraryVersionRow = {
  id: string;
  trip_id: string;
  version_number: number;
  markdown_content: string;
  created_at: string;
};

let mockTrip: TripRow;
let mockPortalTokens: PortalTokenRow[];
let mockItineraryVersions: ItineraryVersionRow[];
let insertedPortalTokens: Array<Record<string, unknown>>;

// ─── Supabase mock ────────────────────────────────────────────────────────────
vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {

      // ── consultants ──────────────────────────────────────────────────────────
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

      // ── trips ────────────────────────────────────────────────────────────────
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
                // Consultant-owned lookup (with consultant_id filter)
                if (filters['clients.consultant_id'] !== undefined) {
                  const tripMatches = filters['id'] === mockTrip?.id;
                  const ownerMatches = filters['clients.consultant_id'] === mockTrip?.clients.consultant_id;
                  if (tripMatches && ownerMatches) return { data: mockTrip, error: null };
                  return { data: null, error: null };
                }
                // Public lookup (portal, no consultant filter)
                if (filters['id'] === mockTrip?.id) return { data: mockTrip, error: null };
                return { data: null, error: null };
              },
            };
            return builder;
          },
        };
      }

      // ── portal_tokens ────────────────────────────────────────────────────────
      if (table === 'portal_tokens') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              },
              single: async () => {
                const row = mockPortalTokens.find(
                  (t) => t.token === filters['token'],
                );
                return { data: row ?? null, error: null };
              },
            };
            return builder;
          },
          insert: (row: Record<string, unknown>) => {
            insertedPortalTokens.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      // ── itinerary_versions ───────────────────────────────────────────────────
      if (table === 'itinerary_versions') {
        return {
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
                  const version = mockItineraryVersions
                    .filter((v) => v.trip_id === filters['trip_id'])
                    .sort((a, b) => b.version_number - a.version_number)[0];
                  return { data: version ?? null, error: null };
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('portal routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockTrip = {
      id: TRIP_ID,
      destination: 'Barcelona, Spain',
      destination_country: 'Spain',
      start_date: '2026-04-24',
      end_date: '2026-04-26',
      duration_days: 3,
      purpose: 'anniversary',
      status: 'review',
      clients: { consultant_id: CONSULTANT_ID, name: 'Alice Smith' },
    };

    mockPortalTokens = [
      { id: 'tok-1', trip_id: TRIP_ID, token: VALID_TOKEN, revoked: false, expires_at: null },
      { id: 'tok-2', trip_id: TRIP_ID, token: REVOKED_TOKEN, revoked: true, expires_at: null },
      { id: 'tok-3', trip_id: TRIP_ID, token: EXPIRED_TOKEN, revoked: false, expires_at: '2020-01-01T00:00:00Z' },
    ];

    mockItineraryVersions = [
      {
        id: 'iv-1',
        trip_id: TRIP_ID,
        version_number: 2,
        markdown_content: '# Barcelona Itinerary\nDay 1: Explore the city.',
        created_at: '2026-04-21T12:00:00Z',
      },
    ];

    insertedPortalTokens = [];

    mockGetAuth.mockReturnValue({ userId: 'user_test_consultant' });
    mockGeneratePdf.mockResolvedValue(Buffer.from('%PDF-mock-content'));

    app = await buildApp();
  });

  // ── Authentication — token creation requires Clerk JWT ──────────────────────

  it('POST /trips/:id/portal/token returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: undefined });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/portal/token`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Unauthorized' });
  });

  // ── IDOR — token creation must verify ownership ──────────────────────────────

  it('POST /trips/:id/portal/token returns 404 when trip belongs to a different consultant', async () => {
    mockTrip.clients.consultant_id = OTHER_CONSULTANT_ID;

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/portal/token`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Trip not found' });
  });

  it('POST /trips/:id/portal/token returns 404 for a trip ID that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trips/00000000-0000-0000-0000-000000000000/portal/token',
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Happy path — token creation ──────────────────────────────────────────────

  it('POST /trips/:id/portal/token creates a token and returns portalUrl', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/portal/token`,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; portalUrl: string };
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
    expect(body.portalUrl).toContain(body.token);
  });

  it('POST /trips/:id/portal/token inserts the token into the DB with the correct trip_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/portal/token`,
    });

    expect(res.statusCode).toBe(201);
    expect(insertedPortalTokens).toHaveLength(1);
    expect(insertedPortalTokens[0].trip_id).toBe(TRIP_ID);
    expect(typeof insertedPortalTokens[0].token).toBe('string');
  });

  // ── Token validation — invalid/revoked/expired tokens → 404 ─────────────────
  // 404 (not 403) to avoid confirming whether a token exists at all.

  it('GET /portal/:token returns 404 for an unknown token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/portal/${UNKNOWN_TOKEN}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /portal/:token returns 404 for a revoked token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/portal/${REVOKED_TOKEN}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /portal/:token returns 404 for an expired token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/portal/${EXPIRED_TOKEN}`,
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Happy path — portal GET ──────────────────────────────────────────────────

  it('GET /portal/:token returns trip metadata and itinerary markdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/portal/${VALID_TOKEN}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      trip: { destination: string; clientName: string };
      itinerary: { markdownContent: string; versionNumber: number };
    };
    expect(body.trip.destination).toBe('Barcelona, Spain');
    expect(body.trip.clientName).toBe('Alice Smith');
    expect(body.itinerary.markdownContent).toContain('Barcelona Itinerary');
    expect(body.itinerary.versionNumber).toBe(2);
  });

  it('GET /portal/:token returns 404 when no itinerary version exists', async () => {
    mockItineraryVersions = [];

    const res = await app.inject({
      method: 'GET',
      url: `/portal/${VALID_TOKEN}`,
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Happy path — PDF download ────────────────────────────────────────────────

  it('GET /portal/:token/pdf returns PDF content-type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/portal/${VALID_TOKEN}/pdf`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  it('GET /portal/:token/pdf returns a content-disposition attachment header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/portal/${VALID_TOKEN}/pdf`,
    });

    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
  });

  it('GET /portal/:token/pdf calls generatePdf with the markdown content', async () => {
    await app.inject({
      method: 'GET',
      url: `/portal/${VALID_TOKEN}/pdf`,
    });

    expect(mockGeneratePdf).toHaveBeenCalledOnce();
    const [markdown] = mockGeneratePdf.mock.calls[0] as [string, string];
    expect(markdown).toContain('Barcelona Itinerary');
  });

  // ── PDF failure ──────────────────────────────────────────────────────────────

  it('GET /portal/:token/pdf returns 500 with generic message when PDF generation fails', async () => {
    mockGeneratePdf.mockRejectedValueOnce(new Error('Out of memory'));

    const res = await app.inject({
      method: 'GET',
      url: `/portal/${VALID_TOKEN}/pdf`,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).not.toContain('Out of memory');
    expect(body.error).toMatch(/PDF generation failed/i);
  });

  it('GET /portal/:token/pdf returns 404 for an unknown token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/portal/${UNKNOWN_TOKEN}/pdf`,
    });

    expect(res.statusCode).toBe(404);
  });
});
