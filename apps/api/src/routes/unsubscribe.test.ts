import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../app';

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockUpdate = vi.fn();
const mockEq = vi.fn();

vi.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'consultants') {
        return {
          update: mockUpdate.mockReturnValue({
            eq: mockEq,
          }),
        };
      }
      return { update: vi.fn(), eq: vi.fn() };
    },
  }),
}));

// ── Clerk mock (unsubscribe is public, but Clerk plugin + consultant.ts still register) ──
vi.mock('@clerk/fastify', () => ({
  clerkPlugin: async () => {},
  getAuth: () => ({ userId: undefined }),
  createClerkClient: () => ({
    users: { getUser: async () => ({ firstName: '', lastName: '', emailAddresses: [] }) },
  }),
}));

// ── Token helpers (use real implementation so we test actual signing) ─────────
// ENCRYPTION_KEY must be set before the module is loaded; set it here.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

import { createUnsubscribeToken } from '../lib/unsubscribeToken';

// ─────────────────────────────────────────────────────────────────────────────

describe('unsubscribe route', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEq.mockResolvedValue({ error: null });
    app = await buildApp();
  });

  // ── Missing token ───────────────────────────────────────────────────────────

  it('GET /unsubscribe — 400 when token is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/unsubscribe' });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('missing a token');
  });

  // ── Invalid token ───────────────────────────────────────────────────────────

  it('GET /unsubscribe — 400 when token is malformed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/unsubscribe?token=notavalidtoken',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('invalid');
  });

  it('GET /unsubscribe — 400 when token signature is wrong', async () => {
    // Build a token for one consultant then tamper with the signature
    const validToken = createUnsubscribeToken('some-id');
    const tampered = validToken.slice(0, -4) + 'aaaa';
    const res = await app.inject({
      method: 'GET',
      url: `/unsubscribe?token=${encodeURIComponent(tampered)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('invalid');
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('GET /unsubscribe — 200 with HTML confirmation for valid token', async () => {
    const consultantId = 'c1000000-0000-0000-0000-000000000001';
    const token = createUnsubscribeToken(consultantId);

    const res = await app.inject({
      method: 'GET',
      url: `/unsubscribe?token=${encodeURIComponent(token)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain("You've been unsubscribed");
  });

  it('GET /unsubscribe — sets email_notifications=false for the correct consultant', async () => {
    const consultantId = 'c1000000-0000-0000-0000-000000000001';
    const token = createUnsubscribeToken(consultantId);

    await app.inject({
      method: 'GET',
      url: `/unsubscribe?token=${encodeURIComponent(token)}`,
    });

    expect(mockUpdate).toHaveBeenCalledWith({ email_notifications: false });
    expect(mockEq).toHaveBeenCalledWith('id', consultantId);
  });

  // ── DB error ────────────────────────────────────────────────────────────────

  it('GET /unsubscribe — 500 when DB update fails', async () => {
    mockEq.mockResolvedValue({ error: { message: 'connection lost' } });

    const token = createUnsubscribeToken('c1000000-0000-0000-0000-000000000001');
    const res = await app.inject({
      method: 'GET',
      url: `/unsubscribe?token=${encodeURIComponent(token)}`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('Something went wrong');
    // Internal error message must not be leaked
    expect(res.body).not.toContain('connection lost');
  });
});
