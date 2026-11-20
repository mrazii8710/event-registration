-- ============================================================================
-- Update #5 — Pre-registration list (Excel) + attendance check-in
-- Run this whole file once in your Supabase SQL Editor. Safe on a live
-- project: it only adds a table/columns and replaces functions. It never
-- deletes registrations. Run update_4_fix_reset.sql first if you haven't.
--
-- Flow it enables:
--   Admin uploads the Google Form / Excel export as-is.
--   Desk searches by mobile number or name:
--     found      -> "Mark attendance" (atomic, can't be double-marked)
--     not found  -> the normal registration form (walk-in)
-- ============================================================================

-- 1. Where the list's column layout lives (jsonb keys have no order, so the
--    original column order is kept here for display and export).
alter table event_config add column if not exists prereg_columns    jsonb not null default '[]'::jsonb;
alter table event_config add column if not exists prereg_name_cols  jsonb not null default '[]'::jsonb;
alter table event_config add column if not exists prereg_phone_cols jsonb not null default '[]'::jsonb;
alter table event_config add column if not exists prereg_file_name  text;
alter table event_config add column if not exists prereg_uploaded_at timestamptz;

-- 2. One row per line of the uploaded sheet.
create table if not exists preregistrations (
  id bigserial primary key,
  row_no int not null,                         -- line number in the sheet (for export order)
  data jsonb not null,                         -- { "<column header>": "<cell text>", ... }
  search_name text not null default '',        -- lower-cased name columns, for name search
  phone_keys text[] not null default '{}',     -- last 9 digits of every number found
  phones_text text not null default '',        -- phone_keys joined, for partial-number search
  attended_at timestamptz,
  attended_desk int,
  attended_operator text,
  created_at timestamptz not null default now()
);

create index if not exists idx_prereg_row_no on preregistrations (row_no);
create index if not exists idx_prereg_attended on preregistrations (attended_at);

-- Same rule as every other table: no direct access with the public key.
alter table preregistrations enable row level security;

-- 3. Helpers --------------------------------------------------------------

-- Every phone number in the given columns, reduced to its last 9 digits so
-- 0532377647, 532377647, +966 53 237 7647 and 00966532377647 all match.
-- A cell can hold several numbers ("050.. / 055.."); text such as
-- "Same as Mobile Number" has no digits and is skipped.
create or replace function prereg_phone_keys(p_data jsonb, p_cols jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct right(x.d, 9)) filter (where length(x.d) >= 7), '{}')
  from jsonb_array_elements_text(coalesce(p_cols, '[]'::jsonb)) c(col)
  cross join lateral regexp_split_to_table(coalesce(p_data->>c.col, ''), '[/,;|\n]|\s+(or|and)\s+') part
  cross join lateral (select regexp_replace(part, '\D', '', 'g') as d) x;
$$;

create or replace function prereg_search_name(p_data jsonb, p_cols jsonb)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(string_agg(p_data->>c.col, ' '), '')), '\s+', ' ', 'g'))
  from jsonb_array_elements_text(coalesce(p_cols, '[]'::jsonb)) c(col);
$$;

create or replace function like_escape(p text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- 4. Desk-facing RPCs ------------------------------------------------------

-- get_event_config now also tells the desk whether a list is loaded and how
-- its columns are laid out. Existing keys are unchanged.
create or replace function get_event_config()
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'event_name', event_name,
    'banner_url', banner_url,
    'questions', questions,
    'prereg', jsonb_build_object(
      'total', (select count(*) from preregistrations),
      'columns', prereg_columns,
      'name_cols', prereg_name_cols,
      'phone_cols', prereg_phone_cols
    )
  )
  from event_config where id = 1;
$$;

grant execute on function get_event_config() to anon;

-- get_desk_stats: same keys as before plus check-in counts.
create or replace function get_desk_stats(p_desk_number int)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'desk_count', (select count(*) from registrations where desk_number = p_desk_number),
    'total_count', (select count(*) from registrations),
    'checkin_desk', (select count(*) from preregistrations where attended_desk = p_desk_number),
    'checkin_total', (select count(*) from preregistrations where attended_at is not null),
    'prereg_total', (select count(*) from preregistrations)
  );
$$;

grant execute on function get_desk_stats(int) to anon;

-- Search by mobile number (full or partial, any format) or by name (every
-- word must appear, any order). Needs a live desk session.
create or replace function desk_search_preregistrations(p_session_token uuid, p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_desk int;
  v_q text := lower(trim(coalesce(p_query, '')));
  v_core text;
  v_tokens text[];
  v_total int;
  v_rows jsonb;
begin
  select desk_number into v_desk from active_desks where session_token = p_session_token;
  if v_desk is null then
    raise exception 'invalid_session';
  end if;
  update active_desks set last_heartbeat = now() where session_token = p_session_token;

  if length(v_q) < 2 then
    return jsonb_build_object('mode', 'none', 'total', 0, 'results', '[]'::jsonb);
  end if;

  if v_q ~ '^[0-9\s\-\+\(\)\.]+$' then
    -- phone search: drop leading zeros, keep at most the last 9 digits
    v_core := right(ltrim(regexp_replace(v_q, '\D', '', 'g'), '0'), 9);
    if length(v_core) < 4 then
      return jsonb_build_object('mode', 'phone', 'too_short', true, 'total', 0, 'results', '[]'::jsonb);
    end if;

    select count(*) into v_total from preregistrations
    where phones_text like '%' || v_core || '%';

    select coalesce(jsonb_agg(r order by r_order), '[]'::jsonb) into v_rows from (
      select jsonb_build_object(
               'id', p.id, 'row_no', p.row_no, 'data', p.data,
               'attended_at', p.attended_at, 'attended_desk', p.attended_desk,
               'attended_operator', p.attended_operator,
               'exact', v_core = any(p.phone_keys)
             ) as r,
             (case when v_core = any(p.phone_keys) then 0 else 1 end) * 1000000 + p.row_no as r_order
      from preregistrations p
      where p.phones_text like '%' || v_core || '%'
      order by r_order
      limit 20
    ) s;

    return jsonb_build_object('mode', 'phone', 'total', v_total, 'results', v_rows);
  end if;

  -- name search
  select array_agg(t) into v_tokens
  from regexp_split_to_table(v_q, '\s+') t where length(t) > 0;

  select count(*) into v_total from preregistrations p
  where not exists (
    select 1 from unnest(v_tokens) t where p.search_name not like '%' || like_escape(t) || '%'
  );

  select coalesce(jsonb_agg(r order by r_order), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
             'id', p.id, 'row_no', p.row_no, 'data', p.data,
             'attended_at', p.attended_at, 'attended_desk', p.attended_desk,
             'attended_operator', p.attended_operator,
             'exact', false
           ) as r,
           (case when p.search_name like like_escape(v_q) || '%' then 0 else 1 end) * 1000000 + p.row_no as r_order
    from preregistrations p
    where not exists (
      select 1 from unnest(v_tokens) t where p.search_name not like '%' || like_escape(t) || '%'
    )
    order by r_order
    limit 20
  ) s;

  return jsonb_build_object('mode', 'name', 'total', v_total, 'results', v_rows);
end;
$$;

grant execute on function desk_search_preregistrations(uuid, text) to anon;

-- Mark one person present. The "attended_at is null" condition makes this
-- safe when two desks tap the same person at the same moment: only one wins,
-- the other gets status "already" with who/when.
create or replace function desk_mark_attendance(p_session_token uuid, p_prereg_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_desk int;
  v_operator text;
  v_at timestamptz;
  v_row record;
begin
  select desk_number, operator_name into v_desk, v_operator
  from active_desks where session_token = p_session_token;
  if v_desk is null then
    raise exception 'invalid_session';
  end if;
  update active_desks set last_heartbeat = now() where session_token = p_session_token;

  update preregistrations
  set attended_at = now(), attended_desk = v_desk, attended_operator = v_operator
  where id = p_prereg_id and attended_at is null
  returning attended_at into v_at;

  if v_at is not null then
    return jsonb_build_object('status', 'marked', 'attended_at', v_at, 'desk_number', v_desk);
  end if;

  select attended_at, attended_desk, attended_operator into v_row
  from preregistrations where id = p_prereg_id;
  if not found then
    raise exception 'not_found';
  end if;

  return jsonb_build_object(
    'status', 'already',
    'attended_at', v_row.attended_at,
    'desk_number', v_row.attended_desk,
    'operator_name', v_row.attended_operator
  );
end;
$$;

grant execute on function desk_mark_attendance(uuid, bigint) to anon;

-- Undo a mistaken tap: only the same desk, only within 10 minutes.
create or replace function desk_undo_attendance(p_session_token uuid, p_prereg_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_desk int;
begin
  select desk_number into v_desk from active_desks where session_token = p_session_token;
  if v_desk is null then
    raise exception 'invalid_session';
  end if;

  update preregistrations
  set attended_at = null, attended_desk = null, attended_operator = null
  where id = p_prereg_id
    and attended_desk = v_desk
    and attended_at > now() - interval '10 minutes';

  return jsonb_build_object('undone', found);
end;
$$;

grant execute on function desk_undo_attendance(uuid, bigint) to anon;

-- 5. Admin RPCs -------------------------------------------------------------

-- Import one batch of rows. The client sends the sheet in batches of a few
-- hundred rows; the first batch has p_replace = true, which clears the old
-- list (and its attendance marks) before inserting.
create or replace function admin_import_preregistrations(
  p_admin_code text,
  p_rows jsonb,
  p_replace boolean,
  p_columns jsonb,
  p_name_cols jsonb,
  p_phone_cols jsonb,
  p_file_name text,
  p_start_row int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inserted int;
begin
  perform check_admin(p_admin_code);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  if p_replace then
    truncate table preregistrations restart identity;
  end if;

  update event_config
  set prereg_columns = coalesce(p_columns, '[]'::jsonb),
      prereg_name_cols = coalesce(p_name_cols, '[]'::jsonb),
      prereg_phone_cols = coalesce(p_phone_cols, '[]'::jsonb),
      prereg_file_name = p_file_name,
      prereg_uploaded_at = now(),
      updated_at = now()
  where id = 1;

  insert into preregistrations (row_no, data, search_name, phone_keys, phones_text)
  select coalesce(p_start_row, 1) + (t.ord - 1)::int,
         t.elem,
         prereg_search_name(t.elem, p_name_cols),
         k.keys,
         array_to_string(k.keys, ' ')
  from jsonb_array_elements(p_rows) with ordinality t(elem, ord)
  cross join lateral (select prereg_phone_keys(t.elem, p_phone_cols) as keys) k
  where jsonb_typeof(t.elem) = 'object';

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('inserted', v_inserted, 'total', (select count(*) from preregistrations));
end;
$$;

grant execute on function admin_import_preregistrations(text, jsonb, boolean, jsonb, jsonb, jsonb, text, int) to anon;

-- Change which columns count as name / phone without re-uploading.
create or replace function admin_update_prereg_mapping(p_admin_code text, p_name_cols jsonb, p_phone_cols jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform check_admin(p_admin_code);

  update event_config
  set prereg_name_cols = coalesce(p_name_cols, '[]'::jsonb),
      prereg_phone_cols = coalesce(p_phone_cols, '[]'::jsonb),
      updated_at = now()
  where id = 1;

  update preregistrations
  set search_name = prereg_search_name(data, p_name_cols),
      phone_keys = prereg_phone_keys(data, p_phone_cols);

  update preregistrations set phones_text = array_to_string(phone_keys, ' ');

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_update_prereg_mapping(text, jsonb, jsonb) to anon;

-- Summary for the admin tab.
create or replace function admin_get_prereg_summary(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg record;
  v_recent jsonb;
begin
  perform check_admin(p_admin_code);

  select prereg_columns, prereg_name_cols, prereg_phone_cols, prereg_file_name, prereg_uploaded_at
  into v_cfg from event_config where id = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'data', data, 'attended_at', attended_at,
           'attended_desk', attended_desk, 'attended_operator', attended_operator
         ) order by attended_at desc), '[]'::jsonb)
  into v_recent
  from (
    select * from preregistrations where attended_at is not null
    order by attended_at desc limit 8
  ) r;

  return jsonb_build_object(
    'total', (select count(*) from preregistrations),
    'attended', (select count(*) from preregistrations where attended_at is not null),
    'walk_ins', (select count(*) from registrations),
    'no_phone', (select count(*) from preregistrations where cardinality(phone_keys) = 0),
    'columns', v_cfg.prereg_columns,
    'name_cols', v_cfg.prereg_name_cols,
    'phone_cols', v_cfg.prereg_phone_cols,
    'file_name', v_cfg.prereg_file_name,
    'uploaded_at', v_cfg.prereg_uploaded_at,
    'recent', v_recent
  );
end;
$$;

grant execute on function admin_get_prereg_summary(text) to anon;

-- Full list with attendance, for the Excel export.
create or replace function admin_get_preregistrations(p_admin_code text)
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
           'row_no', row_no, 'data', data, 'attended_at', attended_at,
           'attended_desk', attended_desk, 'attended_operator', attended_operator
         ) order by row_no), '[]'::jsonb)
  into v_rows
  from preregistrations;

  return jsonb_build_object(
    'columns', (select prereg_columns from event_config where id = 1),
    'rows', v_rows
  );
end;
$$;

grant execute on function admin_get_preregistrations(text) to anon;

-- Remove the list entirely.
create or replace function admin_clear_preregistrations(p_admin_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform check_admin(p_admin_code);
  truncate table preregistrations restart identity;
  update event_config
  set prereg_columns = '[]'::jsonb, prereg_name_cols = '[]'::jsonb, prereg_phone_cols = '[]'::jsonb,
      prereg_file_name = null, prereg_uploaded_at = null, updated_at = now()
  where id = 1;
end;
$$;

grant execute on function admin_clear_preregistrations(text) to anon;

-- Reset Event (includes the update_4 fix): also clears attendance marks but
-- KEEPS the uploaded list, so you can reset after a test run without
-- re-uploading the sheet. Use "Remove list" in the admin tab to drop it.
create or replace function admin_reset_event(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_banner text;
begin
  perform check_admin(p_admin_code);

  select banner_url into v_banner from event_config where id = 1;

  truncate table registration_dedup_keys, registrations, active_desks restart identity;

  update preregistrations
  set attended_at = null, attended_desk = null, attended_operator = null
  where attended_at is not null;

  update event_config set banner_url = null, updated_at = now() where id = 1;

  return jsonb_build_object('old_banner_url', v_banner);
end;
$$;

grant execute on function admin_reset_event(text) to anon;

-- ============================================================================
-- DONE. Now deploy the new frontend build, then upload your sheet from
-- Admin -> Pre-registered.
-- ============================================================================
