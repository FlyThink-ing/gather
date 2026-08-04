-- =============================================================
-- 0008_project_cockpit.sql  项目驾驶舱、统一任务入口与项目生命周期（v2.14/v2.15）
-- 保留 0007 的项目负责人逐项审批规则；本迁移不读取 v2.12 已停用的验收字段。
-- =============================================================

alter table public.projects
  add column actual_started_at timestamptz,
  add column completed_at timestamptz;

comment on column public.projects.actual_started_at is
  '项目首次发生真实工作投入的时间；由最早工时段可靠回填并持续自动维护';
comment on column public.projects.completed_at is
  '项目最近一次完成时间；仅经 complete_project RPC 写入，重新打开后清空，历史保留在事件表';

-- 只使用真实工时段回填，不能用计划开始时间、created_at 或 updated_at 伪造。
update public.projects p
set actual_started_at = reliable.started_at
from (
  select t.project_id, min(ws.started_at) as started_at
  from public.task_work_segments ws
  join public.tasks t on t.id = ws.task_id
  where t.project_id is not null
  group by t.project_id
) reliable
where p.id = reliable.project_id
  and p.actual_started_at is null;

create index idx_projects_actual_started on public.projects(actual_started_at);
create index idx_projects_completed on public.projects(completed_at);

create table public.project_status_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type varchar(30) not null check (
    event_type in ('created', 'status_changed', 'completed', 'force_completed', 'reopened')
  ),
  from_status varchar(50) check (from_status in ('active', 'completed', 'paused')),
  to_status varchar(50) not null check (to_status in ('active', 'completed', 'paused')),
  actor_id uuid references public.developers(id) on delete set null,
  actor_name text not null,
  actor_role varchar(50) not null check (actor_role in ('admin', 'manager', 'user')),
  is_admin_force boolean not null default false,
  reason text,
  blocker_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint project_force_reason_required check (
    (not is_admin_force and reason is null)
    or (is_admin_force and length(trim(reason)) > 0)
  )
);

create index idx_project_status_events_project_created
  on public.project_status_events(project_id, created_at desc);

alter table public.project_status_events enable row level security;
alter table public.project_status_events force row level security;
create policy project_status_events_select on public.project_status_events
  for select to authenticated using (true);
grant select on public.project_status_events to authenticated;
revoke insert, update, delete on public.project_status_events from authenticated;

-- 项目负责人可以维护本人项目；完成动作仍只能走下方 RPC。
drop policy if exists proj_write on public.projects;
drop policy if exists proj_insert on public.projects;
drop policy if exists proj_update on public.projects;
drop policy if exists proj_delete on public.projects;
create policy proj_insert on public.projects for insert to authenticated
  with check (public.is_admin() or public.is_manager());
create policy proj_update on public.projects for update to authenticated
  using (
    public.is_admin() or public.is_manager()
    or owner_id = public.current_developer_id()
  )
  with check (
    public.is_admin() or public.is_manager()
    or owner_id = public.current_developer_id()
  );
create policy proj_delete on public.projects for delete to authenticated
  using (public.is_admin() or public.is_manager());

-- 任何真实工时段都会推进项目实际启动时间，取全项目最早值。
create or replace function public.track_project_actual_start()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.tasks where id = new.task_id;
  if v_project_id is not null then
    perform set_config('app.project_actual_start_automation', 'on', true);
    update public.projects
    set actual_started_at = case
      when actual_started_at is null then new.started_at
      else least(actual_started_at, new.started_at)
    end
    where id = v_project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_work_segments_project_start on public.task_work_segments;
create trigger trg_work_segments_project_start
  after insert or update of started_at, task_id on public.task_work_segments
  for each row execute function public.track_project_actual_start();

-- completed 状态不能由客户端直接写入；重新打开清空当前 completed_at，但事件记录不变。
create or replace function public.guard_project_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.actual_started_at is distinct from new.actual_started_at
     and coalesce(current_setting('app.project_actual_start_automation', true), '') <> 'on' then
    raise exception '项目实际启动时间由真实工时段自动维护，不能手工修改';
  end if;
  if old.status is distinct from new.status then
    if new.status = 'completed'
       and coalesce(current_setting('app.project_complete_rpc', true), '') <> 'on' then
      raise exception '完成项目必须使用项目完成操作，系统需要先检查未完成任务并记录审计';
    end if;
    if old.status = 'completed' and new.status <> 'completed' then
      new.completed_at := null;
    end if;
  end if;
  if old.completed_at is distinct from new.completed_at
     and coalesce(current_setting('app.project_complete_rpc', true), '') <> 'on'
     and not (old.status = 'completed' and new.status <> 'completed') then
    raise exception '项目完成时间只能由项目完成操作自动维护';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_lifecycle_guard on public.projects;
create trigger trg_projects_lifecycle_guard
  before update on public.projects
  for each row execute function public.guard_project_lifecycle();

create or replace function public.record_project_status_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor_name text;
  v_force boolean := coalesce(current_setting('app.project_admin_force', true), '') = 'on';
  v_reason text := nullif(trim(coalesce(current_setting('app.project_force_reason', true), '')), '');
  v_blockers jsonb := coalesce(nullif(current_setting('app.project_blockers', true), ''), '{}')::jsonb;
  v_event varchar(30);
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  select name into v_actor_name from public.developers where id = public.current_developer_id();
  v_event := case
    when tg_op = 'INSERT' then 'created'
    when new.status = 'completed' and v_force then 'force_completed'
    when new.status = 'completed' then 'completed'
    when old.status = 'completed' then 'reopened'
    else 'status_changed'
  end;
  insert into public.project_status_events (
    project_id, event_type, from_status, to_status,
    actor_id, actor_name, actor_role, is_admin_force, reason, blocker_snapshot
  ) values (
    new.id, v_event, case when tg_op = 'UPDATE' then old.status else null end, new.status,
    public.current_developer_id(), coalesce(v_actor_name, '系统/历史操作'), public.auth_role(),
    v_force, case when v_force then v_reason else null end,
    case when new.status = 'completed' then v_blockers else '{}'::jsonb end
  );
  return new;
end;
$$;

drop trigger if exists trg_projects_status_event on public.projects;
create trigger trg_projects_status_event
  after insert or update of status on public.projects
  for each row execute function public.record_project_status_event();

-- 项目完成：负责人正常完成；admin 仅在存在阻断项时可带原因强制完成。
create or replace function public.complete_project(
  p_project_id uuid,
  p_force boolean default false,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_project public.projects%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_unfinished_dev int;
  v_active_test int;
  v_review int;
  v_blockers jsonb;
  v_blocker_titles text;
begin
  if public.current_developer_id() is null then
    raise exception '当前账号未绑定人员档案，无法记录项目完成审计';
  end if;
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception '项目不存在'; end if;
  if v_project.status = 'completed' then raise exception '项目已经完成'; end if;
  if v_project.owner_id <> public.current_developer_id() and not public.is_admin() then
    raise exception '仅项目负责人可以完成项目；管理员仅处理异常代办';
  end if;
  if p_force and not public.is_admin() then raise exception '仅管理员可以强制完成项目'; end if;
  if p_force and v_reason is null then raise exception '管理员强制完成必须填写原因'; end if;
  if length(coalesce(v_reason, '')) > 2000 then raise exception '强制完成原因不能超过 2000 个字符'; end if;

  select
    count(*) filter (where task_type = 'dev' and status not in ('done', 'delayed_done')),
    count(*) filter (where task_type = 'test' and status not in ('done', 'delayed_done')),
    count(*) filter (where status = 'review')
  into v_unfinished_dev, v_active_test, v_review
  from public.tasks where project_id = p_project_id;

  v_blockers := jsonb_build_object(
    'unfinished_dev', v_unfinished_dev,
    'active_test', v_active_test,
    'review', v_review
  );

  select string_agg(format('%s（%s）', blocker.title, blocker.status), '、')
  into v_blocker_titles
  from (
    select title, status
    from public.tasks
    where project_id = p_project_id
      and (
        (task_type = 'dev' and status not in ('done', 'delayed_done'))
        or (task_type = 'test' and status not in ('done', 'delayed_done'))
        or status = 'review'
      )
    order by case when status = 'review' then 0 else 1 end, due_date nulls last, created_at
    limit 10
  ) blocker;
  v_blockers := v_blockers || jsonb_build_object('sample_tasks', coalesce(v_blocker_titles, ''));

  if (v_unfinished_dev > 0 or v_active_test > 0 or v_review > 0) and not p_force then
    raise exception '项目仍有阻断项：未完成开发任务 % 个、未完成测试任务 % 个、待审批 % 个。任务：%。请处理后完成；管理员异常场景可填写原因强制完成。',
      v_unfinished_dev, v_active_test, v_review, coalesce(v_blocker_titles, '无');
  end if;

  perform set_config('app.project_complete_rpc', 'on', true);
  perform set_config('app.project_admin_force', case when p_force then 'on' else 'off' end, true);
  perform set_config('app.project_force_reason', coalesce(v_reason, ''), true);
  perform set_config('app.project_blockers', v_blockers::text, true);

  update public.projects
  set status = 'completed', completed_at = now()
  where id = p_project_id;

  return v_blockers;
end;
$$;

revoke execute on function public.complete_project(uuid, boolean, text) from public;
grant execute on function public.complete_project(uuid, boolean, text) to authenticated;

-- 单个项目的严格指标口径。仅返回聚合，不返回项目下的全量任务明细。
create or replace function public.project_summary_json(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p) || jsonb_build_object(
    'plan_days', case when p.start_date is not null and p.end_date is not null and p.end_date >= p.start_date
      then (p.end_date - p.start_date) + 1 else null end,
    'actual_cycle_days', case
      when p.actual_started_at is null then null
      when p.status = 'completed' and p.completed_at is null then null
      else
      (coalesce(p.completed_at, now())::date - p.actual_started_at::date) + 1 end,
    'actual_effort_hours', round(coalesce(eff.hours, 0)::numeric, 1),
    'actual_effort_person_days', round((coalesce(eff.hours, 0) / 8.0)::numeric, 1),
    'dev_task_total', coalesce(ts.dev_total, 0),
    'dev_task_completed', coalesce(ts.dev_completed, 0),
    'dev_completion_rate', case when coalesce(ts.dev_total, 0) = 0 then null
      else round(ts.dev_completed * 100.0 / ts.dev_total, 1) end,
    'test_task_total', coalesce(ts.test_total, 0),
    'test_round_total', coalesce(qa.round_total, 0),
    'review_count', coalesce(ts.review_count, 0),
    'overdue_count', coalesce(ts.overdue_count, 0),
    'testing_active_count', coalesce(ts.testing_active_count, 0),
    'completed_task_count', coalesce(ts.completed_count, 0),
    'delayed_done_count', coalesce(ts.delayed_done_count, 0),
    'unassigned_count', coalesce(ts.unassigned_count, 0),
    'unfinished_dev_count', coalesce(ts.unfinished_dev_count, 0),
    'active_test_count', coalesce(ts.active_test_count, 0),
    'todo_count', coalesce(ts.todo_count, 0),
    'in_progress_count', coalesce(ts.in_progress_count, 0),
    'paused_count', coalesce(ts.paused_count, 0),
    'testing_status_count', coalesce(ts.testing_status_count, 0),
    'done_count', coalesce(ts.done_count, 0),
    'cumulative_bug_count', coalesce(qa.bug_count, 0),
    'reopen_count', coalesce(qa.reopen_count, 0),
    'failed_round_count', coalesce(qa.failed_round_count, 0),
    'blocked_round_count', coalesce(qa.blocked_round_count, 0),
    'test_pass_rate', case when coalesce(qa.concluded_rounds, 0) = 0 then null
      else round(qa.passed_rounds * 100.0 / qa.concluded_rounds, 1) end,
    'summary_covered_count', coalesce(qa.covered_test_tasks, 0),
    'summary_expected_count', coalesce(ts.concluded_test_tasks, 0),
    'summary_coverage_rate', case when coalesce(ts.concluded_test_tasks, 0) = 0 then null
      else round(coalesce(qa.covered_test_tasks, 0) * 100.0 / ts.concluded_test_tasks, 1) end
  )
  from public.projects p
  left join lateral (
    select
      count(*) filter (where t.task_type = 'dev')::int dev_total,
      count(*) filter (where t.task_type = 'dev' and t.status in ('done', 'delayed_done'))::int dev_completed,
      count(*) filter (where t.task_type = 'test')::int test_total,
      count(*) filter (where t.task_type = 'test' and t.test_result is not null)::int concluded_test_tasks,
      count(*) filter (where t.status = 'review')::int review_count,
      count(*) filter (where t.status not in ('done', 'delayed_done') and t.due_date < current_date)::int overdue_count,
      count(*) filter (where
        (t.task_type = 'dev' and t.status = 'testing') or
        (t.task_type = 'test' and t.status not in ('done', 'delayed_done') and t.test_result is null)
      )::int testing_active_count,
      count(*) filter (where t.status in ('done', 'delayed_done'))::int completed_count,
      count(*) filter (where t.status = 'delayed_done')::int delayed_done_count,
      count(*) filter (where t.developer_id is null)::int unassigned_count,
      count(*) filter (where t.task_type = 'dev' and t.status not in ('done', 'delayed_done'))::int unfinished_dev_count,
      count(*) filter (where t.task_type = 'test' and t.status not in ('done', 'delayed_done'))::int active_test_count,
      count(*) filter (where t.status = 'todo')::int todo_count,
      count(*) filter (where t.status = 'in_progress')::int in_progress_count,
      count(*) filter (where t.status = 'paused')::int paused_count,
      count(*) filter (where t.status = 'testing')::int testing_status_count,
      count(*) filter (where t.status = 'done')::int done_count
    from public.tasks t where t.project_id = p.id
  ) ts on true
  left join lateral (
    select sum(greatest(0, extract(epoch from (coalesce(ws.ended_at, now()) - ws.started_at))) / 3600.0) hours
    from public.task_work_segments ws
    join public.tasks t on t.id = ws.task_id
    where t.project_id = p.id
  ) eff on true
  left join lateral (
    select
      count(*)::int round_total,
      count(*) filter (where tr.result is not null)::int concluded_rounds,
      count(*) filter (where tr.result = 'pass')::int passed_rounds,
      count(*) filter (where tr.result = 'fail')::int failed_round_count,
      count(*) filter (where tr.blocked)::int blocked_round_count,
      coalesce(sum(tr.bug_count), 0)::int bug_count,
      coalesce(sum(tr.reopen_count), 0)::int reopen_count,
      count(distinct tr.test_task_id) filter (where tr.result is not null)::int covered_test_tasks
    from public.test_rounds tr
    join public.tasks tt on tt.id = tr.test_task_id
    where tt.project_id = p.id
  ) qa on true
  where p.id = p_project_id;
$$;

create or replace function public.get_project_summaries()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.project_summary_json(p.id) order by p.created_at desc), '[]'::jsonb)
  from public.projects p;
$$;

revoke execute on function public.project_summary_json(uuid) from public;
revoke execute on function public.get_project_summaries() from public;
grant execute on function public.get_project_summaries() to authenticated;

-- 项目详情：聚合 + 质量轮次 + 人员投入 + 生命周期时间线，所有子查询均限定 project_id。
create or replace function public.get_project_cockpit(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_summary jsonb;
  v_quality jsonb;
  v_people jsonb;
  v_timeline jsonb;
begin
  v_summary := public.project_summary_json(p_project_id);
  if v_summary is null then raise exception '项目不存在'; end if;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.summary_recorded desc, row_data.round_no desc nulls last, row_data.created_at desc), '[]'::jsonb)
  into v_quality
  from (
    select tr.id, tt.id test_task_id, tr.round_no, tr.test_method, tr.result, tr.blocked,
      tr.planned_case_count, tr.executed_case_count, tr.verification_scope, tr.verification_reason,
      tr.bug_count, tr.reopen_count, tr.note, tr.zentao_url, tr.started_at, tr.concluded_by, tr.concluded_at,
      (tr.id is not null) summary_recorded,
      tt.title test_task_title, tt.status test_task_status,
      tt.test_result, tt.developer_id tester_id, tester.name tester_name,
      dev.id linked_task_id, dev.title linked_task_title, tt.created_at
    from public.tasks tt
    left join public.test_rounds tr on tr.test_task_id = tt.id
    left join public.tasks dev on dev.id = tt.linked_task_id and dev.project_id = p_project_id
    left join public.developers tester on tester.id = tt.developer_id
    where tt.project_id = p_project_id and tt.task_type = 'test'
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(person_row) order by person_row.actual_effort_hours desc, person_row.person_name), '[]'::jsonb)
  into v_people
  from (
    select t.developer_id,
      coalesce(d.name, '未分配') person_name,
      d.position,
      count(*)::int task_count,
      count(*) filter (where t.task_type = 'dev')::int dev_task_count,
      count(*) filter (where t.task_type = 'test')::int test_task_count,
      count(*) filter (where t.status in ('done', 'delayed_done'))::int completed_task_count,
      count(*) filter (where t.status = 'review')::int review_task_count,
      count(*) filter (where t.status not in ('done', 'delayed_done') and t.due_date < current_date)::int overdue_task_count,
      round(coalesce(sum(seg.hours), 0)::numeric, 1) actual_effort_hours,
      round((coalesce(sum(seg.hours), 0) / 8.0)::numeric, 1) actual_effort_person_days
    from public.tasks t
    left join public.developers d on d.id = t.developer_id
    left join lateral (
      select sum(greatest(0, extract(epoch from (coalesce(ws.ended_at, now()) - ws.started_at))) / 3600.0) hours
      from public.task_work_segments ws where ws.task_id = t.id
    ) seg on true
    where t.project_id = p_project_id
    group by t.developer_id, d.name, d.position
  ) person_row;

  select coalesce(jsonb_agg(to_jsonb(event_row) order by event_row.occurred_at desc), '[]'::jsonb)
  into v_timeline
  from (
    select * from (
      select 'project_created'::text event_type, p.created_at occurred_at,
        '项目创建'::text title, null::text detail, null::uuid task_id
      from public.projects p where p.id = p_project_id
      union all
      select 'project_actual_started', p.actual_started_at, '项目实际启动', '来源：首个真实工时段', null::uuid
      from public.projects p where p.id = p_project_id and p.actual_started_at is not null
      union all
      select case when t.task_type = 'test' then 'test_concluded' else 'task_submitted' end,
        coalesce(t.submitted_at, t.completed_at),
        case when t.task_type = 'test' then '测试结论：' || t.title else '任务提交：' || t.title end,
        case when t.task_type = 'test' then coalesce(t.test_result, '') else t.status end,
        t.id
      from public.tasks t
      where t.project_id = p_project_id and coalesce(t.submitted_at, t.completed_at) is not null
      union all
      select 'task_approval', a.created_at,
        case when a.decision = 'approved' then '审批通过' else '审批驳回' end,
        a.actor_name || case when a.is_admin_proxy then '（管理员代办）' else '' end,
        a.task_id
      from public.task_approval_audits a where a.project_id = p_project_id
      union all
      select 'project_' || e.event_type, e.created_at,
        case e.event_type
          when 'completed' then '项目完成'
          when 'force_completed' then '管理员强制完成'
          when 'reopened' then '项目重新打开'
          else '项目状态变更'
        end,
        coalesce(e.reason, e.from_status || ' → ' || e.to_status), null::uuid
      from public.project_status_events e where e.project_id = p_project_id and e.event_type <> 'created'
    ) all_events
    order by occurred_at desc
    limit 100
  ) event_row;

  return v_summary || jsonb_build_object(
    'quality_rounds', v_quality,
    'people', v_people,
    'timeline', v_timeline
  );
end;
$$;

revoke execute on function public.get_project_cockpit(uuid) from public;
grant execute on function public.get_project_cockpit(uuid) to authenticated;

-- /tasks 唯一明细入口：在数据库侧完成范围、组合筛选、计数与分页。
create or replace function public.list_tasks(
  p_scope text default 'all',
  p_query text default null,
  p_task_type text default null,
  p_project_id uuid default null,
  p_statuses text[] default null,
  p_priority text default null,
  p_assignee text default null,
  p_team_id uuid default null,
  p_timing text default null,
  p_preset text default null,
  p_result text default null,
  p_blocked boolean default null,
  p_summary text default null,
  p_focus_id uuid default null,
  p_page int default 1,
  p_page_size int default 10
) returns jsonb language sql stable security definer set search_path = public as $$
  with filtered as (
    select t.*,
      round(coalesce(eff.hours, 0)::numeric, 1) actual_effort_hours,
      coalesce(days.day_count, 0)::int actual_day_count
    from public.tasks t
    left join public.projects p on p.id = t.project_id
    left join lateral (
      select sum(greatest(0, extract(epoch from (coalesce(ws.ended_at, now()) - ws.started_at))) / 3600.0) hours
      from public.task_work_segments ws where ws.task_id = t.id
    ) eff on true
    left join lateral (
      select count(distinct generated.work_day)::int day_count
      from public.task_work_segments ws
      cross join lateral generate_series(
        ws.started_at::date, coalesce(ws.ended_at, now())::date, interval '1 day'
      ) as generated(work_day)
      where ws.task_id = t.id
    ) days on true
    where
      (p_focus_id is null or t.id = p_focus_id)
      and (p_project_id is null or t.project_id = p_project_id)
      and (p_task_type is null or p_task_type = '' or t.task_type = p_task_type)
      and (p_statuses is null or cardinality(p_statuses) = 0 or t.status = any(p_statuses))
      and (p_priority is null or p_priority = '' or t.priority = p_priority)
      and (p_team_id is null or t.team_id = p_team_id)
      and (
        p_assignee is null or p_assignee = ''
        or (p_assignee = 'unassigned' and t.developer_id is null)
        or (p_assignee <> 'unassigned' and t.developer_id::text = p_assignee)
      )
      and (
        p_timing is null or p_timing = ''
        or (p_timing = 'overdue' and t.status not in ('done', 'delayed_done') and t.due_date < current_date)
        or (p_timing = 'delayed' and t.status = 'delayed_done')
      )
      and (
        p_preset is null or p_preset = ''
        or (p_preset = 'testing_active' and (
          (t.task_type = 'dev' and t.status = 'testing')
          or (t.task_type = 'test' and t.status not in ('done', 'delayed_done') and t.test_result is null)
        ))
      )
      and (p_result is null or p_result = '' or (t.task_type = 'test' and t.test_result = p_result))
      and (
        p_blocked is null or exists (
          select 1 from public.test_rounds tr where tr.test_task_id = t.id and tr.blocked = p_blocked
        )
      )
      and (
        p_summary is null or p_summary = ''
        or (p_summary = 'missing' and t.task_type = 'test' and t.test_result is not null and not exists (
          select 1 from public.test_rounds tr where tr.test_task_id = t.id and tr.result is not null
        ))
      )
      and (
        p_query is null or trim(p_query) = ''
        or t.title ilike '%' || trim(p_query) || '%'
        or coalesce(t.description, '') ilike '%' || trim(p_query) || '%'
        or coalesce(p.name, '') ilike '%' || trim(p_query) || '%'
      )
      and (
        coalesce(p_scope, 'all') = 'all'
        or (p_scope = 'mine' and t.developer_id = public.current_developer_id())
        or (p_scope = 'team' and (
          t.developer_id = public.current_developer_id()
          or t.team_id in (
            select dt.team_id from public.developer_teams dt
            where dt.developer_id = public.current_developer_id()
            union
            select tm.id from public.teams tm where tm.leader_id = public.current_developer_id()
          )
        ))
      )
  ), counted as (
    select filtered.*, count(*) over()::int total_count
    from filtered
  ), page_rows as (
    select * from counted
    order by created_at desc, id
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 10), 1), 100)
    limit least(greatest(coalesce(p_page_size, 10), 1), 100)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(r) - 'total_count' order by r.created_at desc, r.id) from page_rows r), '[]'::jsonb),
    'total', coalesce((select max(total_count) from counted), 0),
    'page', greatest(coalesce(p_page, 1), 1),
    'page_size', least(greatest(coalesce(p_page_size, 10), 1), 100)
  );
$$;

revoke execute on function public.list_tasks(text, text, text, uuid, text[], text, text, uuid, text, text, text, boolean, text, uuid, int, int) from public;
grant execute on function public.list_tasks(text, text, text, uuid, text[], text, text, uuid, text, text, text, boolean, text, uuid, int, int) to authenticated;
