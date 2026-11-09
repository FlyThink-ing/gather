-- Team members may select an active team project when creating their own
-- development task, before they have any tasks in that project.
create or replace function public.can_create_own_team_project_task(p_project_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.projects p
    join public.developer_teams m on m.team_id = p.team_id
    where p.id = p_project_id
      and p.team_id = p_team_id
      and p.status = 'active'
      and m.developer_id = public.current_developer_id()
  );
$$;

create or replace function public.get_task_creation_projects()
returns table (id uuid, name varchar, team_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.team_id
  from public.projects p
  where p.status = 'active'
    and (
      public.can_view_project(p.id)
      or public.can_create_own_team_project_task(p.id, p.team_id)
    )
  order by p.name, p.id;
$$;

revoke all on function public.can_create_own_team_project_task(uuid, uuid) from public, anon;
revoke all on function public.get_task_creation_projects() from public, anon;
grant execute on function public.can_create_own_team_project_task(uuid, uuid) to authenticated;
grant execute on function public.get_task_creation_projects() to authenticated;

alter policy task_insert on public.tasks with check (
  task_type = 'dev'
  and work_source = 'development'
  and linked_task_id is null
  and test_result is null
  and test_note is null
  and test_plan_id is null
  and test_cycle_id is null
  and test_activity_id is null
  and construction_work_id is null
  and construction_task_id is null
  and (
    public.is_admin()
    or (
      (project_id is null or public.can_view_project(project_id))
      and (
        developer_id = public.current_developer_id()
        or (
          public.is_manager()
          and exists (
            select 1
            from public.developer_teams member
            join public.teams led on led.id = member.team_id
            where member.developer_id = tasks.developer_id
              and led.leader_id = public.current_developer_id()
          )
        )
      )
    )
    or (
      developer_id = public.current_developer_id()
      and public.can_create_own_team_project_task(project_id, team_id)
    )
  )
);

notify pgrst, 'reload schema';
