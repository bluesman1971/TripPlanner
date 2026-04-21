/**
 * Transactional email — powered by Resend.
 *
 * All send functions are fire-and-forget: errors are logged but never thrown,
 * so a failing email never blocks or errors the HTTP response.
 *
 * If RESEND_API_KEY is absent (dev / test), every send is a no-op.
 */
import { Resend } from 'resend';
import { createUnsubscribeToken } from '../lib/unsubscribeToken';

// ── Config ────────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  return process.env.APP_URL
    || process.env.CORS_ORIGIN
    || 'http://localhost:5174';
}

function getApiBaseUrl(): string {
  return process.env.API_URL || 'http://localhost:3000';
}

function getFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || 'TripPlanner <notifications@tripplanner.app>';
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailConsultant {
  id: string;
  name: string;
  email: string;
  email_notifications: boolean;
}

// ── Core sender ───────────────────────────────────────────────────────────────

async function send({
  consultant,
  subject,
  html,
}: {
  consultant: EmailConsultant;
  subject: string;
  html: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;           // no-op in dev/test
  if (!consultant.email_notifications) return;        // consultant opted out
  if (!consultant.email) return;                      // no address on record

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const unsubscribeUrl = `${getApiBaseUrl()}/unsubscribe?token=${createUnsubscribeToken(consultant.id)}`;

    await resend.emails.send({
      from: getFromAddress(),
      to: consultant.email,
      subject,
      html: wrapTemplate(html, unsubscribeUrl),
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  } catch (err) {
    // Never throw — email failure must not disrupt the main request
    console.error('[email] Failed to send:', (err as Error).message);
  }
}

// ── HTML wrapper ──────────────────────────────────────────────────────────────

function wrapTemplate(body: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TripPlanner</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#1d4ed8;padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">TripPlanner</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              You're receiving this because you use TripPlanner.<br>
              <a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe from these emails</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Button helper ─────────────────────────────────────────────────────────────

function ctaButton(text: string, url: string): string {
  return `<p style="margin:24px 0 0;">
    <a href="${url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:6px;text-decoration:none;">${text}</a>
  </p>`;
}

// ── Public send functions ─────────────────────────────────────────────────────

export async function sendTripCreatedEmail(
  consultant: EmailConsultant,
  trip: { id: string; destination: string },
): Promise<void> {
  const tripUrl = `${getBaseUrl()}/trips/${trip.id}`;
  await send({
    consultant,
    subject: `New trip created: ${trip.destination}`,
    html: `
      <h2 style="margin:0 0 8px;font-size:22px;color:#111827;">Trip created</h2>
      <p style="margin:0;font-size:15px;color:#374151;">
        Your new trip to <strong>${trip.destination}</strong> is ready. Upload booking documents
        to get started.
      </p>
      ${ctaButton('Open trip', tripUrl)}
    `,
  });
}

export async function sendDraftReadyEmail(
  consultant: EmailConsultant,
  trip: { id: string; destination: string },
  versionNumber: number,
): Promise<void> {
  const tripUrl = `${getBaseUrl()}/trips/${trip.id}`;
  await send({
    consultant,
    subject: `Itinerary draft ready: ${trip.destination}`,
    html: `
      <h2 style="margin:0 0 8px;font-size:22px;color:#111827;">Itinerary draft ready</h2>
      <p style="margin:0;font-size:15px;color:#374151;">
        Version ${versionNumber} of the itinerary for <strong>${trip.destination}</strong>
        has been generated and is ready for your review.
      </p>
      ${ctaButton('Review draft', tripUrl)}
    `,
  });
}

export async function sendDocumentReadyEmail(
  consultant: EmailConsultant,
  trip: { id: string; destination: string },
  versionNumber: number,
): Promise<void> {
  const tripUrl = `${getBaseUrl()}/trips/${trip.id}`;
  await send({
    consultant,
    subject: `Document ready: ${trip.destination}`,
    html: `
      <h2 style="margin:0 0 8px;font-size:22px;color:#111827;">Document ready to download</h2>
      <p style="margin:0;font-size:15px;color:#374151;">
        The Word document (v${versionNumber}) for your <strong>${trip.destination}</strong>
        itinerary has been generated and is ready to download.
      </p>
      ${ctaButton('Download document', tripUrl)}
    `,
  });
}
