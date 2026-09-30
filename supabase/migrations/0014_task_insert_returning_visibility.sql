-- =============================================================
-- 0014_task_insert_returning_visibility.sql
-- Keep task visibility unchanged while allowing an authorized INSERT to use
-- PostgREST's return=representation in the same SQL command.
-- =============================================================

drop policy if exists task_select on public.tasks;
create policy task_select on public.tasks for select to authenticated using (
  public.is_admin()
  or developer_id = public.current_developer_id()
  or exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.owner_id = public.current_developer_id()
  )
  or exists (
    select 1
    from public.developer_teams member
    join public.teams led on led.id = member.team_id
    where member.developer_id = developer_id
      and led.leader_id = public.current_developer_id()
  )
  or (work_source = 'test_activity' and public.can_view_test_plan(test_plan_id))
  or (work_source = 'construction' and public.can_view_construction(construction_work_id))
);
