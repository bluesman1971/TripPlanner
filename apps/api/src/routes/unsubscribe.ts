import type { FastifyInstance } from 'fastify';
import { getDB } from '../services/db';
import { verifyUnsubscribeToken } from '../lib/unsubscribeToken';

// Returns a minimal HTML confirmation page — this is a link clicked from
// an email client, not a JSON API endpoint.
function successPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed — TripPlanner</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; padding: 40px; max-width: 480px; text-align: center; }
    h1 { margin: 0 0 12px; font-size: 22px; color: #111827; }
    p { margin: 0; font-size: 15px; color: #6b7280; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>You've been unsubscribed</h1>
    <p>You will no longer receive email notifications from TripPlanner.</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invalid link — TripPlanner</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; padding: 40px; max-width: 480px; text-align: center; }
    h1 { margin: 0 0 12px; font-size: 22px; color: #111827; }
    p { margin: 0; font-size: 15px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Invalid unsubscribe link</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export async function unsubscribeRoutes(app: FastifyInstance) {
  // GET /unsubscribe?token=...
  // Public endpoint — no Clerk auth required.
  // Verifies the HMAC-signed token and sets email_notifications=false for
  // the identified consultant. Returns an HTML confirmation page.
  app.get('/unsubscribe', async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply
        .status(400)
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(errorPage('This unsubscribe link is missing a token. Please use the link from your email.'));
    }

    const consultantId = verifyUnsubscribeToken(token);
    if (!consultantId) {
      return reply
        .status(400)
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(errorPage('This unsubscribe link is invalid or has been tampered with.'));
    }

    const supabase = getDB();
    const { error } = await supabase
      .from('consultants')
      .update({ email_notifications: false })
      .eq('id', consultantId);

    if (error) {
      app.log.error({ consultantId, error }, 'Failed to unsubscribe consultant');
      return reply
        .status(500)
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(errorPage('Something went wrong. Please try again or contact support.'));
    }

    return reply
      .status(200)
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(successPage());
  });
}
