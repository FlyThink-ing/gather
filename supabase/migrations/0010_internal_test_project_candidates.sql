-- 0010_internal_test_project_candidates.sql
-- v2.18.1 / D30：内部项目测试候选项目必须由服务端按同一口径筛选和复核。

create or replace function public.get_eligible_internal_test_projects(
  p_search text default null
) returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_actor uuid := public.current_developer_id();
  v_result jsonb;
begin
  if v_actor is null then
    raise exception '当前账号未绑定人员档案';
  end if;

  with assessed as (
    select
      p.id,
      p.name,
      p.team_id,
      tm.name as team_name,
      p.test_state,
      p.status,
      p.no_test_status,
      exists (
        select 1
        from public.test_plans tp
        join public.test_cycles tc on tc.plan_id = tp.id
        where tp.project_id = p.id
          and tc.status not in ('passed', 'failed', 'cancelled', 'returned')
      ) as has_active_cycle,
      (
        select count(*)::int
        from public.tasks task
        where task.project_id = p.id
          and task.task_type = 'dev'
          and task.status in ('done', 'delayed_done')
          and task.completed_at is not null
          and task.approved_by_user is not null
          and not exists (
            select 1
            from public.test_cycle_scope_tasks scope
            join public.test_cycles covered_cycle on covered_cycle.id = scope.cycle_id
            where scope.task_id = task.id
              and covered_cycle.status = 'passed'
          )
      ) as eligible_task_count
    from public.projects p
    join public.teams tm on tm.id = p.team_id
    where p.owner_id = v_actor
  )
  select jsonb_build_object(
    'items',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name,
          'team_id', team_id,
          'team_name', team_name,
          'test_state', test_state,
          'eligible_task_count', eligible_task_count
        )
        order by name
      ) filter (
        where status = 'active'
          and no_test_status <> 'approved'
          and not has_active_cycle
          and eligible_task_count > 0
          and (nullif(trim(coalesce(p_search, '')), '') is null or name ilike '%' || trim(p_search) || '%')
      ),
      '[]'::jsonb
    ),
    'owned_project_count', count(*)::int,
    'inactive_count', count(*) filter (where status <> 'active')::int,
    'no_test_approved_count', count(*) filter (where no_test_status = 'approved')::int,
    'active_cycle_count', count(*) filter (where has_active_cycle)::int,
    'no_eligible_task_count', count(*) filter (where eligible_task_count = 0)::int
  )
  into v_result
  from assessed;

  return v_result;
end;
$$;

revoke all on function public.get_eligible_internal_test_projects(text) from public;
grant execute on function public.get_eligible_internal_test_projects(text) to authenticated;

-- 保留 0009 原实现作为内部实现；新入口先按 D30 做完整复核。
alter function public.create_test_plan(
  text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]
) rename to create_test_plan_v218;

revoke all on function public.create_test_plan_v218(
  text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]
) from public;
revoke all on function public.create_test_plan_v218(
  text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]
) from authenticated;

create or replace function public.create_test_plan(
  p_source text,
  p_title text,
  p_test_team_id uuid,
  p_project_id uuid default null,
  p_external_project_name text default null,
  p_external_owner_name text default null,
  p_version_name text default null,
  p_test_scope text default null,
  p_test_goal text default null,
  p_deliverables text default null,
  p_expected_start date default null,
  p_expected_end date default null,
  p_environment_note text default null,
  p_priority text default 'medium',
  p_related_url text default null,
  p_zentao_url text default null,
  p_recommended_owner_id uuid default null,
  p_report_types text[] default array[]::text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_developer_id();
  v_project public.projects%rowtype;
  v_eligible_task_count int;
begin
  if p_source = 'internal_project' then
    if v_actor is null then
      raise exception '当前账号未绑定人员档案';
    end if;

    select * into v_project
    from public.projects
    where id = p_project_id;

    if not found then
      raise exception '内部项目不存在';
    end if;
    if v_project.owner_id <> v_actor then
      raise exception '仅项目负责人可以发起内部项目测试，管理员暂不支持代办';
    end if;
    if v_project.status <> 'active' then
      raise exception '已完成或已暂停项目不能发起测试';
    end if;
    if v_project.no_test_status = 'approved' then
      raise exception '项目已批准无需测试，请先按流程撤销原决定';
    end if;
    if exists (
      select 1
      from public.test_plans tp
      join public.test_cycles tc on tc.plan_id = tp.id
      where tp.project_id = p_project_id
        and tc.status not in ('passed', 'failed', 'cancelled', 'returned')
    ) then
      raise exception '该项目已有未结束的测试轮次';
    end if;

    select count(*)::int into v_eligible_task_count
    from public.tasks task
    where task.project_id = p_project_id
      and task.task_type = 'dev'
      and task.status in ('done', 'delayed_done')
      and task.completed_at is not null
      and task.approved_by_user is not null
      and not exists (
        select 1
        from public.test_cycle_scope_tasks scope
        join public.test_cycles covered_cycle on covered_cycle.id = scope.cycle_id
        where scope.task_id = task.id
          and covered_cycle.status = 'passed'
      );

    if v_eligible_task_count = 0 then
      raise exception '没有已审批完成且未被通过轮次覆盖的开发任务';
    end if;
  end if;

  return public.create_test_plan_v218(
    p_source,
    p_title,
    p_test_team_id,
    p_project_id,
    p_external_project_name,
    p_external_owner_name,
    p_version_name,
    p_test_scope,
    p_test_goal,
    p_deliverables,
    p_expected_start,
    p_expected_end,
    p_environment_note,
    p_priority,
    p_related_url,
    p_zentao_url,
    p_recommended_owner_id,
    p_report_types
  );
end;
$$;

revoke all on function public.create_test_plan(
  text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]
) from public;
grant execute on function public.create_test_plan(
  text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]
) to authenticated;

