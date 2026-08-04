-- =============================================================
-- v2.16-v2.18：统一测试中心、项目/阶段/版本测试轮次与测试建设工作
-- 依赖 0001-0008。旧 test_rounds/测试任务仅保留历史读取，不做伪造回填。
-- 已废弃的 acceptance_* / requires_acceptance 列继续保留历史值，但不参与任何判断。
-- =============================================================

alter table public.teams
  add column is_test_team boolean not null default false;

alter table public.projects
  add column requires_testing boolean not null default true,
  add column test_state text not null default 'not_requested'
    check (test_state in ('not_requested','requested','scheduled','testing','fixing','passed','no_test_approved')),
  add column no_test_status text not null default 'none'
    check (no_test_status in ('none','pending','approved','rejected')),
  add column no_test_reason text,
  add column no_test_related_url text,
  add column no_test_submitted_by uuid references public.developers(id) on delete set null,
  add column no_test_submitted_at timestamptz,
  add column no_test_decided_by uuid references public.developers(id) on delete set null,
  add column no_test_decided_at timestamptz,
  add column no_test_decision_note text;

alter table public.projects
  add constraint projects_no_test_reason_valid check (
    no_test_status = 'none'
    or (length(trim(coalesce(no_test_reason, ''))) between 10 and 1000)
  ),
  add constraint projects_no_test_url_valid check (
    no_test_related_url is null or no_test_related_url ~* '^https?://\S+$'
  );

alter table public.tasks
  add column work_source text not null default 'development'
    check (work_source in ('development','legacy_single_test','test_activity','construction'));
update public.tasks set work_source = 'legacy_single_test' where task_type = 'test';

alter table public.task_work_segments
  add column entry_source text not null default 'automatic'
    check (entry_source in ('automatic','manual')),
  add column note text,
  add column created_by uuid references public.developers(id) on delete set null;

create table public.test_plans (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('internal_project','external_request')),
  title varchar(255) not null,
  project_id uuid references public.projects(id) on delete restrict,
  external_project_name varchar(255),
  external_owner_name varchar(120),
  version_name varchar(200),
  test_scope text not null,
  test_goal text not null,
  deliverables text,
  expected_start date,
  expected_end date,
  environment_note text,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  related_url text,
  zentao_url text,
  test_team_id uuid not null references public.teams(id) on delete restrict,
  recommended_owner_id uuid references public.developers(id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested','returned','accepted','in_progress','paused','conclusion_pending','passed','failed','cancelled')),
  created_by uuid references public.developers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_plans_source_fields check (
    (source = 'internal_project' and project_id is not null and external_project_name is null and external_owner_name is null)
    or
    (source = 'external_request' and project_id is null
      and length(trim(coalesce(external_project_name, ''))) > 0
      and length(trim(coalesce(external_owner_name, ''))) > 0)
  ),
  constraint test_plans_dates check (expected_start is null or expected_end is null or expected_end >= expected_start),
  constraint test_plans_urls check (
    (related_url is null or related_url ~* '^https?://\S+$')
    and (zentao_url is null or zentao_url ~* '^https?://\S+$')
  )
);
create trigger trg_test_plans_updated before update on public.test_plans
  for each row execute function public.set_updated_at();
create index idx_test_plans_project on public.test_plans(project_id);
create index idx_test_plans_source_status on public.test_plans(source, status);

create table public.test_cycles (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.test_plans(id) on delete cascade,
  cycle_no int not null check (cycle_no > 0),
  stage_version varchar(200) not null,
  scope_note text,
  status text not null default 'requested'
    check (status in ('requested','returned','accepted','in_progress','paused','conclusion_pending','passed','failed','cancelled')),
  planned_start date,
  planned_end date,
  actual_started_at timestamptz,
  actual_completed_at timestamptz,
  main_tester_id uuid references public.developers(id) on delete set null,
  submitted_by uuid references public.developers(id) on delete set null,
  submitted_at timestamptz,
  schedule_decided_by uuid references public.developers(id) on delete set null,
  schedule_decided_at timestamptz,
  schedule_note text,
  pause_reason text,
  cancel_reason text,
  proposed_result text check (proposed_result in ('pass','fail')),
  conclusion_scope text,
  conclusion_completion text,
  conclusion_new_issues text,
  conclusion_legacy_issues text,
  conclusion_blockers text,
  conclusion_risks text,
  release_recommendation text,
  conclusion_submitted_by uuid references public.developers(id) on delete set null,
  conclusion_submitted_at timestamptz,
  conclusion_confirmed_by uuid references public.developers(id) on delete set null,
  conclusion_confirmed_at timestamptz,
  conclusion_return_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, cycle_no),
  constraint test_cycles_dates check (planned_start is null or planned_end is null or planned_end >= planned_start)
);
create trigger trg_test_cycles_updated before update on public.test_cycles
  for each row execute function public.set_updated_at();
create index idx_test_cycles_plan on public.test_cycles(plan_id, cycle_no desc);
create index idx_test_cycles_main on public.test_cycles(main_tester_id, status);

create table public.test_cycle_scope_tasks (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.test_cycles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  task_title_snapshot varchar(255) not null,
  task_status_snapshot varchar(50) not null,
  task_owner_snapshot varchar(120),
  approved_by_snapshot varchar(120),
  approved_at_snapshot timestamptz,
  created_at timestamptz not null default now(),
  unique (cycle_id, task_id)
);

create table public.test_cycle_participants (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.test_cycles(id) on delete cascade,
  developer_id uuid not null references public.developers(id) on delete restrict,
  participant_role text not null default 'participant' check (participant_role in ('main','participant')),
  planned_hours numeric(10,2) not null default 0 check (planned_hours >= 0 and planned_hours <= 100000),
  created_at timestamptz not null default now(),
  unique (cycle_id, developer_id)
);

create table public.test_activities (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.test_cycles(id) on delete cascade,
  activity_type text not null check (activity_type in ('smoke','system','regression','performance','compatibility','security','other')),
  title varchar(255) not null,
  owner_id uuid not null references public.developers(id) on delete restrict,
  planned_start date not null,
  planned_end date not null,
  planned_hours numeric(10,2) not null default 0 check (planned_hours >= 0 and planned_hours <= 100000),
  preconditions text,
  expected_deliverable text,
  status text not null default 'todo' check (status in ('todo','in_progress','paused','done','cancelled')),
  created_by uuid references public.developers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_activities_dates check (planned_end >= planned_start)
);
create trigger trg_test_activities_updated before update on public.test_activities
  for each row execute function public.set_updated_at();

create table public.test_activity_participants (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.test_activities(id) on delete cascade,
  developer_id uuid not null references public.developers(id) on delete restrict,
  planned_hours numeric(10,2) not null default 0 check (planned_hours >= 0 and planned_hours <= 100000),
  created_at timestamptz not null default now(),
  unique (activity_id, developer_id)
);

create table public.test_execution_batches (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.test_cycles(id) on delete cascade,
  activity_id uuid references public.test_activities(id) on delete set null,
  executed_on date not null,
  executor_id uuid not null references public.developers(id) on delete restrict,
  environment_name varchar(255) not null,
  build_version varchar(255) not null,
  test_type text not null check (test_type in ('smoke','system','regression','performance','compatibility','security','other')),
  planned_count int not null default 0 check (planned_count between 0 and 1000000),
  executed_count int not null default 0 check (executed_count between 0 and 1000000),
  passed_count int not null default 0 check (passed_count between 0 and 1000000),
  failed_count int not null default 0 check (failed_count between 0 and 1000000),
  blocked_count int not null default 0 check (blocked_count between 0 and 1000000),
  skipped_count int not null default 0 check (skipped_count between 0 and 1000000),
  bug_count int not null default 0 check (bug_count between 0 and 1000000),
  reopen_count int not null default 0 check (reopen_count between 0 and 1000000),
  smoke_passed boolean,
  issue_summary text,
  blocker_summary text,
  risk_summary text,
  zentao_url text,
  created_by uuid references public.developers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_batch_count_sum check (passed_count + failed_count + blocked_count + skipped_count = executed_count),
  constraint test_batch_url check (zentao_url is null or zentao_url ~* '^https?://\S+$')
);
create trigger trg_test_batches_updated before update on public.test_execution_batches
  for each row execute function public.set_updated_at();
create index idx_test_batches_cycle on public.test_execution_batches(cycle_id, executed_on);

create table public.test_execution_batch_audits (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.test_execution_batches(id) on delete cascade,
  actor_id uuid references public.developers(id) on delete set null,
  reason text not null,
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create table public.test_reports (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.test_cycles(id) on delete cascade,
  report_type text not null check (report_type in ('system','performance','security','compatibility','other')),
  report_name varchar(255) not null,
  is_required boolean not null default false,
  status text not null default 'pending' check (status in ('pending','issued','not_issued')),
  not_issued_reason text,
  updated_by uuid references public.developers(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (cycle_id, report_type, report_name),
  constraint test_report_missing_reason check (status <> 'not_issued' or length(trim(coalesce(not_issued_reason, ''))) > 0)
);

create table public.test_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.test_plans(id) on delete cascade,
  cycle_id uuid references public.test_cycles(id) on delete set null,
  event_type text not null,
  actor_id uuid references public.developers(id) on delete set null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.project_no_test_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null check (event_type in ('submitted','withdrawn','approved','rejected')),
  actor_id uuid references public.developers(id) on delete set null,
  reason text,
  related_url text,
  created_at timestamptz not null default now()
);

create table public.test_construction_works (
  id uuid primary key default gen_random_uuid(),
  title varchar(255) not null,
  work_type text not null check (work_type in ('automation_framework','automation_script','tooling','environment','data_preparation','platform','other')),
  goal text not null,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  owner_id uuid not null references public.developers(id) on delete restrict,
  planned_start date,
  planned_end date,
  deliverables text not null,
  acceptance_criteria text not null,
  resource_links text,
  risk_note text,
  blocker_note text,
  adjustment_note text,
  status text not null default 'draft'
    check (status in ('draft','pending_schedule','active','paused','pending_acceptance','completed','cancelled')),
  completion_note text,
  created_by uuid references public.developers(id) on delete set null,
  schedule_confirmed_by uuid references public.developers(id) on delete set null,
  schedule_confirmed_at timestamptz,
  result_confirmed_by uuid references public.developers(id) on delete set null,
  result_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_dates check (planned_start is null or planned_end is null or planned_end >= planned_start)
);
create trigger trg_construction_updated before update on public.test_construction_works
  for each row execute function public.set_updated_at();

create table public.test_construction_participants (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.test_construction_works(id) on delete cascade,
  developer_id uuid not null references public.developers(id) on delete restrict,
  participant_role text not null default 'participant' check (participant_role in ('owner','participant')),
  planned_hours numeric(10,2) not null default 0 check (planned_hours >= 0 and planned_hours <= 100000),
  created_at timestamptz not null default now(),
  unique (work_id, developer_id)
);

create table public.test_construction_tasks (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.test_construction_works(id) on delete cascade,
  title varchar(255) not null,
  owner_id uuid not null references public.developers(id) on delete restrict,
  planned_start date not null,
  planned_end date not null,
  planned_hours numeric(10,2) not null default 0 check (planned_hours >= 0 and planned_hours <= 100000),
  progress int not null default 0 check (progress between 0 and 100),
  status text not null default 'todo' check (status in ('todo','in_progress','paused','done','cancelled')),
  created_by uuid references public.developers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_task_dates check (planned_end >= planned_start)
);
create trigger trg_construction_tasks_updated before update on public.test_construction_tasks
  for each row execute function public.set_updated_at();

create table public.test_construction_events (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.test_construction_works(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.developers(id) on delete set null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.tasks
  add column test_plan_id uuid references public.test_plans(id) on delete set null,
  add column test_cycle_id uuid references public.test_cycles(id) on delete set null,
  add column test_activity_id uuid references public.test_activities(id) on delete set null,
  add column construction_work_id uuid references public.test_construction_works(id) on delete set null,
  add column construction_task_id uuid references public.test_construction_tasks(id) on delete set null;
alter table public.test_activities
  add column task_id uuid references public.tasks(id) on delete set null;
alter table public.test_construction_tasks
  add column task_id uuid references public.tasks(id) on delete set null;

create table public.test_cycle_repair_tasks (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.test_cycles(id) on delete cascade,
  scope_task_id uuid references public.tasks(id) on delete set null,
  repair_task_id uuid not null references public.tasks(id) on delete restrict,
  created_by uuid references public.developers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cycle_id, repair_task_id)
);

create index idx_tasks_test_plan on public.tasks(test_plan_id);
create index idx_tasks_construction on public.tasks(construction_work_id);
create index idx_construction_status on public.test_construction_works(status);

-- ---------- 权限辅助 ----------
create or replace function public.is_test_worker()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.developers d
    where d.id = public.current_developer_id() and d.is_active
      and d.position in ('测试工程师','自动化测试工程师')
  );
$$;

create or replace function public.is_automation_tester()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.developers d
    where d.id = public.current_developer_id() and d.is_active
      and d.position = '自动化测试工程师'
  );
$$;

create or replace function public.is_test_lead(p_team_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams t
    where t.is_test_team and t.leader_id = public.current_developer_id()
      and (p_team_id is null or t.id = p_team_id)
  );
$$;

create or replace function public.can_view_test_plan(p_plan_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_test_worker()
    or exists (
      select 1 from public.test_plans tp
      left join public.projects p on p.id = tp.project_id
      where tp.id = p_plan_id and (
        tp.created_by = public.current_developer_id()
        or p.owner_id = public.current_developer_id()
        or exists (
          select 1 from public.test_cycles tc
          left join public.test_cycle_participants tcp on tcp.cycle_id = tc.id
          where tc.plan_id = tp.id
            and (tc.main_tester_id = public.current_developer_id() or tcp.developer_id = public.current_developer_id())
        )
      )
    );
$$;

create or replace function public.can_view_construction(p_work_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_test_worker()
    or exists (
      select 1 from public.test_construction_works w
      left join public.test_construction_participants cp on cp.work_id = w.id
      where w.id = p_work_id and (
        w.created_by = public.current_developer_id()
        or w.owner_id = public.current_developer_id()
        or cp.developer_id = public.current_developer_id()
      )
    );
$$;

-- ---------- RLS：直接写入全部关闭，变更只允许走 RPC ----------
do $$
declare t text;
begin
  foreach t in array array[
    'test_plans','test_cycles','test_cycle_scope_tasks','test_cycle_participants',
    'test_activities','test_activity_participants','test_execution_batches',
    'test_execution_batch_audits','test_reports','test_plan_events',
    'project_no_test_events','test_construction_works','test_construction_participants',
    'test_construction_tasks','test_construction_events','test_cycle_repair_tasks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy test_plans_read on public.test_plans for select to authenticated
  using (public.can_view_test_plan(id));
create policy test_cycles_read on public.test_cycles for select to authenticated
  using (public.can_view_test_plan(plan_id));
create policy test_scope_read on public.test_cycle_scope_tasks for select to authenticated
  using (exists (select 1 from public.test_cycles c where c.id = cycle_id and public.can_view_test_plan(c.plan_id)));
create policy test_participants_read on public.test_cycle_participants for select to authenticated
  using (exists (select 1 from public.test_cycles c where c.id = cycle_id and public.can_view_test_plan(c.plan_id)));
create policy test_activities_read on public.test_activities for select to authenticated
  using (exists (select 1 from public.test_cycles c where c.id = cycle_id and public.can_view_test_plan(c.plan_id)));
create policy test_activity_people_read on public.test_activity_participants for select to authenticated
  using (exists (
    select 1 from public.test_activities a join public.test_cycles c on c.id = a.cycle_id
    where a.id = activity_id and public.can_view_test_plan(c.plan_id)
  ));
create policy test_batches_read on public.test_execution_batches for select to authenticated
  using (exists (select 1 from public.test_cycles c where c.id = cycle_id and public.can_view_test_plan(c.plan_id)));
create policy test_batch_audits_read on public.test_execution_batch_audits for select to authenticated
  using (exists (
    select 1 from public.test_execution_batches b join public.test_cycles c on c.id = b.cycle_id
    where b.id = batch_id and public.can_view_test_plan(c.plan_id)
  ));
create policy test_reports_read on public.test_reports for select to authenticated
  using (exists (select 1 from public.test_cycles c where c.id = cycle_id and public.can_view_test_plan(c.plan_id)));
create policy test_events_read on public.test_plan_events for select to authenticated
  using (public.can_view_test_plan(plan_id));
create policy no_test_events_read on public.project_no_test_events for select to authenticated using (true);
create policy construction_read on public.test_construction_works for select to authenticated
  using (public.can_view_construction(id));
create policy construction_people_read on public.test_construction_participants for select to authenticated
  using (public.can_view_construction(work_id));
create policy construction_tasks_read on public.test_construction_tasks for select to authenticated
  using (public.can_view_construction(work_id));
create policy construction_events_read on public.test_construction_events for select to authenticated
  using (public.can_view_construction(work_id));
create policy repair_links_read on public.test_cycle_repair_tasks for select to authenticated
  using (exists (select 1 from public.test_cycles c where c.id = cycle_id and public.can_view_test_plan(c.plan_id)));

-- ---------- 新测试计划 / 新轮次 ----------
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
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.current_developer_id();
  v_plan_id uuid;
  v_cycle_id uuid;
  v_owner uuid;
  v_cycle_no int;
  v_report text;
begin
  if v_actor is null then raise exception '当前账号未绑定人员档案'; end if;
  if p_source not in ('internal_project','external_request') then raise exception '测试来源无效'; end if;
  if length(trim(coalesce(p_title,''))) = 0 then raise exception '请填写测试计划名称'; end if;
  if length(trim(coalesce(p_test_scope,''))) = 0 or length(trim(coalesce(p_test_goal,''))) = 0 then
    raise exception '测试范围和测试目标必填';
  end if;
  if not exists (select 1 from public.teams where id = p_test_team_id and is_test_team) then
    raise exception '请选择已标记的测试小组';
  end if;
  if p_source = 'internal_project' then
    select owner_id into v_owner from public.projects where id = p_project_id;
    if not found then raise exception '内部项目不存在'; end if;
    if v_owner <> v_actor and not public.is_admin() then raise exception '仅项目负责人可以发起内部项目测试'; end if;
    if exists (
      select 1 from public.test_plans tp join public.test_cycles tc on tc.plan_id = tp.id
      where tp.project_id = p_project_id and tc.status not in ('passed','failed','cancelled','returned')
    ) then raise exception '该项目已有未结束的测试轮次'; end if;
    if not exists (
      select 1 from public.tasks t
      where t.project_id = p_project_id and t.task_type = 'dev' and t.status in ('done','delayed_done')
    ) then raise exception '测试范围必须至少包含一个已审批完成的开发任务'; end if;
  else
    if not (public.is_test_worker() or public.is_test_lead(p_test_team_id) or public.is_admin()) then
      raise exception '仅测试人员、测试组长或管理员可以登记外部测试';
    end if;
    if length(trim(coalesce(p_external_project_name,''))) = 0
      or length(trim(coalesce(p_external_owner_name,''))) = 0 then
      raise exception '外部项目名称和项目负责人必填';
    end if;
  end if;

  insert into public.test_plans (
    source,title,project_id,external_project_name,external_owner_name,version_name,
    test_scope,test_goal,deliverables,expected_start,expected_end,environment_note,
    priority,related_url,zentao_url,test_team_id,recommended_owner_id,created_by
  ) values (
    p_source,trim(p_title),case when p_source='internal_project' then p_project_id else null end,
    case when p_source='external_request' then trim(p_external_project_name) else null end,
    case when p_source='external_request' then trim(p_external_owner_name) else null end,
    nullif(trim(coalesce(p_version_name,'')),''),
    trim(p_test_scope),trim(p_test_goal),nullif(trim(coalesce(p_deliverables,'')),''),
    p_expected_start,p_expected_end,nullif(trim(coalesce(p_environment_note,'')),''),
    p_priority,nullif(trim(coalesce(p_related_url,'')),''),
    nullif(trim(coalesce(p_zentao_url,'')),''),
    p_test_team_id,p_recommended_owner_id,v_actor
  ) returning id into v_plan_id;

  insert into public.test_cycles(plan_id,cycle_no,stage_version,scope_note,status,submitted_by,submitted_at)
  values (v_plan_id,1,coalesce(nullif(trim(coalesce(p_version_name,'')),''),'首轮测试'),trim(p_test_scope),'requested',v_actor,now())
  returning id into v_cycle_id;

  if p_source = 'internal_project' then
    insert into public.test_cycle_scope_tasks(
      cycle_id,task_id,task_title_snapshot,task_status_snapshot,task_owner_snapshot,
      approved_by_snapshot,approved_at_snapshot
    )
    select v_cycle_id,t.id,t.title,t.status,d.name,approver.name,t.completed_at
    from public.tasks t
    left join public.developers d on d.id=t.developer_id
    left join public.developers approver on approver.id=t.approved_by_user
    where t.project_id=p_project_id and t.task_type='dev'
      and t.status in ('done','delayed_done')
      and not exists (
        select 1 from public.test_cycle_scope_tasks old_scope
        join public.test_cycles old_cycle on old_cycle.id=old_scope.cycle_id
        where old_scope.task_id=t.id and old_cycle.status='passed'
      );
    perform set_config('app.test_center_rpc','on',true);
    update public.projects set requires_testing=true,test_state='requested',no_test_status='none',
      no_test_reason=null,no_test_related_url=null,no_test_decision_note=null
    where id=p_project_id;
  end if;

  foreach v_report in array coalesce(p_report_types,array[]::text[]) loop
    if v_report in ('system','performance','security','compatibility','other') then
      insert into public.test_reports(cycle_id,report_type,report_name,is_required)
      values(v_cycle_id,v_report,
        case v_report when 'system' then '系统测试报告' when 'performance' then '性能测试报告'
          when 'security' then '安全测试报告' when 'compatibility' then '兼容性测试报告' else '其他测试报告' end,
        true) on conflict do nothing;
    end if;
  end loop;
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,payload)
  values(v_plan_id,v_cycle_id,'requested',v_actor,jsonb_build_object('source',p_source));
  perform public.notify((select leader_id from public.teams where id=p_test_team_id),'test_plan_requested',
    jsonb_build_object('plan_id',v_plan_id,'title',trim(p_title)));
  return v_plan_id;
end;
$$;

create or replace function public.create_test_cycle(
  p_plan_id uuid,
  p_stage_version text,
  p_scope_note text default null,
  p_report_types text[] default array[]::text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plan public.test_plans%rowtype;
  v_actor uuid := public.current_developer_id();
  v_cycle uuid;
  v_no int;
  v_report text;
begin
  select * into v_plan from public.test_plans where id=p_plan_id for update;
  if not found then raise exception '测试计划不存在'; end if;
  if v_plan.source='internal_project'
    and not exists(select 1 from public.projects where id=v_plan.project_id and owner_id=v_actor)
    and not public.is_admin() then raise exception '仅项目负责人可以发起新一轮测试'; end if;
  if v_plan.source='external_request' and not (public.is_test_worker() or public.is_admin()) then
    raise exception '仅测试人员可以发起外部项目新轮次';
  end if;
  if exists(select 1 from public.test_cycles where plan_id=p_plan_id and status not in ('passed','failed','cancelled','returned')) then
    raise exception '当前仍有未结束轮次';
  end if;
  select coalesce(max(cycle_no),0)+1 into v_no from public.test_cycles where plan_id=p_plan_id;
  insert into public.test_cycles(plan_id,cycle_no,stage_version,scope_note,status,submitted_by,submitted_at)
  values(p_plan_id,v_no,trim(p_stage_version),nullif(trim(coalesce(p_scope_note,'')),''),'requested',v_actor,now())
  returning id into v_cycle;
  if v_plan.source='internal_project' then
    insert into public.test_cycle_scope_tasks(cycle_id,task_id,task_title_snapshot,task_status_snapshot,task_owner_snapshot,approved_by_snapshot,approved_at_snapshot)
    select v_cycle,t.id,t.title,t.status,d.name,a.name,t.completed_at
    from public.tasks t left join public.developers d on d.id=t.developer_id
    left join public.developers a on a.id=t.approved_by_user
    where t.project_id=v_plan.project_id and t.task_type='dev' and t.status in ('done','delayed_done')
      and not exists(
        select 1 from public.test_cycle_scope_tasks s join public.test_cycles c on c.id=s.cycle_id
        where s.task_id=t.id and c.status='passed'
      );
    if not found then raise exception '没有新增的已审批开发任务可纳入本轮测试'; end if;
    perform set_config('app.test_center_rpc','on',true);
    update public.projects set test_state='requested' where id=v_plan.project_id;
  end if;
  foreach v_report in array coalesce(p_report_types,array[]::text[]) loop
    if v_report in ('system','performance','security','compatibility','other') then
      insert into public.test_reports(cycle_id,report_type,report_name,is_required)
      values(v_cycle,v_report,v_report,true);
    end if;
  end loop;
  update public.test_plans set status='requested' where id=p_plan_id;
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id) values(p_plan_id,v_cycle,'requested',v_actor);
  perform public.notify((select leader_id from public.teams where id=v_plan.test_team_id),'test_cycle_requested',
    jsonb_build_object('plan_id',p_plan_id,'cycle_id',v_cycle,'title',v_plan.title));
  return v_cycle;
end;
$$;

create or replace function public.review_test_schedule(
  p_cycle_id uuid,
  p_accept boolean,
  p_main_tester_id uuid default null,
  p_planned_start date default null,
  p_planned_end date default null,
  p_participants jsonb default '[]'::jsonb,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cycle public.test_cycles%rowtype;
  v_plan public.test_plans%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id for update;
  if not found then raise exception '测试轮次不存在'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if not (public.is_test_lead(v_plan.test_team_id) or public.is_admin()) then raise exception '仅测试组长可以确认排期'; end if;
  if v_cycle.status not in ('requested','returned') then raise exception '当前状态不能确认排期'; end if;
  if not p_accept then
    if v_reason is null then raise exception '退回排期必须填写原因'; end if;
    update public.test_cycles set status='returned',schedule_note=v_reason,schedule_decided_by=public.current_developer_id(),schedule_decided_at=now() where id=p_cycle_id;
    update public.test_plans set status='returned' where id=v_cycle.plan_id;
    insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,reason) values(v_cycle.plan_id,p_cycle_id,'schedule_returned',public.current_developer_id(),v_reason);
    perform public.notify(v_cycle.submitted_by,'test_schedule_returned',jsonb_build_object('plan_id',v_cycle.plan_id,'cycle_id',p_cycle_id,'reason',v_reason));
    return;
  end if;
  if p_main_tester_id is null or p_planned_start is null or p_planned_end is null or p_planned_end<p_planned_start then
    raise exception '请指定主测试负责人和有效的计划日期';
  end if;
  if not exists(select 1 from public.developers where id=p_main_tester_id and is_active and position in ('测试工程师','自动化测试工程师')) then
    raise exception '主测试负责人必须是在职测试人员';
  end if;
  delete from public.test_cycle_participants where cycle_id=p_cycle_id;
  insert into public.test_cycle_participants(cycle_id,developer_id,participant_role,planned_hours)
  values(p_cycle_id,p_main_tester_id,'main',0);
  insert into public.test_cycle_participants(cycle_id,developer_id,participant_role,planned_hours)
  select p_cycle_id,x.developer_id,'participant',greatest(0,coalesce(x.planned_hours,0))
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(developer_id uuid,planned_hours numeric)
  where x.developer_id is not null and x.developer_id<>p_main_tester_id
  on conflict(cycle_id,developer_id) do update set planned_hours=excluded.planned_hours;
  update public.test_cycles set status='accepted',main_tester_id=p_main_tester_id,
    planned_start=p_planned_start,planned_end=p_planned_end,schedule_note=v_reason,
    schedule_decided_by=public.current_developer_id(),schedule_decided_at=now()
  where id=p_cycle_id;
  update public.test_plans set status='accepted',recommended_owner_id=p_main_tester_id where id=v_cycle.plan_id;
  if v_plan.project_id is not null then
    perform set_config('app.test_center_rpc','on',true);
    update public.projects set test_state='scheduled' where id=v_plan.project_id;
  end if;
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,payload)
  values(v_cycle.plan_id,p_cycle_id,'schedule_accepted',public.current_developer_id(),
    jsonb_build_object('main_tester_id',p_main_tester_id,'planned_start',p_planned_start,'planned_end',p_planned_end));
  perform public.notify(p_main_tester_id,'test_schedule_assigned',jsonb_build_object('plan_id',v_cycle.plan_id,'cycle_id',p_cycle_id,'title',v_plan.title));
end;
$$;

create or replace function public.add_test_activity(
  p_cycle_id uuid,
  p_activity_type text,
  p_title text,
  p_owner_id uuid,
  p_planned_start date,
  p_planned_end date,
  p_planned_hours numeric default 0,
  p_preconditions text default null,
  p_expected_deliverable text default null,
  p_participants jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cycle public.test_cycles%rowtype;
  v_plan public.test_plans%rowtype;
  v_activity uuid;
  v_task uuid;
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id;
  if not found then raise exception '测试轮次不存在'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if not (public.is_test_lead(v_plan.test_team_id) or public.is_admin()) then raise exception '仅测试组长可以拆分测试活动'; end if;
  if v_cycle.status not in ('accepted','in_progress','paused') then raise exception '请先确认测试排期'; end if;
  if p_planned_end<p_planned_start then raise exception '活动结束日期不能早于开始日期'; end if;
  perform set_config('app.test_center_rpc','on',true);
  insert into public.test_activities(cycle_id,activity_type,title,owner_id,planned_start,planned_end,planned_hours,preconditions,expected_deliverable,status,created_by)
  values(p_cycle_id,p_activity_type,trim(p_title),p_owner_id,p_planned_start,p_planned_end,greatest(0,p_planned_hours),nullif(trim(coalesce(p_preconditions,'')),''),nullif(trim(coalesce(p_expected_deliverable,'')),''),
    case when v_cycle.status='in_progress' then 'in_progress' else 'todo' end,public.current_developer_id())
  returning id into v_activity;
  insert into public.tasks(title,description,status,priority,task_type,project_id,developer_id,team_id,start_date,due_date,created_by,work_source,test_plan_id,test_cycle_id,test_activity_id)
  values('[测试活动] '||trim(p_title),p_expected_deliverable,
    case when v_cycle.status='in_progress' then 'in_progress' else 'todo' end,
    v_plan.priority,'test',v_plan.project_id,p_owner_id,v_plan.test_team_id,p_planned_start,p_planned_end,public.current_developer_id(),'test_activity',v_plan.id,p_cycle_id,v_activity)
  returning id into v_task;
  update public.test_activities set task_id=v_task where id=v_activity;
  insert into public.test_activity_participants(activity_id,developer_id,planned_hours)
  select v_activity,x.developer_id,greatest(0,coalesce(x.planned_hours,0))
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(developer_id uuid,planned_hours numeric)
  where x.developer_id is not null on conflict do nothing;
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,payload)
  values(v_plan.id,p_cycle_id,'activity_created',public.current_developer_id(),jsonb_build_object('activity_id',v_activity,'task_id',v_task));
  return v_activity;
end;
$$;

create or replace function public.transition_test_cycle(
  p_cycle_id uuid,
  p_action text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cycle public.test_cycles%rowtype;
  v_plan public.test_plans%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_next text;
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id for update;
  if not found then raise exception '测试轮次不存在'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if not (v_cycle.main_tester_id=public.current_developer_id() or public.is_test_lead(v_plan.test_team_id) or public.is_admin()) then
    raise exception '仅主测试负责人或测试组长可以操作轮次';
  end if;
  if p_action='start' and v_cycle.status='accepted' then v_next:='in_progress';
  elsif p_action='pause' and v_cycle.status='in_progress' then
    if v_reason is null then raise exception '暂停必须填写原因'; end if; v_next:='paused';
  elsif p_action='resume' and v_cycle.status='paused' then v_next:='in_progress';
  elsif p_action='cancel' and v_cycle.status not in ('passed','failed','cancelled') then
    if v_reason is null then raise exception '取消必须填写原因'; end if; v_next:='cancelled';
  else raise exception '当前状态不能执行该操作';
  end if;
  update public.test_cycles set status=v_next,
    actual_started_at=case when p_action='start' then coalesce(actual_started_at,now()) else actual_started_at end,
    pause_reason=case when p_action='pause' then v_reason else pause_reason end,
    cancel_reason=case when p_action='cancel' then v_reason else cancel_reason end,
    actual_completed_at=case when p_action='cancel' then now() else actual_completed_at end
  where id=p_cycle_id;
  update public.test_plans set status=v_next where id=v_cycle.plan_id;
  if v_plan.project_id is not null then
    perform set_config('app.test_center_rpc','on',true);
    update public.projects set test_state=case when v_next='in_progress' then 'testing' when v_next='accepted' then 'scheduled' else test_state end
    where id=v_plan.project_id;
  end if;
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,reason)
  values(v_cycle.plan_id,p_cycle_id,'cycle_'||p_action,public.current_developer_id(),v_reason);
end;
$$;

create or replace function public.record_test_work_hours(
  p_task_id uuid,
  p_work_date date,
  p_hours numeric,
  p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_id uuid;
  v_start timestamptz;
begin
  select * into v_task from public.tasks where id=p_task_id;
  if not found or v_task.work_source not in ('test_activity','construction') then raise exception '只能为测试活动或测试建设任务登记工时'; end if;
  if p_hours<=0 or p_hours>24 then raise exception '单日工时必须大于 0 且不超过 24 小时'; end if;
  if not (v_task.developer_id=public.current_developer_id() or public.is_test_lead() or public.is_admin()
    or exists(select 1 from public.test_activity_participants ap where ap.activity_id=v_task.test_activity_id and ap.developer_id=public.current_developer_id())
    or exists(select 1 from public.test_construction_participants cp where cp.work_id=v_task.construction_work_id and cp.developer_id=public.current_developer_id())) then
    raise exception '无权登记该任务工时';
  end if;
  v_start := p_work_date::timestamp + interval '9 hours';
  insert into public.task_work_segments(task_id,developer_id,started_at,ended_at,entry_source,note,created_by)
  values(p_task_id,public.current_developer_id(),v_start,v_start+(p_hours||' hours')::interval,'manual',nullif(trim(coalesce(p_note,'')),''),public.current_developer_id())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_test_execution_batch(
  p_cycle_id uuid,
  p_activity_id uuid,
  p_executed_on date,
  p_environment_name text,
  p_build_version text,
  p_test_type text,
  p_planned_count int,
  p_executed_count int,
  p_passed_count int,
  p_failed_count int,
  p_blocked_count int,
  p_skipped_count int,
  p_bug_count int default 0,
  p_reopen_count int default 0,
  p_smoke_passed boolean default null,
  p_issue_summary text default null,
  p_blocker_summary text default null,
  p_risk_summary text default null,
  p_zentao_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cycle public.test_cycles%rowtype;
  v_plan public.test_plans%rowtype;
  v_id uuid;
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id;
  if not found then raise exception '测试轮次不存在'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if v_cycle.status<>'in_progress' then raise exception '只能在测试进行中登记执行批次'; end if;
  if not (v_cycle.main_tester_id=public.current_developer_id() or public.is_test_lead(v_plan.test_team_id) or public.is_admin()
    or exists(select 1 from public.test_cycle_participants where cycle_id=p_cycle_id and developer_id=public.current_developer_id())) then
    raise exception '仅本轮测试参与人可以登记执行批次';
  end if;
  if p_passed_count+p_failed_count+p_blocked_count+p_skipped_count<>p_executed_count then
    raise exception '通过、失败、阻塞、跳过数量之和必须等于实际执行数';
  end if;
  insert into public.test_execution_batches(
    cycle_id,activity_id,executed_on,executor_id,environment_name,build_version,test_type,
    planned_count,executed_count,passed_count,failed_count,blocked_count,skipped_count,
    bug_count,reopen_count,smoke_passed,issue_summary,blocker_summary,risk_summary,zentao_url,created_by
  ) values (
    p_cycle_id,p_activity_id,p_executed_on,public.current_developer_id(),trim(p_environment_name),trim(p_build_version),p_test_type,
    p_planned_count,p_executed_count,p_passed_count,p_failed_count,p_blocked_count,p_skipped_count,
    p_bug_count,p_reopen_count,p_smoke_passed,nullif(trim(coalesce(p_issue_summary,'')),''),
    nullif(trim(coalesce(p_blocker_summary,'')),''),nullif(trim(coalesce(p_risk_summary,'')),''),
    nullif(trim(coalesce(p_zentao_url,'')),''),public.current_developer_id()
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_test_report_status(
  p_report_id uuid,
  p_status text,
  p_not_issued_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_report public.test_reports%rowtype;
  v_cycle public.test_cycles%rowtype;
begin
  select * into v_report from public.test_reports where id=p_report_id;
  if not found then raise exception '报告项不存在'; end if;
  select * into v_cycle from public.test_cycles where id=v_report.cycle_id;
  if not (v_cycle.main_tester_id=public.current_developer_id() or public.is_test_lead() or public.is_admin()) then raise exception '仅主测试负责人或测试组长可以更新报告状态'; end if;
  if p_status not in ('issued','not_issued') then raise exception '报告状态必须为已出具或未出具'; end if;
  if p_status='not_issued' and length(trim(coalesce(p_not_issued_reason,'')))=0 then raise exception '未出具报告必须说明原因'; end if;
  update public.test_reports set status=p_status,
    not_issued_reason=case when p_status='not_issued' then trim(p_not_issued_reason) else null end,
    updated_by=public.current_developer_id(),updated_at=now()
  where id=p_report_id;
end;
$$;

create or replace function public.link_test_repair_task(
  p_cycle_id uuid,
  p_repair_task_id uuid,
  p_scope_task_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_cycle public.test_cycles%rowtype; v_plan public.test_plans%rowtype;
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if v_plan.project_id is null then raise exception '仅内部项目测试需要关联整改任务'; end if;
  if not (v_cycle.main_tester_id=public.current_developer_id() or public.is_test_lead(v_plan.test_team_id) or public.is_admin()) then raise exception '无权关联整改任务'; end if;
  if not exists(select 1 from public.tasks where id=p_repair_task_id and project_id=v_plan.project_id and task_type='dev') then raise exception '整改任务必须属于同一项目'; end if;
  insert into public.test_cycle_repair_tasks(cycle_id,scope_task_id,repair_task_id,created_by)
  values(p_cycle_id,p_scope_task_id,p_repair_task_id,public.current_developer_id()) on conflict do nothing;
end;
$$;

create or replace function public.submit_test_conclusion(
  p_cycle_id uuid,
  p_result text,
  p_scope text,
  p_completion text,
  p_new_issues text,
  p_legacy_issues text,
  p_blockers text,
  p_risks text,
  p_release_recommendation text
) returns void language plpgsql security definer set search_path = public as $$
declare v_cycle public.test_cycles%rowtype; v_plan public.test_plans%rowtype;
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id for update;
  if not found then raise exception '测试轮次不存在'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if v_cycle.main_tester_id<>public.current_developer_id() and not public.is_admin() then raise exception '仅主测试负责人可以提交结构化结论'; end if;
  if v_cycle.status<>'in_progress' then raise exception '只能在测试进行中提交结论'; end if;
  if p_result not in ('pass','fail') then raise exception '测试结论无效'; end if;
  if length(trim(coalesce(p_scope,'')))=0 or length(trim(coalesce(p_completion,'')))=0
    or length(trim(coalesce(p_new_issues,'')))=0 or length(trim(coalesce(p_legacy_issues,'')))=0
    or length(trim(coalesce(p_blockers,'')))=0 or length(trim(coalesce(p_risks,'')))=0
    or length(trim(coalesce(p_release_recommendation,'')))=0 then
    raise exception '结构化测试结论各项均为必填';
  end if;
  if exists(select 1 from public.test_reports where cycle_id=p_cycle_id and is_required and status='pending') then
    raise exception '请先完成所有必需报告的已出具/未出具状态';
  end if;
  if p_result='fail' and v_plan.source='internal_project'
    and not exists(select 1 from public.test_cycle_repair_tasks where cycle_id=p_cycle_id) then
    raise exception '内部项目测试不通过时必须关联具体整改任务';
  end if;
  update public.test_cycles set status='conclusion_pending',proposed_result=p_result,
    conclusion_scope=trim(p_scope),conclusion_completion=trim(p_completion),
    conclusion_new_issues=trim(p_new_issues),conclusion_legacy_issues=trim(p_legacy_issues),
    conclusion_blockers=trim(p_blockers),conclusion_risks=trim(p_risks),
    release_recommendation=trim(p_release_recommendation),
    conclusion_submitted_by=public.current_developer_id(),conclusion_submitted_at=now(),
    conclusion_return_reason=null
  where id=p_cycle_id;
  update public.test_plans set status='conclusion_pending' where id=v_cycle.plan_id;
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,payload)
  values(v_cycle.plan_id,p_cycle_id,'conclusion_submitted',public.current_developer_id(),jsonb_build_object('result',p_result));
  perform public.notify((select leader_id from public.teams where id=v_plan.test_team_id),'test_conclusion_pending',
    jsonb_build_object('plan_id',v_cycle.plan_id,'cycle_id',p_cycle_id,'title',v_plan.title));
end;
$$;

create or replace function public.review_test_conclusion(
  p_cycle_id uuid,
  p_confirm boolean,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_cycle public.test_cycles%rowtype; v_plan public.test_plans%rowtype; v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id for update;
  if not found then raise exception '测试轮次不存在'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if not (public.is_test_lead(v_plan.test_team_id) or public.is_admin()) then raise exception '仅测试组长可以确认测试结论'; end if;
  if v_cycle.status<>'conclusion_pending' then raise exception '当前没有待确认的测试结论'; end if;
  if not p_confirm then
    if v_reason is null then raise exception '退回结论必须填写原因'; end if;
    update public.test_cycles set status='in_progress',conclusion_return_reason=v_reason where id=p_cycle_id;
    update public.test_plans set status='in_progress' where id=v_cycle.plan_id;
    insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,reason) values(v_cycle.plan_id,p_cycle_id,'conclusion_returned',public.current_developer_id(),v_reason);
    perform public.notify(v_cycle.main_tester_id,'test_conclusion_returned',jsonb_build_object('cycle_id',p_cycle_id,'reason',v_reason));
    return;
  end if;
  update public.test_cycles set status=v_cycle.proposed_result,actual_completed_at=now(),
    conclusion_confirmed_by=public.current_developer_id(),conclusion_confirmed_at=now()
  where id=p_cycle_id;
  update public.test_plans set status=v_cycle.proposed_result where id=v_cycle.plan_id;
  if v_plan.project_id is not null then
    perform set_config('app.test_center_rpc','on',true);
    update public.projects set test_state=case when v_cycle.proposed_result='pass' then 'passed' else 'fixing' end
    where id=v_plan.project_id;
  end if;
  perform set_config('app.test_center_rpc','on',true);
  update public.tasks set status='done',submitted_at=coalesce(submitted_at,now()),completed_at=coalesce(completed_at,now())
  where test_cycle_id=p_cycle_id and work_source='test_activity' and status not in ('done','delayed_done');
  update public.test_activities set status='done' where cycle_id=p_cycle_id and status not in ('done','cancelled');
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,payload)
  values(v_cycle.plan_id,p_cycle_id,'conclusion_confirmed',public.current_developer_id(),jsonb_build_object('result',v_cycle.proposed_result));
  perform public.notify(v_cycle.main_tester_id,'test_conclusion_confirmed',jsonb_build_object('cycle_id',p_cycle_id,'result',v_cycle.proposed_result));
  if v_plan.project_id is not null then
    perform public.notify((select owner_id from public.projects where id=v_plan.project_id),'project_test_concluded',
      jsonb_build_object('project_id',v_plan.project_id,'cycle_id',p_cycle_id,'result',v_cycle.proposed_result));
  end if;
end;
$$;

-- ---------- 无需测试申请 ----------
create or replace function public.submit_no_test_request(
  p_project_id uuid,
  p_reason text,
  p_related_url text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_project public.projects%rowtype; v_reason text:=trim(coalesce(p_reason,''));
begin
  select * into v_project from public.projects where id=p_project_id for update;
  if not found then raise exception '项目不存在'; end if;
  if v_project.owner_id<>public.current_developer_id() and not public.is_admin() then raise exception '仅项目负责人可以申请无需测试'; end if;
  if length(v_reason) not between 10 and 1000 then raise exception '无需测试原因需为 10～1000 个字符'; end if;
  if p_related_url is not null and trim(p_related_url)!='' and trim(p_related_url)!~*'^https?://\S+$' then raise exception '关联链接必须以 http:// 或 https:// 开头'; end if;
  perform set_config('app.test_center_rpc','on',true);
  update public.projects set no_test_status='pending',no_test_reason=v_reason,
    no_test_related_url=nullif(trim(coalesce(p_related_url,'')),''),
    no_test_submitted_by=public.current_developer_id(),no_test_submitted_at=now(),
    no_test_decided_by=null,no_test_decided_at=null,no_test_decision_note=null
  where id=p_project_id;
  insert into public.project_no_test_events(project_id,event_type,actor_id,reason,related_url)
  values(p_project_id,'submitted',public.current_developer_id(),v_reason,nullif(trim(coalesce(p_related_url,'')),''));
  perform public.notify((select t.leader_id from public.teams t where t.is_test_team order by t.created_at limit 1),
    'no_test_pending',jsonb_build_object('project_id',p_project_id,'project_name',v_project.name));
end;
$$;

create or replace function public.review_no_test_request(
  p_project_id uuid,
  p_approve boolean,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_project public.projects%rowtype; v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  select * into v_project from public.projects where id=p_project_id for update;
  if not found or v_project.no_test_status<>'pending' then raise exception '没有待确认的无需测试申请'; end if;
  if not (public.is_test_lead() or public.is_admin()) then raise exception '仅测试组长可以确认无需测试申请'; end if;
  if not p_approve and v_reason is null then raise exception '退回无需测试申请必须填写原因'; end if;
  perform set_config('app.test_center_rpc','on',true);
  update public.projects set no_test_status=case when p_approve then 'approved' else 'rejected' end,
    requires_testing=not p_approve,test_state=case when p_approve then 'no_test_approved' else 'not_requested' end,
    no_test_decided_by=public.current_developer_id(),no_test_decided_at=now(),no_test_decision_note=v_reason
  where id=p_project_id;
  insert into public.project_no_test_events(project_id,event_type,actor_id,reason)
  values(p_project_id,case when p_approve then 'approved' else 'rejected' end,public.current_developer_id(),v_reason);
  perform public.notify(v_project.owner_id,case when p_approve then 'no_test_approved' else 'no_test_rejected' end,
    jsonb_build_object('project_id',p_project_id,'reason',v_reason));
end;
$$;

create or replace function public.withdraw_no_test_request(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_project public.projects%rowtype;
begin
  select * into v_project from public.projects where id=p_project_id for update;
  if not found or v_project.no_test_status<>'pending' then raise exception '没有可撤回的无需测试申请'; end if;
  if v_project.owner_id<>public.current_developer_id() and not public.is_admin() then raise exception '仅项目负责人可以撤回申请'; end if;
  perform set_config('app.test_center_rpc','on',true);
  update public.projects set no_test_status='none',no_test_reason=null,no_test_related_url=null where id=p_project_id;
  insert into public.project_no_test_events(project_id,event_type,actor_id) values(p_project_id,'withdrawn',public.current_developer_id());
end;
$$;

-- ---------- 测试建设工作 ----------
create or replace function public.create_test_construction(
  p_title text,
  p_work_type text,
  p_goal text,
  p_priority text,
  p_owner_id uuid,
  p_planned_start date,
  p_planned_end date,
  p_deliverables text,
  p_acceptance_criteria text,
  p_resource_links text default null,
  p_participants jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_automation_tester() or public.is_test_lead() or public.is_admin()) then raise exception '仅自动化测试人员或测试组长可以创建测试建设工作'; end if;
  if length(trim(coalesce(p_title,'')))=0 or length(trim(coalesce(p_goal,'')))=0
    or length(trim(coalesce(p_deliverables,'')))=0 or length(trim(coalesce(p_acceptance_criteria,'')))=0 then
    raise exception '标题、目标、预期成果和验收标准必填';
  end if;
  insert into public.test_construction_works(title,work_type,goal,priority,owner_id,planned_start,planned_end,deliverables,acceptance_criteria,resource_links,created_by)
  values(trim(p_title),p_work_type,trim(p_goal),p_priority,p_owner_id,p_planned_start,p_planned_end,trim(p_deliverables),trim(p_acceptance_criteria),nullif(trim(coalesce(p_resource_links,'')),''),public.current_developer_id())
  returning id into v_id;
  insert into public.test_construction_participants(work_id,developer_id,participant_role,planned_hours)
  values(v_id,p_owner_id,'owner',0);
  insert into public.test_construction_participants(work_id,developer_id,participant_role,planned_hours)
  select v_id,x.developer_id,'participant',greatest(0,coalesce(x.planned_hours,0))
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb)) as x(developer_id uuid,planned_hours numeric)
  where x.developer_id is not null and x.developer_id<>p_owner_id on conflict do nothing;
  insert into public.test_construction_events(work_id,event_type,actor_id) values(v_id,'created',public.current_developer_id());
  return v_id;
end;
$$;

create or replace function public.add_construction_task(
  p_work_id uuid,
  p_title text,
  p_owner_id uuid,
  p_planned_start date,
  p_planned_end date,
  p_planned_hours numeric default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_work public.test_construction_works%rowtype; v_sub uuid; v_task uuid;
begin
  select * into v_work from public.test_construction_works where id=p_work_id;
  if not found then raise exception '测试建设工作不存在'; end if;
  if not (v_work.owner_id=public.current_developer_id() or public.is_test_lead() or public.is_admin()) then raise exception '仅建设负责人或测试组长可以拆分任务'; end if;
  perform set_config('app.test_center_rpc','on',true);
  insert into public.test_construction_tasks(work_id,title,owner_id,planned_start,planned_end,planned_hours,created_by)
  values(p_work_id,trim(p_title),p_owner_id,p_planned_start,p_planned_end,greatest(0,p_planned_hours),public.current_developer_id())
  returning id into v_sub;
  insert into public.tasks(title,status,priority,task_type,project_id,developer_id,team_id,start_date,due_date,created_by,work_source,construction_work_id,construction_task_id)
  values('[测试建设] '||trim(p_title),'todo',v_work.priority,'test',null,p_owner_id,null,p_planned_start,p_planned_end,public.current_developer_id(),'construction',p_work_id,v_sub)
  returning id into v_task;
  update public.test_construction_tasks set task_id=v_task where id=v_sub;
  insert into public.test_construction_events(work_id,event_type,actor_id,payload)
  values(p_work_id,'task_created',public.current_developer_id(),jsonb_build_object('construction_task_id',v_sub,'task_id',v_task));
  return v_sub;
end;
$$;

create or replace function public.update_construction_task(
  p_construction_task_id uuid,
  p_status text,
  p_progress int
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_task public.test_construction_tasks%rowtype;
  v_work public.test_construction_works%rowtype;
  v_progress int := greatest(0,least(100,coalesce(p_progress,0)));
begin
  select * into v_task from public.test_construction_tasks where id=p_construction_task_id for update;
  if not found then raise exception '建设任务不存在'; end if;
  select * into v_work from public.test_construction_works where id=v_task.work_id;
  if not (
    v_task.owner_id=public.current_developer_id()
    or v_work.owner_id=public.current_developer_id()
    or public.is_test_lead()
    or public.is_admin()
  ) then raise exception '无权更新该建设任务'; end if;
  if v_work.status not in ('active','paused') then raise exception '建设工作尚未进入执行阶段'; end if;
  if p_status not in ('todo','in_progress','paused','done','cancelled') then raise exception '建设任务状态无效'; end if;
  if p_status='done' then v_progress:=100; end if;
  perform set_config('app.test_center_rpc','on',true);
  update public.test_construction_tasks set status=p_status,progress=v_progress where id=p_construction_task_id;
  update public.tasks set status=case when p_status='cancelled' then 'paused' else p_status end,
    submitted_at=case when p_status='done' then coalesce(submitted_at,now()) else submitted_at end,
    completed_at=case when p_status='done' then coalesce(completed_at,now()) else null end
  where id=v_task.task_id;
  insert into public.test_construction_events(work_id,event_type,actor_id,payload)
  values(v_task.work_id,'task_updated',public.current_developer_id(),
    jsonb_build_object('construction_task_id',v_task.id,'status',p_status,'progress',v_progress));
end;
$$;

create or replace function public.transition_construction(
  p_work_id uuid,
  p_action text,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_work public.test_construction_works%rowtype; v_next text; v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  select * into v_work from public.test_construction_works where id=p_work_id for update;
  if not found then raise exception '测试建设工作不存在'; end if;
  if p_action='submit_schedule' and v_work.status='draft' and (v_work.owner_id=public.current_developer_id() or public.is_admin()) then v_next:='pending_schedule';
  elsif p_action='confirm_schedule' and v_work.status='pending_schedule' and (public.is_test_lead() or public.is_admin()) then v_next:='active';
  elsif p_action='pause' and v_work.status='active' and (v_work.owner_id=public.current_developer_id() or public.is_test_lead() or public.is_admin()) then
    if v_reason is null then raise exception '暂停必须填写原因'; end if; v_next:='paused';
  elsif p_action='resume' and v_work.status='paused' and (v_work.owner_id=public.current_developer_id() or public.is_test_lead() or public.is_admin()) then v_next:='active';
  elsif p_action='submit_result' and v_work.status='active' and (v_work.owner_id=public.current_developer_id() or public.is_admin()) then
    if v_reason is null then raise exception '提交成果必须填写成果说明'; end if; v_next:='pending_acceptance';
  elsif p_action='confirm_result' and v_work.status='pending_acceptance' and (public.is_test_lead() or public.is_admin()) then v_next:='completed';
  elsif p_action='return_result' and v_work.status='pending_acceptance' and (public.is_test_lead() or public.is_admin()) then
    if v_reason is null then raise exception '退回成果必须填写原因'; end if; v_next:='active';
  elsif p_action='cancel' and v_work.status not in ('completed','cancelled') and (public.is_test_lead() or public.is_admin()) then
    if v_reason is null then raise exception '取消必须填写原因'; end if; v_next:='cancelled';
  else raise exception '当前状态或权限不允许该操作';
  end if;
  update public.test_construction_works set status=v_next,
    completion_note=case when p_action in ('submit_result','return_result') then v_reason else completion_note end,
    blocker_note=case when p_action in ('pause','cancel') then v_reason else blocker_note end,
    schedule_confirmed_by=case when p_action='confirm_schedule' then public.current_developer_id() else schedule_confirmed_by end,
    schedule_confirmed_at=case when p_action='confirm_schedule' then now() else schedule_confirmed_at end,
    result_confirmed_by=case when p_action='confirm_result' then public.current_developer_id() else result_confirmed_by end,
    result_confirmed_at=case when p_action='confirm_result' then now() else result_confirmed_at end
  where id=p_work_id;
  if v_next='completed' then
    perform set_config('app.test_center_rpc','on',true);
    update public.test_construction_tasks set status='done',progress=100 where work_id=p_work_id and status<>'cancelled';
    update public.tasks set status='done',submitted_at=coalesce(submitted_at,now()),completed_at=coalesce(completed_at,now())
    where construction_work_id=p_work_id and work_source='construction' and status<>'delayed_done';
  end if;
  insert into public.test_construction_events(work_id,event_type,actor_id,reason) values(p_work_id,p_action,public.current_developer_id(),v_reason);
end;
$$;

-- ---------- 查询：列表、详情、三来源资源 ----------
create or replace function public.get_testing_center(
  p_source text default null,
  p_status text default null,
  p_page int default 1,
  p_page_size int default 20
) returns jsonb language sql stable security definer set search_path = public as $$
  with visible as (
    select tp.*, p.name project_name, tm.name test_team_name, d.name recommended_owner_name,
      lc.id latest_cycle_id,lc.cycle_no,lc.stage_version,lc.status cycle_status,lc.main_tester_id,
      md.name main_tester_name,lc.planned_start,lc.planned_end,
      coalesce(agg.planned_count,0) planned_case_count,coalesce(agg.executed_count,0) executed_case_count,
      coalesce(agg.passed_count,0) passed_count,coalesce(agg.failed_count,0) failed_count,
      coalesce(agg.blocked_count,0) blocked_count,coalesce(agg.bug_count,0) bug_count,
      coalesce(agg.reopen_count,0) reopen_count,coalesce(eff.actual_hours,0) actual_hours
    from public.test_plans tp
    left join public.projects p on p.id=tp.project_id
    join public.teams tm on tm.id=tp.test_team_id
    left join public.developers d on d.id=tp.recommended_owner_id
    left join lateral(select * from public.test_cycles where plan_id=tp.id order by cycle_no desc limit 1) lc on true
    left join public.developers md on md.id=lc.main_tester_id
    left join lateral(
      select sum(planned_count)::int planned_count,sum(executed_count)::int executed_count,
        sum(passed_count)::int passed_count,sum(failed_count)::int failed_count,
        sum(blocked_count)::int blocked_count,sum(bug_count)::int bug_count,sum(reopen_count)::int reopen_count
      from public.test_execution_batches where cycle_id=lc.id
    ) agg on true
    left join lateral(
      select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours
      from public.tasks t join public.task_work_segments ws on ws.task_id=t.id
      where t.test_cycle_id=lc.id and ws.ended_at is not null
    ) eff on true
    where public.can_view_test_plan(tp.id)
      and (p_source is null or p_source='' or tp.source=p_source)
      and (p_status is null or p_status='' or lc.status=p_status)
  ), counted as(select visible.*,count(*) over() total_count from visible),
  paged as(select * from counted order by updated_at desc offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),100) limit least(greatest(p_page_size,1),100))
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(x)-'total_count' order by x.updated_at desc) from paged x),'[]'::jsonb),
    'total',coalesce((select max(total_count) from counted),0),'page',greatest(p_page,1),'page_size',least(greatest(p_page_size,1),100)
  );
$$;

create or replace function public.get_test_plan_detail(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_plan jsonb; v_cycles jsonb;
begin
  if not public.can_view_test_plan(p_plan_id) then raise exception '无权查看该测试计划'; end if;
  select to_jsonb(tp)||jsonb_build_object('project_name',p.name,'test_team_name',tm.name,'created_by_name',creator.name)
  into v_plan from public.test_plans tp left join public.projects p on p.id=tp.project_id
  join public.teams tm on tm.id=tp.test_team_id left join public.developers creator on creator.id=tp.created_by where tp.id=p_plan_id;
  if v_plan is null then raise exception '测试计划不存在'; end if;
  select coalesce(jsonb_agg(
    to_jsonb(c)||jsonb_build_object(
      'main_tester_name',d.name,
      'scope_tasks',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.test_cycle_scope_tasks s where s.cycle_id=c.id),'[]'::jsonb),
      'participants',coalesce((select jsonb_agg(to_jsonb(cp)||jsonb_build_object('name',pd.name) order by cp.participant_role, pd.name) from public.test_cycle_participants cp join public.developers pd on pd.id=cp.developer_id where cp.cycle_id=c.id),'[]'::jsonb),
      'activities',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('owner_name',ad.name,'actual_hours',coalesce(ah.hours,0)) order by a.created_at) from public.test_activities a join public.developers ad on ad.id=a.owner_id left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) hours from public.task_work_segments ws where ws.task_id=a.task_id and ws.ended_at is not null) ah on true where a.cycle_id=c.id),'[]'::jsonb),
      'batches',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('executor_name',bd.name) order by b.executed_on desc,b.created_at desc) from public.test_execution_batches b join public.developers bd on bd.id=b.executor_id where b.cycle_id=c.id),'[]'::jsonb),
      'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.report_type) from public.test_reports r where r.cycle_id=c.id),'[]'::jsonb),
      'repair_tasks',coalesce((select jsonb_agg(to_jsonb(rt)||jsonb_build_object('repair_task_title',t.title,'repair_task_status',t.status)) from public.test_cycle_repair_tasks rt join public.tasks t on t.id=rt.repair_task_id where rt.cycle_id=c.id),'[]'::jsonb)
    ) order by c.cycle_no desc),'[]'::jsonb)
  into v_cycles from public.test_cycles c left join public.developers d on d.id=c.main_tester_id where c.plan_id=p_plan_id;
  return v_plan||jsonb_build_object('cycles',v_cycles,
    'events',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ed.name) order by e.created_at desc) from public.test_plan_events e left join public.developers ed on ed.id=e.actor_id where e.plan_id=p_plan_id),'[]'::jsonb));
end;
$$;

create or replace function public.get_construction_works(
  p_status text default null,
  p_page int default 1,
  p_page_size int default 20
) returns jsonb language sql stable security definer set search_path = public as $$
  with visible as (
    select w.*,d.name owner_name,
      coalesce(t.task_count,0) task_count,coalesce(t.done_count,0) done_count,
      coalesce(t.planned_hours,0) planned_hours,coalesce(e.actual_hours,0) actual_hours
    from public.test_construction_works w join public.developers d on d.id=w.owner_id
    left join lateral(select count(*)::int task_count,count(*) filter(where status='done')::int done_count,round(coalesce(sum(planned_hours),0)::numeric,1) planned_hours from public.test_construction_tasks where work_id=w.id)t on true
    left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours from public.tasks tk join public.task_work_segments ws on ws.task_id=tk.id where tk.construction_work_id=w.id and ws.ended_at is not null)e on true
    where public.can_view_construction(w.id) and (p_status is null or p_status='' or w.status=p_status)
  ), counted as(select visible.*,count(*) over() total_count from visible),
  paged as(select * from counted order by updated_at desc offset(greatest(p_page,1)-1)*least(greatest(p_page_size,1),100) limit least(greatest(p_page_size,1),100))
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)-'total_count' order by x.updated_at desc) from paged x),'[]'::jsonb),
    'total',coalesce((select max(total_count) from counted),0),'page',greatest(p_page,1),'page_size',least(greatest(p_page_size,1),100));
$$;

create or replace function public.get_construction_detail(p_work_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.can_view_construction(p_work_id) then raise exception '无权查看该测试建设工作'; end if;
  select to_jsonb(w)||jsonb_build_object(
    'owner_name',d.name,
    'participants',coalesce((select jsonb_agg(to_jsonb(cp)||jsonb_build_object('name',pd.name) order by cp.participant_role,pd.name) from public.test_construction_participants cp join public.developers pd on pd.id=cp.developer_id where cp.work_id=w.id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(ct)||jsonb_build_object('owner_name',td.name,'actual_hours',coalesce(e.hours,0)) order by ct.created_at) from public.test_construction_tasks ct join public.developers td on td.id=ct.owner_id left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) hours from public.task_work_segments ws where ws.task_id=ct.task_id and ws.ended_at is not null)e on true where ct.work_id=w.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(ce)||jsonb_build_object('actor_name',ed.name) order by ce.created_at desc) from public.test_construction_events ce left join public.developers ed on ed.id=ce.actor_id where ce.work_id=w.id),'[]'::jsonb)
  ) into v_result from public.test_construction_works w join public.developers d on d.id=w.owner_id where w.id=p_work_id;
  if v_result is null then raise exception '测试建设工作不存在'; end if;
  return v_result;
end;
$$;

create or replace function public.get_test_resource_summary(
  p_from date default null,
  p_to date default null
) returns jsonb language sql stable security definer set search_path = public as $$
  with plan_rows as (
    select cp.developer_id,
      case when tp.source='internal_project' then 'internal_project' else 'external_request' end source,
      sum(cp.planned_hours) planned_hours,0::numeric actual_hours
    from public.test_cycle_participants cp join public.test_cycles c on c.id=cp.cycle_id join public.test_plans tp on tp.id=c.plan_id
    where public.can_view_test_plan(tp.id)
      and (p_from is null or c.planned_end>=p_from) and (p_to is null or c.planned_start<=p_to)
    group by cp.developer_id,tp.source
  ), construction_plan as (
    select cp.developer_id,'construction'::text source,sum(cp.planned_hours) planned_hours,0::numeric actual_hours
    from public.test_construction_participants cp join public.test_construction_works w on w.id=cp.work_id
    where public.can_view_construction(w.id) and (p_from is null or w.planned_end>=p_from) and (p_to is null or w.planned_start<=p_to)
    group by cp.developer_id
  ), actual_rows as (
    select ws.developer_id,
      case when t.work_source='construction' then 'construction'
        when tp.source='external_request' then 'external_request' else 'internal_project' end source,
      0::numeric planned_hours,
      sum(extract(epoch from(ws.ended_at-ws.started_at))/3600)::numeric actual_hours
    from public.task_work_segments ws join public.tasks t on t.id=ws.task_id
    left join public.test_plans tp on tp.id=t.test_plan_id
    where ws.ended_at is not null and t.work_source in ('test_activity','construction')
      and (p_from is null or ws.started_at::date>=p_from) and (p_to is null or ws.started_at::date<=p_to)
    group by ws.developer_id,case when t.work_source='construction' then 'construction' when tp.source='external_request' then 'external_request' else 'internal_project' end
  ), all_rows as(select * from plan_rows union all select * from construction_plan union all select * from actual_rows),
  assignments as (
    select cp.developer_id,'cycle:'||c.id::text assignment_id,c.planned_start start_date,c.planned_end end_date
    from public.test_cycle_participants cp join public.test_cycles c on c.id=cp.cycle_id
    join public.test_plans tp on tp.id=c.plan_id
    where public.can_view_test_plan(tp.id) and c.planned_start is not null and c.planned_end is not null
      and (p_from is null or c.planned_end>=p_from) and (p_to is null or c.planned_start<=p_to)
    union all
    select cp.developer_id,'construction:'||w.id::text,w.planned_start,w.planned_end
    from public.test_construction_participants cp join public.test_construction_works w on w.id=cp.work_id
    where public.can_view_construction(w.id) and w.planned_start is not null and w.planned_end is not null
      and (p_from is null or w.planned_end>=p_from) and (p_to is null or w.planned_start<=p_to)
  ), conflict_counts as (
    select a.developer_id,count(*)::int conflict_count
    from assignments a join assignments b on b.developer_id=a.developer_id
      and b.assignment_id>a.assignment_id
      and a.start_date<=b.end_date and b.start_date<=a.end_date
    group by a.developer_id
  ),
  grouped as(
    select r.developer_id,d.name,d.position,r.source,round(sum(r.planned_hours),1) planned_hours,
      round(sum(r.actual_hours),1) actual_hours,coalesce(cc.conflict_count,0) conflict_count
    from all_rows r join public.developers d on d.id=r.developer_id
    left join conflict_counts cc on cc.developer_id=r.developer_id
    group by r.developer_id,d.name,d.position,r.source,cc.conflict_count
  )
  select jsonb_build_object(
    'rows',coalesce(jsonb_agg(to_jsonb(grouped) order by name,source),'[]'::jsonb),
    'totals',jsonb_build_object(
      'internal_project',coalesce(sum(actual_hours) filter(where source='internal_project'),0),
      'external_request',coalesce(sum(actual_hours) filter(where source='external_request'),0),
      'construction',coalesce(sum(actual_hours) filter(where source='construction'),0),
      'project_test_cost',coalesce(sum(actual_hours) filter(where source='internal_project'),0)
    )
  ) from grouped;
$$;

create or replace function public.get_project_test_summary(p_project_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'requires_testing',p.requires_testing,'test_state',p.test_state,'no_test_status',p.no_test_status,
    'no_test_reason',p.no_test_reason,'no_test_related_url',p.no_test_related_url,'no_test_decision_note',p.no_test_decision_note,
    'plan_id',tp.id,'plan_title',tp.title,
    'cycle_count',coalesce(ca.cycle_count,0),'passed_cycle_count',coalesce(ca.passed_count,0),'failed_cycle_count',coalesce(ca.failed_count,0),
    'active_cycle_count',coalesce(ca.active_count,0),'executed_count',coalesce(ba.executed_count,0),
    'bug_count',coalesce(ba.bug_count,0),'reopen_count',coalesce(ba.reopen_count,0),'blocked_count',coalesce(ba.blocked_count,0),
    'test_actual_hours',coalesce(eff.actual_hours,0),
    'cycles',coalesce(ca.cycles,'[]'::jsonb)
  )
  from public.projects p
  left join lateral(select * from public.test_plans where project_id=p.id order by created_at desc limit 1)tp on true
  left join lateral(
    select count(*)::int cycle_count,count(*) filter(where status='passed')::int passed_count,
      count(*) filter(where status='failed')::int failed_count,
      count(*) filter(where status not in ('passed','failed','cancelled','returned'))::int active_count,
      jsonb_agg(to_jsonb(c) order by cycle_no desc) cycles
    from public.test_cycles c where c.plan_id=tp.id
  )ca on true
  left join lateral(
    select sum(b.executed_count)::int executed_count,sum(b.bug_count)::int bug_count,
      sum(b.reopen_count)::int reopen_count,sum(b.blocked_count)::int blocked_count
    from public.test_execution_batches b join public.test_cycles c on c.id=b.cycle_id where c.plan_id=tp.id
  )ba on true
  left join lateral(
    select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours
    from public.tasks t join public.task_work_segments ws on ws.task_id=t.id
    where t.test_plan_id=tp.id and t.work_source='test_activity' and ws.ended_at is not null
  )eff on true
  where p.id=p_project_id;
$$;

-- 保留 0008 驾驶舱实现并包装：旧单任务测试只在“历史汇总”出现，
-- 新项目级测试聚合由 project_testing 返回。
alter function public.get_project_cockpit(uuid) rename to get_project_cockpit_v215;
revoke all on function public.get_project_cockpit_v215(uuid) from public, authenticated;
create function public.get_project_cockpit(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_old jsonb; v_history jsonb;
begin
  v_old := public.get_project_cockpit_v215(p_project_id);
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_history
  from jsonb_array_elements(coalesce(v_old->'quality_rounds','[]'::jsonb)) item
  join public.tasks t on t.id=(item->>'test_task_id')::uuid
  where t.work_source='legacy_single_test';
  return v_old || jsonb_build_object(
    'quality_rounds',v_history,
    'project_testing',public.get_project_test_summary(p_project_id)
  );
end;
$$;

-- 项目列表仍复用 0008 的周期/投入/任务口径，但测试质量切换到项目级轮次；
-- 没有新计划的历史项目继续显示旧 test_rounds 口径，不伪造迁移。
create or replace function public.get_project_summaries()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    public.project_summary_json(p.id) ||
    case when metrics.plan_count > 0 then jsonb_build_object(
      'test_round_total',metrics.cycle_count,
      'cumulative_bug_count',metrics.bug_count,
      'reopen_count',metrics.reopen_count,
      'failed_round_count',metrics.failed_count,
      'blocked_round_count',metrics.blocked_cycle_count,
      'test_pass_rate',case when metrics.concluded_count>0 then round(metrics.passed_count*100.0/metrics.concluded_count,1) else null end,
      'summary_covered_count',metrics.concluded_count,
      'summary_expected_count',metrics.cycle_count,
      'summary_coverage_rate',case when metrics.cycle_count>0 then round(metrics.concluded_count*100.0/metrics.cycle_count,1) else null end
    ) else '{}'::jsonb end
    order by p.created_at desc
  ),'[]'::jsonb)
  from public.projects p
  left join lateral(
    select
      count(distinct tp.id)::int plan_count,
      count(distinct c.id)::int cycle_count,
      count(distinct c.id) filter(where c.status in('passed','failed'))::int concluded_count,
      count(distinct c.id) filter(where c.status='passed')::int passed_count,
      count(distinct c.id) filter(where c.status='failed')::int failed_count,
      count(distinct c.id) filter(where exists(select 1 from public.test_execution_batches bx where bx.cycle_id=c.id and bx.blocked_count>0))::int blocked_cycle_count,
      coalesce(sum(b.bug_count),0)::int bug_count,
      coalesce(sum(b.reopen_count),0)::int reopen_count
    from public.test_plans tp
    left join public.test_cycles c on c.plan_id=tp.id
    left join public.test_execution_batches b on b.cycle_id=c.id
    where tp.project_id=p.id
  ) metrics on true;
$$;

-- 项目完成增加项目级测试门禁；admin 强制完成继续沿用 0008 的原因与审计。
create or replace function public.complete_project(
  p_project_id uuid,
  p_force boolean default false,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_project public.projects%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_unfinished_dev int; v_active_test int; v_review int; v_active_cycle int; v_testing_gate boolean;
  v_blockers jsonb; v_blocker_titles text;
begin
  if public.current_developer_id() is null then raise exception '当前账号未绑定人员档案，无法记录项目完成审计'; end if;
  select * into v_project from public.projects where id=p_project_id for update;
  if not found then raise exception '项目不存在'; end if;
  if v_project.status='completed' then raise exception '项目已经完成'; end if;
  if v_project.owner_id<>public.current_developer_id() and not public.is_admin() then raise exception '仅项目负责人可以完成项目；管理员仅处理异常代办'; end if;
  if p_force and not public.is_admin() then raise exception '仅管理员可以强制完成项目'; end if;
  if p_force and v_reason is null then raise exception '管理员强制完成必须填写原因'; end if;
  select count(*) filter(where task_type='dev' and status not in('done','delayed_done')),
    count(*) filter(where work_source in('legacy_single_test','test_activity') and status not in('done','delayed_done')),
    count(*) filter(where status='review')
  into v_unfinished_dev,v_active_test,v_review from public.tasks where project_id=p_project_id;
  select count(*) into v_active_cycle from public.test_cycles c join public.test_plans tp on tp.id=c.plan_id
  where tp.project_id=p_project_id and c.status not in('passed','failed','cancelled','returned');
  v_testing_gate := v_project.requires_testing and v_project.test_state<>'passed';
  select string_agg(format('%s（%s）',title,status),'、') into v_blocker_titles
  from(select title,status from public.tasks where project_id=p_project_id and status not in('done','delayed_done') order by created_at limit 10)x;
  v_blockers:=jsonb_build_object('unfinished_dev',v_unfinished_dev,'active_test',v_active_test,'review',v_review,
    'active_test_cycles',v_active_cycle,'testing_gate',v_testing_gate,'test_state',v_project.test_state,
    'sample_tasks',coalesce(v_blocker_titles,''));
  if (v_unfinished_dev>0 or v_active_test>0 or v_review>0 or v_active_cycle>0 or v_testing_gate) and not p_force then
    raise exception '项目仍有阻断项：未完成开发任务 % 个、在办测试工作 % 个、待审批 % 个、活动测试轮次 % 个；测试门禁=%（当前状态 %）。',
      v_unfinished_dev,v_active_test,v_review,v_active_cycle,v_testing_gate,v_project.test_state;
  end if;
  perform set_config('app.project_complete_rpc','on',true);
  perform set_config('app.project_admin_force',case when p_force then 'on' else 'off' end,true);
  perform set_config('app.project_force_reason',coalesce(v_reason,''),true);
  perform set_config('app.project_blockers',v_blockers::text,true);
  update public.projects set status='completed',completed_at=now() where id=p_project_id;
  return v_blockers;
end;
$$;

-- 新测试活动/建设任务不由旧任务状态触发器自动开工时段，也不走项目负责人审批。
create or replace function public.track_work_segments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.work_source in ('test_activity','construction') then return new; end if;
  if old.status<>'in_progress' and new.status='in_progress' then
    insert into public.task_work_segments(task_id,developer_id,started_at) values(new.id,new.developer_id,now());
  end if;
  if old.status='in_progress' and new.status<>'in_progress' then
    update public.task_work_segments set ended_at=now() where task_id=new.id and ended_at is null;
  end if;
  return new;
end;
$$;

create or replace function public.guard_new_test_work_tasks()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.task_type='test' and new.work_source='development' then
    raise exception '测试工作必须从统一测试中心或测试建设工作创建';
  end if;
  if new.work_source in ('test_activity','construction')
    and current_setting('app.test_center_rpc',true) is distinct from 'on' then
    raise exception '测试活动或建设任务只能通过测试中心流程创建';
  end if;
  if new.work_source='construction' and (new.project_id is not null or new.test_plan_id is not null or new.test_cycle_id is not null) then
    raise exception '测试建设任务不得关联项目或测试计划';
  end if;
  if new.work_source='test_activity' and (new.test_plan_id is null or new.test_cycle_id is null or new.test_activity_id is null) then
    raise exception '测试活动任务必须关联计划、轮次和活动';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_new_test_work_tasks on public.tasks;
create trigger trg_guard_new_test_work_tasks before insert on public.tasks
  for each row execute function public.guard_new_test_work_tasks();

create or replace function public.guard_test_work_task_updates()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.work_source='legacy_single_test'
    and current_setting('app.legacy_test_maintenance',true) is distinct from 'on' then
    raise exception '历史单任务测试记录只读保留';
  end if;
  if old.work_source in ('test_activity','construction')
    and current_setting('app.test_center_rpc',true) is distinct from 'on' then
    raise exception '测试活动和建设任务只能在测试中心更新';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_test_work_task_updates on public.tasks;
create trigger trg_guard_test_work_task_updates before update on public.tasks
  for each row execute function public.guard_test_work_task_updates();

create or replace function public.guard_project_testing_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if (
    new.requires_testing is distinct from old.requires_testing
    or new.test_state is distinct from old.test_state
    or new.no_test_status is distinct from old.no_test_status
    or new.no_test_reason is distinct from old.no_test_reason
    or new.no_test_related_url is distinct from old.no_test_related_url
    or new.no_test_submitted_by is distinct from old.no_test_submitted_by
    or new.no_test_submitted_at is distinct from old.no_test_submitted_at
    or new.no_test_decided_by is distinct from old.no_test_decided_by
    or new.no_test_decided_at is distinct from old.no_test_decided_at
    or new.no_test_decision_note is distinct from old.no_test_decision_note
  ) and current_setting('app.test_center_rpc',true) is distinct from 'on' then
    raise exception '项目测试门禁和无需测试状态只能通过测试中心流程修改';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_project_testing_fields on public.projects;
create trigger trg_guard_project_testing_fields before update on public.projects
  for each row execute function public.guard_project_testing_fields();

-- 停用旧“单开发任务提测”写入口；已存在记录仍通过原表只读展示。
revoke all on function public.submit_for_testing(uuid,uuid,date,date,text,text) from public, authenticated;
revoke all on function public.start_test_task(uuid,text,int,text,text,text) from public, authenticated;
revoke all on function public.conclude_test(uuid,boolean,text,int,int,int,int,boolean,text,text,text,text) from public, authenticated;

-- RPC 权限
revoke all on function public.is_test_worker() from public;
revoke all on function public.is_automation_tester() from public;
revoke all on function public.is_test_lead(uuid) from public;
revoke all on function public.can_view_test_plan(uuid) from public;
revoke all on function public.can_view_construction(uuid) from public;
grant execute on function public.is_test_worker() to authenticated;
grant execute on function public.is_automation_tester() to authenticated;
grant execute on function public.is_test_lead(uuid) to authenticated;
grant execute on function public.can_view_test_plan(uuid) to authenticated;
grant execute on function public.can_view_construction(uuid) to authenticated;

revoke all on function public.create_test_plan(text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]) from public;
revoke all on function public.create_test_cycle(uuid,text,text,text[]) from public;
revoke all on function public.review_test_schedule(uuid,boolean,uuid,date,date,jsonb,text) from public;
revoke all on function public.add_test_activity(uuid,text,text,uuid,date,date,numeric,text,text,jsonb) from public;
revoke all on function public.transition_test_cycle(uuid,text,text) from public;
revoke all on function public.record_test_work_hours(uuid,date,numeric,text) from public;
revoke all on function public.add_test_execution_batch(uuid,uuid,date,text,text,text,int,int,int,int,int,int,int,int,boolean,text,text,text,text) from public;
revoke all on function public.set_test_report_status(uuid,text,text) from public;
revoke all on function public.link_test_repair_task(uuid,uuid,uuid) from public;
revoke all on function public.submit_test_conclusion(uuid,text,text,text,text,text,text,text,text) from public;
revoke all on function public.review_test_conclusion(uuid,boolean,text) from public;
revoke all on function public.submit_no_test_request(uuid,text,text) from public;
revoke all on function public.review_no_test_request(uuid,boolean,text) from public;
revoke all on function public.withdraw_no_test_request(uuid) from public;
revoke all on function public.create_test_construction(text,text,text,text,uuid,date,date,text,text,text,jsonb) from public;
revoke all on function public.add_construction_task(uuid,text,uuid,date,date,numeric) from public;
revoke all on function public.update_construction_task(uuid,text,int) from public;
revoke all on function public.transition_construction(uuid,text,text) from public;
revoke all on function public.get_testing_center(text,text,int,int) from public;
revoke all on function public.get_test_plan_detail(uuid) from public;
revoke all on function public.get_construction_works(text,int,int) from public;
revoke all on function public.get_construction_detail(uuid) from public;
revoke all on function public.get_test_resource_summary(date,date) from public;
revoke all on function public.get_project_test_summary(uuid) from public;
revoke all on function public.get_project_summaries() from public;
revoke all on function public.complete_project(uuid,boolean,text) from public;

grant execute on function public.create_test_plan(text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]) to authenticated;
grant execute on function public.create_test_cycle(uuid,text,text,text[]) to authenticated;
grant execute on function public.review_test_schedule(uuid,boolean,uuid,date,date,jsonb,text) to authenticated;
grant execute on function public.add_test_activity(uuid,text,text,uuid,date,date,numeric,text,text,jsonb) to authenticated;
grant execute on function public.transition_test_cycle(uuid,text,text) to authenticated;
grant execute on function public.record_test_work_hours(uuid,date,numeric,text) to authenticated;
grant execute on function public.add_test_execution_batch(uuid,uuid,date,text,text,text,int,int,int,int,int,int,int,int,boolean,text,text,text,text) to authenticated;
grant execute on function public.set_test_report_status(uuid,text,text) to authenticated;
grant execute on function public.link_test_repair_task(uuid,uuid,uuid) to authenticated;
grant execute on function public.submit_test_conclusion(uuid,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.review_test_conclusion(uuid,boolean,text) to authenticated;
grant execute on function public.submit_no_test_request(uuid,text,text) to authenticated;
grant execute on function public.review_no_test_request(uuid,boolean,text) to authenticated;
grant execute on function public.withdraw_no_test_request(uuid) to authenticated;
grant execute on function public.create_test_construction(text,text,text,text,uuid,date,date,text,text,text,jsonb) to authenticated;
grant execute on function public.add_construction_task(uuid,text,uuid,date,date,numeric) to authenticated;
grant execute on function public.update_construction_task(uuid,text,int) to authenticated;
grant execute on function public.transition_construction(uuid,text,text) to authenticated;
grant execute on function public.get_testing_center(text,text,int,int) to authenticated;
grant execute on function public.get_test_plan_detail(uuid) to authenticated;
grant execute on function public.get_construction_works(text,int,int) to authenticated;
grant execute on function public.get_construction_detail(uuid) to authenticated;
grant execute on function public.get_test_resource_summary(date,date) to authenticated;
grant execute on function public.get_project_test_summary(uuid) to authenticated;
grant execute on function public.get_project_summaries() to authenticated;
revoke all on function public.get_project_cockpit(uuid) from public;
grant execute on function public.get_project_cockpit(uuid) to authenticated;
grant execute on function public.complete_project(uuid,boolean,text) to authenticated;

comment on column public.projects.acceptance_mode is 'v2.12 已作废历史列；v2.13+ 禁止参与业务逻辑。';
comment on column public.projects.acceptance_owner_id is 'v2.12 已作废历史列；项目任务审批只认 projects.owner_id。';
comment on column public.tasks.requires_acceptance is 'v2.12 已作废历史列；所有 project_id 非空开发任务逐项审批。';
comment on table public.test_rounds is 'v2.5-v2.9 单任务提测历史汇总，只读保留；v2.16+ 使用 test_plans/test_cycles/test_execution_batches。';
