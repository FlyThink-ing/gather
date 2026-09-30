-- =============================================================
-- 0013_api_table_grants.sql
-- Make a fresh Supabase database reproducible by pairing the
-- existing RLS policies with the minimum PostgREST table grants.
-- =============================================================

-- Read access is still constrained by each table's SELECT policy.
grant select on all tables in schema public to authenticated;

-- Core tables that expose direct writes already have matching RLS policies.
grant insert, update, delete on table public.developer_teams to authenticated;
grant insert, update, delete on table public.developers to authenticated;
grant update, delete on table public.notifications to authenticated;
grant update on table public.profiles to authenticated;
grant insert, update on table public.projects to authenticated;
grant insert, update, delete on table public.task_comments to authenticated;
grant insert, update on table public.tasks to authenticated;
grant insert, update, delete on table public.teams to authenticated;
grant insert, update, delete on table public.user_roles to authenticated;

-- Project/task hard deletion remains unavailable. Test-domain writes and
-- audited corrections continue to go through their SECURITY DEFINER RPCs.
revoke delete on table public.projects, public.tasks from authenticated;

-- Trusted server-side clients need table access; RLS bypass is provided by
-- the built-in service_role itself, not by these grants.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
