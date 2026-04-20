-- Trip Planner — initial schema
-- All tables use Clerk user ID (text) via auth.jwt() ->> 'sub' for RLS.
-- Clerk must be configured with a Supabase JWT template signed with this
-- project's JWT secret (Project Settings → API → JWT Settings).

-- ─────────────────────────────────────────────
-- consultants
-- ─────────────────────────────────────────────
create table consultants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null unique,
  auth_user_id text not null unique,  -- Clerk user ID (e.g. user_xxxx)
  created_at   timestamptz not null default now()
);

alter table consultants enable row level security;

create policy "consultants: own record only"
  on consultants for all
  using      (auth_user_id = (auth.jwt() ->> 'sub'))
  with check (auth_user_id = (auth.jwt() ->> 'sub'));

-- ─────────────────────────────────────────────
-- clients
-- ─────────────────────────────────────────────
create table clients (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text not null,
  consultant_id  uuid not null references consultants(id) on delete cascade,
  profile_json   jsonb,  -- full ClientProfile from profile-schema.json
  created_at     timestamptz not null default now()
);

alter table clients enable row level security;

create policy "clients: own consultant only"
  on clients for all
  using (
    consultant_id in (
      select id from consultants
      where auth_user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    consultant_id in (
      select id from consultants
      where auth_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ─────────────────────────────────────────────
-- trips
-- ─────────────────────────────────────────────
create table trips (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  destination         text not null,
  destination_slug    text not null,
  destination_country text not null default '',
  departure_city      text not null default '',
  start_date          date,
  end_date            date,
  duration_days       integer,
  purpose             text not null,
  purpose_notes       text not null default '',
  status              text not null default 'setup',
  documents_ingested  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table trips enable row level security;

create policy "trips: own clients only"
  on trips for all
  using (
    client_id in (
      select c.id from clients c
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    client_id in (
      select c.id from clients c
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  );

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_updated_at
  before update on trips
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────
-- trip_brief  (versioned JSONB — never updated, new row each time)
-- ─────────────────────────────────────────────
create table trip_brief (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  brief_json  jsonb not null,  -- encrypted at application level before insert
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  unique(trip_id, version)
);

alter table trip_brief enable row level security;

create policy "trip_brief: own trips only"
  on trip_brief for all
  using (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ─────────────────────────────────────────────
-- bookings
-- ─────────────────────────────────────────────
create table bookings (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references trips(id) on delete cascade,
  booking_slug          text not null,
  booking_type          text,
  booking_ref           text,
  date                  date,
  start_time            time,
  end_time              text,  -- text because values like "~13:30" appear in real data
  meeting_point_address text not null default '',
  drop_off_address      text not null default '',
  included_meals        boolean not null default false,
  included_transport    boolean not null default false,
  allergy_flags         jsonb,  -- encrypted at application level before insert
  consultant_flags      jsonb,
  raw_text              text,
  ingested_at           timestamptz not null default now(),
  unique(trip_id, booking_slug)
);

alter table bookings enable row level security;

create policy "bookings: own trips only"
  on bookings for all
  using (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ─────────────────────────────────────────────
-- itinerary_versions  (never deleted — version history is part of the product)
-- ─────────────────────────────────────────────
create table itinerary_versions (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references trips(id) on delete cascade,
  version_number        integer not null,
  markdown_content      text not null,
  generator_script_path text,
  docx_r2_key           text,  -- UUID key in R2; never the original filename
  created_at            timestamptz not null default now(),
  unique(trip_id, version_number)
);

alter table itinerary_versions enable row level security;

create policy "itinerary_versions: own trips only"
  on itinerary_versions for all
  using (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ─────────────────────────────────────────────
-- documents  (uploaded files and generated DOCX — stored in R2)
-- ─────────────────────────────────────────────
create table documents (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references trips(id) on delete cascade,
  doc_type          text not null,  -- 'booking_upload' | 'generated_docx'
  version           integer,
  r2_key            text not null,  -- UUID key — never the original filename
  original_filename text,
  created_at        timestamptz not null default now()
);

alter table documents enable row level security;

create policy "documents: own trips only"
  on documents for all
  using (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ─────────────────────────────────────────────
-- research_notes
-- ─────────────────────────────────────────────
create table research_notes (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id) on delete cascade,
  content_markdown text not null,
  model_used       text,
  input_tokens     integer,
  output_tokens    integer,
  created_at       timestamptz not null default now()
);

alter table research_notes enable row level security;

create policy "research_notes: own trips only"
  on research_notes for all
  using (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  )
  with check (
    trip_id in (
      select t.id from trips t
      join clients c on t.client_id = c.id
      join consultants con on c.consultant_id = con.id
      where con.auth_user_id = (auth.jwt() ->> 'sub')
    )
  );
