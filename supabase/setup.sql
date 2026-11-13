-- ============================================================================
-- Event Registration App — Supabase setup script
-- Run this entire file once in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- Safe to re-run from scratch on a brand-new project.
-- ============================================================================

-- Needed for password hashing (crypt/gen_salt) and gen_random_uuid()
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

-- Singleton row holding event name, banner, question config, and hashed codes.
create table if not exists event_config (
  id int primary key default 1,
  event_name text not null default 'My Event',
  banner_url text,
  questions jsonb not null default '[]'::jsonb,
  desk_code_hash text not null,
  admin_code_hash text not null,
  updated_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);

-- Currently logged-in registration desks.
create table if not exists active_desks (
  desk_number int primary key,
  session_token uuid not null unique default gen_random_uuid(),
  last_heartbeat timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One row per registered attendee. `answers` holds whatever questions
-- were configured at the time of registration (dynamic, JSONB).
create table if not exists registrations (
  id bigserial primary key,
  desk_number int not null,
  session_token uuid,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_registrations_created_at on registrations (created_at);
create index if not exists idx_registrations_desk_number on registrations (desk_number);

-- Side table enforcing atomic duplicate-detection via a unique constraint.
-- One row per (question_key, normalized_value) pair, pointing back to the
-- registration it came from. The unique constraint is what makes duplicate
-- prevention race-proof across multiple simultaneous desks.
create table if not exists registration_dedup_keys (
  id bigserial primary key,
  question_key text not null,
  normalized_value text not null,
  registration_id bigint not null references registrations (id) on delete cascade,
  desk_number int not null,
  created_at timestamptz not null default now(),
  unique (question_key, normalized_value)
);

-- ----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY — deny all direct table access.
-- Every read/write happens through SECURITY DEFINER RPC functions below,
-- which run as the table owner and bypass RLS. The anon key therefore can
-- never read or write these tables directly, even though it holds the key.
-- ----------------------------------------------------------------------------

alter table event_config enable row level security;
alter table active_desks enable row level security;
alter table registrations enable row level security;
alter table registration_dedup_keys enable row level security;
-- No policies are created for anon/authenticated, so all direct access is denied by default.

-- ----------------------------------------------------------------------------
-- 3. SEED THE SINGLETON CONFIG ROW
-- Default codes are 'admin123' and 'desk123' — CHANGE THESE IMMEDIATELY
-- from the Admin Panel after your first login.
-- ----------------------------------------------------------------------------

insert into event_config (id, event_name, questions, desk_code_hash, admin_code_hash)
values (
  1,
  'My Event',
  '[
    {"key":"full_name","label":"Full Name","type":"text","required":true,"check_duplicate":false},
    {"key":"phone","label":"Phone Number","type":"tel","required":true,"check_duplicate":true},
    {"key":"email","label":"Email","type":"email","required":false,"check_duplicate":true}
  ]'::jsonb,
  crypt('desk123', gen_salt('bf')),
  crypt('admin123', gen_salt('bf'))
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. HELPER: normalize a raw value for duplicate comparison
-- ----------------------------------------------------------------------------

create or replace function normalize_value(p_value text, p_type text)
returns text
language plpgsql
immutable
as $$
declare
  v_digits text;
begin
  if p_value is null then
    return null;
  end if;

  if p_type = 'tel' then
    -- strip everything except digits
    v_digits := regexp_replace(p_value, '\D', '', 'g');
    -- compare on the last 9-10 digits so country-code / leading-zero
    -- variations of the same number still match
    if length(v_digits) > 10 then
      return right(v_digits, 10);
    else
      return v_digits;
    end if;
  else
    -- text, email, select, number: trim + lowercase
    return lower(trim(p_value));
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC: verify_access_code
-- Checks the submitted code against admin / desk hashes.
-- On a desk-code match, atomically assigns the lowest free desk number.
-- ----------------------------------------------------------------------------

create or replace function verify_access_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_hash text;
  v_desk_hash text;
  v_desk_number int;
  v_session_token uuid;
begin
  select admin_code_hash, desk_code_hash into v_admin_hash, v_desk_hash
  from event_config where id = 1;

  if v_admin_hash is not null and crypt(p_code, v_admin_hash) = v_admin_hash then
    return jsonb_build_object('role', 'admin');
  end if;

  if v_desk_hash is not null and crypt(p_code, v_desk_hash) = v_desk_hash then
    -- Serialize desk-assignment so two simultaneous logins can never
    -- compute the same "lowest free number" at once.
    perform pg_advisory_xact_lock(42424242);

    -- Release any desk that has gone silent for more than 3 minutes.
    delete from active_desks where last_heartbeat < now() - interval '3 minutes';

    -- Lowest integer >= 1 not currently taken.
    select min(n) into v_desk_number
    from generate_series(1, 500) n
    where not exists (select 1 from active_desks d where d.desk_number = n);

    if v_desk_number is null then
      raise exception 'no_desks_available';
    end if;

    v_session_token := gen_random_uuid();

    insert into active_desks (desk_number, session_token, last_heartbeat)
    values (v_desk_number, v_session_token, now());

    return jsonb_build_object(
      'role', 'desk',
      'desk_number', v_desk_number,
      'session_token', v_session_token
    );
  end if;

  return jsonb_build_object('role', 'invalid');
end;
$$;

grant execute on function verify_access_code(text) to anon;

-- ----------------------------------------------------------------------------
-- 6. RPC: resume_desk_session
-- Called on page load if sessionStorage already has a token, so a browser
-- refresh/reload doesn't orphan the old desk number for 3 minutes.
-- ----------------------------------------------------------------------------

create or replace function resume_desk_session(p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desk_number int;
begin
  update active_desks
  set last_heartbeat = now()
  where session_token = p_session_token
  returning desk_number into v_desk_number;

  if v_desk_number is null then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object('valid', true, 'desk_number', v_desk_number);
end;
$$;

grant execute on function resume_desk_session(uuid) to anon;

-- ----------------------------------------------------------------------------
-- 7. RPC: heartbeat_desk
-- ----------------------------------------------------------------------------

create or replace function heartbeat_desk(p_session_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update active_desks
  set last_heartbeat = now()
  where session_token = p_session_token;

  if not found then
    raise exception 'desk_expired';
  end if;
end;
$$;

grant execute on function heartbeat_desk(uuid) to anon;

-- ----------------------------------------------------------------------------
-- 8. RPC: release_desk (logout)
-- ----------------------------------------------------------------------------

create or replace function release_desk(p_session_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from active_desks where session_token = p_session_token;
end;
$$;

grant execute on function release_desk(uuid) to anon;

-- ----------------------------------------------------------------------------
-- 9. RPC: get_event_config
-- Public, non-secret event info needed to render the desk form.
-- ----------------------------------------------------------------------------

create or replace function get_event_config()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'event_name', event_name,
    'banner_url', banner_url,
    'questions', questions
  )
  from event_config where id = 1;
$$;

grant execute on function get_event_config() to anon;

-- ----------------------------------------------------------------------------
-- 10. RPC: get_desk_stats
-- Per-desk count and overall total, shown in the desk screen header.
-- ----------------------------------------------------------------------------

create or replace function get_desk_stats(p_desk_number int)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'desk_count', (select count(*) from registrations where desk_number = p_desk_number),
    'total_count', (select count(*) from registrations)
  );
$$;

grant execute on function get_desk_stats(int) to anon;

-- ----------------------------------------------------------------------------
-- 10b. RPC: check_duplicate_value
-- Used for the instant onBlur check on the desk form. This is a convenience
-- check only — the real, race-proof guarantee is the unique constraint
-- enforced inside submit_registration below.
-- ----------------------------------------------------------------------------

create or replace function check_duplicate_value(p_question_key text, p_value text, p_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text;
  v_conflict_desk int;
begin
  if p_value is null or length(trim(p_value)) = 0 then
    return jsonb_build_object('duplicate', false);
  end if;

  v_norm := normalize_value(p_value, p_type);

  select desk_number into v_conflict_desk
  from registration_dedup_keys
  where question_key = p_question_key and normalized_value = v_norm
  limit 1;

  if v_conflict_desk is not null then
    return jsonb_build_object('duplicate', true, 'desk_number', v_conflict_desk);
  end if;

  return jsonb_build_object('duplicate', false);
end;
$$;

grant execute on function check_duplicate_value(text, text, text) to anon;

-- ----------------------------------------------------------------------------
-- 11. RPC: submit_registration
-- Atomic insert + duplicate check in a single transaction. If any
-- check_duplicate field collides, the whole function raises and the
-- registration insert is rolled back — nothing is left behind.
-- ----------------------------------------------------------------------------

create or replace function submit_registration(p_session_token uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desk_number int;
  v_reg_id bigint;
  v_questions jsonb;
  v_q jsonb;
  v_key text;
  v_raw text;
  v_norm text;
  v_conflict_desk int;
begin
  select desk_number into v_desk_number from active_desks where session_token = p_session_token;
  if v_desk_number is null then
    raise exception 'invalid_session';
  end if;

  select questions into v_questions from event_config where id = 1;

  -- Pre-check so we can report a friendly "already registered at Desk X" message.
  for v_q in select * from jsonb_array_elements(v_questions) loop
    if coalesce((v_q->>'check_duplicate')::boolean, false) then
      v_key := v_q->>'key';
      v_raw := p_answers->>v_key;
      if v_raw is not null and length(trim(v_raw)) > 0 then
        v_norm := normalize_value(v_raw, v_q->>'type');
        select desk_number into v_conflict_desk
        from registration_dedup_keys
        where question_key = v_key and normalized_value = v_norm
        limit 1;
        if v_conflict_desk is not null then
          raise exception 'DUPLICATE|%|%', (v_q->>'label'), v_conflict_desk;
        end if;
      end if;
    end if;
  end loop;

  insert into registrations (desk_number, session_token, answers)
  values (v_desk_number, p_session_token, p_answers)
  returning id into v_reg_id;

  -- Insert dedup keys. The unique constraint is the real race-proof guard —
  -- the pre-check above just gives a nicer error message in the common case.
  for v_q in select * from jsonb_array_elements(v_questions) loop
    if coalesce((v_q->>'check_duplicate')::boolean, false) then
      v_key := v_q->>'key';
      v_raw := p_answers->>v_key;
      if v_raw is not null and length(trim(v_raw)) > 0 then
        v_norm := normalize_value(v_raw, v_q->>'type');
        begin
          insert into registration_dedup_keys (question_key, normalized_value, registration_id, desk_number)
          values (v_key, v_norm, v_reg_id, v_desk_number);
        exception when unique_violation then
          raise exception 'DUPLICATE|%|%', (v_q->>'label'), v_desk_number;
        end;
      end if;
    end if;
  end loop;

  update active_desks set last_heartbeat = now() where session_token = p_session_token;

  return jsonb_build_object('registration_id', v_reg_id, 'desk_number', v_desk_number);
end;
$$;

grant execute on function submit_registration(uuid, jsonb) to anon;

-- ----------------------------------------------------------------------------
-- 12. ADMIN RPCs
-- Admin has no persistent session — every admin RPC re-verifies the admin
-- code (passed from the client, kept in sessionStorage) against the hash.
-- ----------------------------------------------------------------------------

create or replace function check_admin(p_admin_code text)
returns void
language plpgsql
as $$
declare
  v_hash text;
begin
  select admin_code_hash into v_hash from event_config where id = 1;
  if v_hash is null or crypt(p_admin_code, v_hash) <> v_hash then
    raise exception 'invalid_admin_code';
  end if;
end;
$$;

-- 12a. Full dashboard snapshot
create or replace function admin_get_dashboard(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_desks jsonb;
  v_total bigint;
begin
  perform check_admin(p_admin_code);

  select event_name, banner_url, questions into v_config from event_config where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'desk_number', d.desk_number,
           'last_heartbeat', d.last_heartbeat,
           'registrations', (select count(*) from registrations r where r.desk_number = d.desk_number)
         ) order by d.desk_number), '[]'::jsonb)
  into v_desks
  from active_desks d;

  select count(*) into v_total from registrations;

  return jsonb_build_object(
    'event_name', v_config.event_name,
    'banner_url', v_config.banner_url,
    'questions', v_config.questions,
    'active_desks', v_desks,
    'total_registrations', v_total
  );
end;
$$;

grant execute on function admin_get_dashboard(text) to anon;

-- 12b. Update event name / banner
create or replace function admin_update_event(p_admin_code text, p_event_name text, p_banner_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_admin(p_admin_code);
  update event_config
  set event_name = coalesce(p_event_name, event_name),
      banner_url = p_banner_url,
      updated_at = now()
  where id = 1;
end;
$$;

grant execute on function admin_update_event(text, text, text) to anon;

-- 12c. Update the question list
create or replace function admin_update_questions(p_admin_code text, p_questions jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_admin(p_admin_code);
  update event_config
  set questions = p_questions,
      updated_at = now()
  where id = 1;
end;
$$;

grant execute on function admin_update_questions(text, jsonb) to anon;

-- 12d. Change desk code / admin code
create or replace function admin_update_codes(p_admin_code text, p_new_desk_code text, p_new_admin_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_admin(p_admin_code);

  if p_new_desk_code is not null and length(p_new_desk_code) > 0 then
    update event_config set desk_code_hash = crypt(p_new_desk_code, gen_salt('bf')) where id = 1;
  end if;

  if p_new_admin_code is not null and length(p_new_admin_code) > 0 then
    update event_config set admin_code_hash = crypt(p_new_admin_code, gen_salt('bf')) where id = 1;
  end if;

  update event_config set updated_at = now() where id = 1;
end;
$$;

grant execute on function admin_update_codes(text, text, text) to anon;

-- 12e. Force-release a desk
create or replace function admin_force_release_desk(p_admin_code text, p_desk_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_admin(p_admin_code);
  delete from active_desks where desk_number = p_desk_number;
end;
$$;

grant execute on function admin_force_release_desk(text, int) to anon;

-- 12f. Fetch all registrations for export (columns match current question config client-side)
create or replace function admin_get_registrations(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform check_admin(p_admin_code);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'desk_number', r.desk_number,
           'answers', r.answers,
           'created_at', r.created_at
         ) order by r.id), '[]'::jsonb)
  into v_rows
  from registrations r;

  return v_rows;
end;
$$;

grant execute on function admin_get_registrations(text) to anon;

-- 12g. Reset event: wipe registrations, dedup keys, active desks.
-- Returns the banner_url that was in place so the client can delete it from Storage.
create or replace function admin_reset_event(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_banner text;
begin
  perform check_admin(p_admin_code);

  select banner_url into v_banner from event_config where id = 1;

  truncate table registration_dedup_keys;
  truncate table registrations restart identity;
  truncate table active_desks;

  update event_config set banner_url = null, updated_at = now() where id = 1;

  return jsonb_build_object('old_banner_url', v_banner);
end;
$$;

grant execute on function admin_reset_event(text) to anon;

-- ----------------------------------------------------------------------------
-- 13. KEEPALIVE RPC
-- A harmless daily no-op write, called by the GitHub Actions cron job, so
-- the Supabase free-tier project is never auto-paused for inactivity.
-- ----------------------------------------------------------------------------

create or replace function keepalive_ping()
returns void
language sql
security definer
set search_path = public
as $$
  update event_config set updated_at = now() where id = 1;
$$;

grant execute on function keepalive_ping() to anon;

-- ----------------------------------------------------------------------------
-- 14. STORAGE BUCKET for the event banner
-- Run this part too — creates a public bucket for banner images.
-- NOTE: because admin auth here is a plain access code (not Supabase Auth),
-- storage policies can't be tied to the admin code. The bucket is public
-- for read (so the banner displays) and open for anon insert/update/delete
-- so the Admin Panel can upload/replace/remove it. This is an accepted
-- trade-off for a free-tier, no-backend-server app — don't put anything
-- in this bucket other than the event banner.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('event-banners', 'event-banners', true, 2097152) -- 2MB cap, banners are compressed to <150KB anyway
on conflict (id) do nothing;

drop policy if exists "Public read banners" on storage.objects;
create policy "Public read banners"
on storage.objects for select
using (bucket_id = 'event-banners');

drop policy if exists "Anon upload banners" on storage.objects;
create policy "Anon upload banners"
on storage.objects for insert
with check (bucket_id = 'event-banners');

drop policy if exists "Anon update banners" on storage.objects;
create policy "Anon update banners"
on storage.objects for update
using (bucket_id = 'event-banners');

drop policy if exists "Anon delete banners" on storage.objects;
create policy "Anon delete banners"
on storage.objects for delete
using (bucket_id = 'event-banners');

-- ============================================================================
-- DONE. Default login codes: admin = "admin123", desk = "desk123".
-- Log in as admin immediately and change both from the Admin Panel.
-- ============================================================================
