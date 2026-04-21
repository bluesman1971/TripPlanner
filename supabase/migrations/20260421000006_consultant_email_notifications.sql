-- Add opt-out column for email notifications.
-- Defaults to true (opted in). Consultants can unsubscribe via the
-- one-click link in any notification email.
ALTER TABLE consultants
  ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;
