-- ============================================================================
-- Update #2 — run this in your EXISTING Supabase project's SQL Editor.
-- Safe to run on a live project: only adds columns/replaces functions,
-- never drops or truncates anything.
--
-- Adds:
--   - Operator name capture at login (shows who ran each desk, in the export)
--   - Support for "group" (repeatable) questions, e.g. multiple students
--     per registration, each with their own sub-fields (Name, Age, etc.)
-- ============================================================================

-- 1. New columns
alter table active_desks add column if not exists operator_name text;
alter table registrations add column if not exists operator_name text;

-- 2. verify_access_code — now takes the operator's name and stores it
--    against the desk they're assigned. Admin logins can also pass a name;
--    it's just not used for anything on the admin side.
create or replace function verify_access_code(p_code text, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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
    perform pg_advisory_xact_lock(42424242);

    delete from active_desks where last_heartbeat < now() - interval '3 minutes';

    select min(n) into v_desk_number
    from generate_series(1, 500) n
    where not exists (select 1 from active_desks d where d.desk_number = n);

    if v_desk_number is null then
      raise exception 'no_desks_available';
    end if;

    v_session_token := gen_random_uuid();

    insert into active_desks (desk_number, session_token, last_heartbeat, operator_name)
    values (v_desk_number, v_session_token, now(), nullif(trim(p_name), ''));

    return jsonb_build_object(
      'role', 'desk',
      'desk_number', v_desk_number,
      'session_token', v_session_token,
      'operator_name', nullif(trim(p_name), '')
    );
  end if;

  return jsonb_build_object('role', 'invalid');
end;
$$;

grant execute on function verify_access_code(text, text) to anon;

-- Supabase/PostgREST can have both the old 1-arg version and this new 2-arg
-- version registered at once (different signatures = different functions).
-- Drop the old 1-arg one so the schema cache has no ambiguity.
drop function if exists verify_access_code(text);

-- 3. resume_desk_session — also return the operator name so a page refresh
--    still shows "Desk 2 — Aisha" instead of just the number.
create or replace function resume_desk_session(p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_desk_number int;
  v_operator_name text;
begin
  update active_desks
  set last_heartbeat = now()
  where session_token = p_session_token
  returning desk_number, operator_name into v_desk_number, v_operator_name;

  if v_desk_number is null then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object('valid', true, 'desk_number', v_desk_number, 'operator_name', v_operator_name);
end;
$$;

grant execute on function resume_desk_session(uuid) to anon;

-- 4. submit_registration — snapshot the operator's name onto the row, and
--    accept group-question answers (already just JSONB, no schema change
--    needed there — a group's answer is a JSON array of objects).
create or replace function submit_registration(p_session_token uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_desk_number int;
  v_operator_name text;
  v_reg_id bigint;
  v_questions jsonb;
  v_q jsonb;
  v_key text;
  v_raw text;
  v_norm text;
  v_conflict_desk int;
begin
  select desk_number, operator_name into v_desk_number, v_operator_name
  from active_desks where session_token = p_session_token;

  if v_desk_number is null then
    raise exception 'invalid_session';
  end if;

  select questions into v_questions from event_config where id = 1;

  -- Duplicate checks only apply to simple top-level fields (not inside
  -- repeatable groups) — see note in the admin panel / README.
  for v_q in select * from jsonb_array_elements(v_questions) loop
    if coalesce((v_q->>'type') <> 'group', true) and coalesce((v_q->>'check_duplicate')::boolean, false) then
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

  insert into registrations (desk_number, session_token, answers, operator_name)
  values (v_desk_number, p_session_token, p_answers, v_operator_name)
  returning id into v_reg_id;

  for v_q in select * from jsonb_array_elements(v_questions) loop
    if coalesce((v_q->>'type') <> 'group', true) and coalesce((v_q->>'check_duplicate')::boolean, false) then
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

-- 5. admin_get_dashboard — include each desk's operator name
create or replace function admin_get_dashboard(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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
           'operator_name', d.operator_name,
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

-- 6. admin_get_registrations — include operator_name per row
create or replace function admin_get_registrations(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows jsonb;
begin
  perform check_admin(p_admin_code);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'desk_number', r.desk_number,
           'operator_name', r.operator_name,
           'answers', r.answers,
           'created_at', r.created_at
         ) order by r.id), '[]'::jsonb)
  into v_rows
  from registrations r;

  return v_rows;
end;
$$;

grant execute on function admin_get_registrations(text) to anon;

-- ============================================================================
-- DONE. After running this, redeploy the new frontend build.
-- ============================================================================
