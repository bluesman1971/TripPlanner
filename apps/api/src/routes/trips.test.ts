import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app';

// ─── Mock Clerk ───────────────────────────────────────────────────────────────
vi.mock('@clerk/fastify', () => ({
  clerkPlugin: async () => {},
  getAuth: () => ({ userId: 'user_test_consultant' }),
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

// ─── Mock Supabase ────────────────────────────────────────────────────────────
// Stores in-memory state to simulate the DB across calls within a test.
const CONSULTANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CLIENT_ID     = 'a0000000-0000-0000-0000-000000000002';
const TRIP_ID       = 'a0000000-0000-0000-0000-000000000003';

let mockConsultant = { id: CONSULTANT_ID, name: 'Tom Baker', email: 'tdbaker@gmail.com', auth_user_id: 'user_test_consultant' };
let mockClient = { id: CLIENT_ID, name: 'Tom Baker', email: 'tdbaker@gmail.com', consultant_id: CONSULTANT_ID, created_at: '2026-04-20' };
let mockTrips: Record<string, unknown>[] = [];
let mockBriefs: Record<string, unknown>[] = [];

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const latestBrief = () => mockBriefs[mockBriefs.length - 1] ?? null;
      const latestTrip = () => mockTrips[0] ?? null;

      const singleFor = (t: string) => async () => {
        if (t === 'consultants') return { data: mockConsultant, error: null };
        if (t === 'clients')     return { data: mockClient, error: null };
        if (t === 'trips')       return { data: latestTrip(), error: null };
        if (t === 'trip_brief')  return { data: latestBrief(), error: null };
        return { data: null, error: null };
      };

      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: singleFor(table),
              order: () => ({
                limit: () => ({ single: singleFor(table) }),
              }),
            }),
            single:  singleFor(table),
            order:   () => ({
              limit: () => ({ single: singleFor(table) }),
              data: table === 'trips' ? mockTrips : mockBriefs,
              error: null,
            }),
          }),
          order: () => ({
            limit: () => ({ single: singleFor(table) }),
            data: table === 'trips' ? mockTrips : mockBriefs,
            error: null,
          }),
        }),
        // Push to in-memory state immediately on insert; also support chained .select().single()
        insert: (row: Record<string, unknown>) => {
          const record = { id: `${table}-${Date.now()}`, ...row, created_at: '2026-04-20' };
          if (table === 'trips')      mockTrips.push(record);
          if (table === 'trip_brief') mockBriefs.push(record);
          return {
            select: () => ({ single: async () => ({ data: record, error: null }) }),
          };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      };
    },
  }),
}));

// ─── Barcelona fixture ────────────────────────────────────────────────────────
const barcelonaDiscovery = {
  destination_visits: 0,
  previously_seen: [],
  ratio_classic_pct: 50,
  ratio_hidden_pct: 50,
  ratio_label: 'balanced' as const,
  must_sees: ['Casa Batlló exterior', 'Casa Milà / La Pedrera exterior'],
  already_done: [],
  notes: 'First-timers.',
};

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('trips routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    mockTrips = [];
    mockBriefs = [];
    app = await buildApp();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('POST /trips creates a trip with brief', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trips',
      payload: {
        clientId: CLIENT_ID,
        destination: 'Barcelona, Spain',
        destinationSlug: 'barcelona',
        destinationCountry: 'Spain',
        departureCity: 'Unknown',
        startDate: '2026-04-24',
        endDate: '2026-04-26',
        durationDays: 3,
        purpose: 'anniversary',
        purposeNotes: 'Wedding anniversary. First stop of a cruise vacation.',
        discovery: barcelonaDiscovery,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.destination).toBe('Barcelona, Spain');
    expect(body.status).toBe('setup');
    // Brief should have been saved
    expect(mockBriefs).toHaveLength(1);
    expect((mockBriefs[0] as Record<string, unknown>).version).toBe(1);
  });

  it('GET /trips returns trips list', async () => {
    // Seed one trip
    mockTrips = [{ id: 'trip-uuid', destination: 'Barcelona, Spain', status: 'setup' }];
    const res = await app.inject({ method: 'GET', url: '/trips' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('PATCH /trips/:id/brief updates status to ingestion when documents_ingested is true', async () => {
    mockTrips = [{ id: TRIP_ID, destination: 'Barcelona, Spain', status: 'setup', clients: { consultant_id: CONSULTANT_ID } }];
    mockBriefs = [{ trip_id: TRIP_ID, brief_json: { status: 'setup', version_history: [] }, version: 1 }];

    const res = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/brief`,
      payload: {
        status: 'research',
        documentsIngested: true,
      },
    });

    // The new brief version should reflect the update
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(2);
    const briefJson = body.brief_json as Record<string, unknown>;
    expect(briefJson.status).toBe('research');
    expect(briefJson.documents_ingested).toBe(true);
  });
});
