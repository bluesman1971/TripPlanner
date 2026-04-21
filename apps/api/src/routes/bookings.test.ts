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

// ─── Mock R2 ──────────────────────────────────────────────────────────────────
vi.mock('../lib/r2', () => ({
  uploadToR2: vi.fn(async () => 'bookings/trip-id/test-uuid.pdf'),
  deleteFromR2: vi.fn(async () => {}),
  downloadFromR2ToTemp: vi.fn(async () => '/tmp/test-file.pdf'),
}));

// ─── Mock BullMQ queue ────────────────────────────────────────────────────────
vi.mock('../queues/ingest.queue', () => ({
  getIngestQueue: () => ({
    add: vi.fn(async () => ({ id: 'job-123' })),
    getJob: vi.fn(async () => null),
  }),
  INGEST_QUEUE_NAME: 'ingest',
}));

// ─── Mock encryption ──────────────────────────────────────────────────────────
vi.mock('../lib/encryption', () => ({
  encrypt:     (v: string) => `enc:${v}`,
  decrypt:     (v: string) => v.replace(/^enc:/, ''),
  encryptJson: (v: unknown) => `enc:${JSON.stringify(v)}`,
  decryptJson: (v: string) => JSON.parse(v.replace(/^enc:/, '')),
  isEncrypted: (v: string) => v.startsWith('enc:'),
}));

// ─── In-memory DB ─────────────────────────────────────────────────────────────
const CONSULTANT_ID       = 'a0000000-0000-0000-0000-000000000001';
const OTHER_CONSULTANT_ID = 'a0000000-0000-0000-0000-000000000099';
const TRIP_ID             = 'a0000000-0000-0000-0000-000000000003';
const BOOKING_ID          = 'a0000000-0000-0000-0000-000000000010';

type BookingRow = {
  id: string;
  trip_id: string;
  booking_slug: string;
  booking_type: string;
  booking_ref: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  meeting_point_address: string | null;
  allergy_flags: string | null;
  ingested_at: string;
};

type DocumentRow = { id: string; trip_id: string; doc_type: string; r2_key: string; original_filename: string };

let mockConsultantId: string;
let mockTripData: { id: string; clients: { consultant_id: string } } | null;
let mockBookings: BookingRow[];
let mockDocuments: DocumentRow[];
let deletedBookingIds: string[];
let insertedBookings: BookingRow[];

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const makeChain = (rows: unknown[], filterFn?: (r: unknown) => boolean) => {
        const filtered = filterFn ? (rows as Record<string, unknown>[]).filter(filterFn as (r: Record<string, unknown>) => boolean) : rows;
        return {
          eq:    (_col: string, _val: unknown) => makeChain(filtered),
          order: (_col: string) => makeChain(filtered),
          limit: (_n: number) => ({
            single:      async () => ({ data: filtered[0] ?? null, error: null }),
            maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
          }),
          single:      async () => ({ data: filtered[0] ?? null, error: null }),
          maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
        };
      };

      if (table === 'consultants') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: mockConsultantId, auth_user_id: 'user_test_consultant', name: 'Tom Baker', email: 'tdbaker@gmail.com' },
                error: null,
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => ({ data: { id: mockConsultantId, ...row }, error: null }),
            }),
          }),
          upsert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: mockConsultantId, auth_user_id: 'user_test_consultant', name: 'Tom Baker', email: 'tdbaker@gmail.com' },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'trips') {
        return {
          select: () => ({
            eq: (_col: string, _val: unknown) => ({
              eq: (_col2: string, _val2: unknown) => ({
                single: async () => ({ data: mockTripData, error: null }),
              }),
              single: async () => ({ data: mockTripData, error: null }),
            }),
          }),
          delete: () => ({ eq: () => ({ data: null, error: null }) }),
        };
      }

      if (table === 'bookings') {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => ({
              eq: (_col2: string, val2: unknown) => ({
                single: async () => {
                  const found = mockBookings.find((b) => b.id === val || b.trip_id === val || b.trip_id === val2 || b.id === val2);
                  return { data: found ?? null, error: null };
                },
                order: (_col3: string) => ({
                  ascending: (_asc: boolean) => ({ data: mockBookings.filter((b) => b.trip_id === val), error: null }),
                  data: mockBookings.filter((b) => b.trip_id === val),
                  error: null,
                }),
              }),
              single: async () => ({ data: mockBookings.find((b) => b.id === val || b.trip_id === val) ?? null, error: null }),
              order: (_col2: string) => ({
                ascending: (_asc: boolean) => ({ data: mockBookings.filter((b) => b.trip_id === val), error: null }),
                data: mockBookings.filter((b) => b.trip_id === val),
                error: null,
              }),
            }),
            order: () => ({ data: mockBookings, error: null }),
          }),
          insert: (row: Record<string, unknown>) => {
            const record = { id: `booking-${Date.now()}`, ...row } as BookingRow;
            insertedBookings.push(record);
            return {
              select: (_fields: string) => ({
                single: async () => ({ data: record, error: null }),
              }),
            };
          },
          delete: () => ({
            eq: (_col: string, val: unknown) => {
              deletedBookingIds.push(String(val));
              return { data: null, error: null };
            },
          }),
          upsert: () => ({ select: () => ({ single: async () => ({ data: mockBookings[0] ?? null, error: null }) }) }),
        };
      }

      if (table === 'documents') {
        return {
          select: () => ({
            eq: (_col: string, _val: unknown) => ({
              eq: () => ({
                order: () => ({
                  limit: (_n: number) => ({
                    maybeSingle: async () => ({ data: mockDocuments[0] ?? null, error: null }),
                  }),
                }),
              }),
              order: () => ({
                limit: (_n: number) => ({
                  maybeSingle: async () => ({ data: mockDocuments[0] ?? null, error: null }),
                }),
              }),
              maybeSingle: async () => ({ data: mockDocuments[0] ?? null, error: null }),
            }),
          }),
          insert: () => ({}),
          delete: () => ({ eq: () => ({ data: null, error: null }) }),
        };
      }

      // fallback
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      };
    },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockConsultantId = CONSULTANT_ID;
  mockTripData = { id: TRIP_ID, clients: { consultant_id: CONSULTANT_ID } };
  mockBookings = [
    {
      id: BOOKING_ID,
      trip_id: TRIP_ID,
      booking_slug: 'sagrada-familia',
      booking_type: 'tour',
      booking_ref: 'SF123',
      date: '2026-06-10',
      start_time: '10:00',
      end_time: '12:00',
      meeting_point_address: 'Carrer de Mallorca 401, Barcelona',
      allergy_flags: null,
      ingested_at: new Date().toISOString(),
    },
  ];
  mockDocuments = [
    { id: 'doc-1', trip_id: TRIP_ID, doc_type: 'booking_upload', r2_key: 'bookings/trip/file.pdf', original_filename: 'confirmation.pdf' },
  ];
  deletedBookingIds = [];
  insertedBookings = [];
  mockGetAuth.mockReturnValue({ userId: 'user_test_consultant' });
});

// ─── DELETE /trips/:tripId/bookings/:bookingId ────────────────────────────────

describe('DELETE /trips/:tripId/bookings/:bookingId', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValue({ userId: undefined });
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/bookings/${BOOKING_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when trip belongs to a different consultant (IDOR)', async () => {
    mockTripData = null; // ownership check fails — trip not found for this consultant
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/bookings/${BOOKING_ID}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when booking does not exist', async () => {
    mockBookings = []; // no bookings
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/bookings/${BOOKING_ID}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('deletes the booking and returns 204', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/bookings/${BOOKING_ID}`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(204);
    expect(deletedBookingIds).toContain(BOOKING_ID);
  });
});

// ─── POST /trips/:tripId/bookings/manual ──────────────────────────────────────

describe('POST /trips/:tripId/bookings/manual', () => {
  const validBody = {
    booking_slug: 'park-guell-tour',
    booking_type: 'tour',
    booking_ref: 'PG001',
    date: '2026-06-11',
    start_time: '09:00',
    meeting_point_address: 'Park Güell main entrance',
    summary: 'Guided tour of Park Güell with skip-the-line access.',
    included_meals: false,
    included_transport: false,
  };

  it('returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValue({ userId: undefined });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/bookings/manual`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when trip belongs to a different consultant (IDOR)', async () => {
    mockTripData = null;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/bookings/manual`,
      headers: { authorization: 'Bearer test' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when booking_slug is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/bookings/manual`,
      headers: { authorization: 'Bearer test' },
      payload: { booking_type: 'tour' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when booking_type is invalid', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/bookings/manual`,
      headers: { authorization: 'Bearer test' },
      payload: { booking_slug: 'test', booking_type: 'invalid-type' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a booking and returns 201 with the new record', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/bookings/manual`,
      headers: { authorization: 'Bearer test' },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.booking_slug).toBe('park-guell-tour');
    expect(body.booking_type).toBe('tour');
    expect(insertedBookings.length).toBe(1);
    expect(insertedBookings[0].trip_id).toBe(TRIP_ID);
  });
});

// ─── GET /trips/:tripId/bookings ──────────────────────────────────────────────

describe('GET /trips/:tripId/bookings', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValue({ userId: undefined });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/bookings`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when trip belongs to a different consultant (IDOR)', async () => {
    mockTripData = null;
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/bookings`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns the booking list for the trip', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/bookings`,
      headers: { authorization: 'Bearer test' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
