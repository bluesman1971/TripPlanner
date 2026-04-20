-- Sprint 1 Week 6: convert allergy_flags and raw_text to encrypted text
-- allergy_flags was JSONB; encrypted ciphertext must be stored as TEXT.
-- raw_text was already TEXT — no type change needed there.
-- Existing rows (if any) will have NULL allergy_flags after cast.

alter table bookings
  alter column allergy_flags type text using null;

comment on column bookings.allergy_flags is
  'AES-256-GCM encrypted JSON (enc:v1:iv:tag:ciphertext). Contains dietary/allergy PII.';

comment on column bookings.raw_text is
  'AES-256-GCM encrypted text (enc:v1:iv:tag:ciphertext). Full booking confirmation text.';
