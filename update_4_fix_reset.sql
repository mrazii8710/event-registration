-- ============================================================================
-- Update #4 — run this in your Supabase SQL Editor.
-- Fixes "Failed to reset event." Nothing destructive on its own; safe to run
-- on your live project. Run this FIRST, then use "Reset Event" in the
-- Admin Panel to actually clear your test registrations.
--
-- Root cause: registration_dedup_keys has a foreign key into registrations.
-- The old function truncated them in two separate TRUNCATE statements;
-- Postgres refuses to truncate "registrations" alone while another table
-- still has a foreign key pointing at it, even if that table is already
-- empty. Fix: truncate every related table together in one statement.
-- ============================================================================

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

  update event_config set banner_url = null, updated_at = now() where id = 1;

  return jsonb_build_object('old_banner_url', v_banner);
end;
$$;

grant execute on function admin_reset_event(text) to anon;

-- ============================================================================
-- DONE.
-- ============================================================================
