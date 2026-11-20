-- ============================================================================
-- Update #3 — run this in your Supabase SQL Editor.
-- Adds one new RPC, admin_get_analytics, powering the Admin Dashboard tab.
-- Nothing destructive; safe to run on a live project.
-- ============================================================================

create or replace function admin_get_analytics(p_admin_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_questions jsonb;
  v_total bigint;
  v_today bigint;
  v_last_hour bigint;
  v_hourly jsonb;
  v_by_desk jsonb;
  v_select_breakdown jsonb := '[]'::jsonb;
  v_q jsonb;
  v_key text;
  v_label text;
  v_options jsonb;
begin
  perform check_admin(p_admin_code);

  select questions into v_questions from event_config where id = 1;

  select count(*) into v_total from registrations;
  select count(*) into v_today from registrations where created_at >= date_trunc('day', now());
  select count(*) into v_last_hour from registrations where created_at >= now() - interval '1 hour';

  -- Hourly buckets, last 24 hours (local to the database's time zone setting).
  select coalesce(jsonb_agg(jsonb_build_object(
           'hour_label', to_char(h, 'HH24:00'),
           'count', coalesce(c.cnt, 0)
         ) order by h), '[]'::jsonb)
  into v_hourly
  from generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') h
  left join (
    select date_trunc('hour', created_at) as bucket, count(*) as cnt
    from registrations
    where created_at >= date_trunc('hour', now()) - interval '23 hours'
    group by 1
  ) c on c.bucket = h;

  -- Per-desk totals, all time, busiest first.
  select coalesce(jsonb_agg(jsonb_build_object('desk_number', desk_number, 'count', cnt) order by cnt desc), '[]'::jsonb)
  into v_by_desk
  from (
    select desk_number, count(*) as cnt from registrations group by desk_number
  ) d;

  -- Answer breakdown for every select-type question currently configured.
  for v_q in select * from jsonb_array_elements(v_questions) loop
    if (v_q->>'type') = 'select' then
      v_key := v_q->>'key';
      v_label := v_q->>'label';

      select coalesce(jsonb_agg(jsonb_build_object('option', opt, 'count', cnt) order by cnt desc), '[]'::jsonb)
      into v_options
      from (
        select (answers->>v_key) as opt, count(*) as cnt
        from registrations
        where answers ? v_key and length(trim(answers->>v_key)) > 0
        group by 1
      ) t;

      v_select_breakdown := v_select_breakdown || jsonb_build_object('key', v_key, 'label', v_label, 'options', v_options);
    end if;
  end loop;

  return jsonb_build_object(
    'total_registrations', v_total,
    'today_count', v_today,
    'last_hour_count', v_last_hour,
    'hourly', v_hourly,
    'by_desk', v_by_desk,
    'select_breakdown', v_select_breakdown
  );
end;
$$;

grant execute on function admin_get_analytics(text) to anon;

-- ============================================================================
-- DONE.
-- ============================================================================
