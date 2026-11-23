-- Run in psql with -X -f - and the variables documented in gather-update-and-project-merge.md.
\set ON_ERROR_STOP on
\pset pager off
\if :{?apply}
\else
  \set apply false
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create temp table merge_options on commit drop as
select :'target_id'::uuid as target_id,
       :'expected_tasks'::integer as expected_tasks,
       :'operation'::text as operation,
       :'apply'::boolean as apply;
select operation = 'delete' as delete_sources, apply from merge_options \gset

create temp table merge_sources (id uuid primary key) on commit drop;
insert into merge_sources (id)
select unnest(string_to_array(:'source_ids', ',')::uuid[]);

-- Keep the inventory, update and post-checks in the same write window.
lock table public.projects, public.tasks, public.test_plans,
  public.test_cycle_scope_tasks, public.test_cycle_repair_tasks, public.task_work_segments,
  public.task_approval_audits, public.project_status_events, public.project_no_test_events,
  public.project_admin_action_audits in share row exclusive mode;

create temp table merge_task_before on commit drop as
select t.* from public.tasks t join merge_sources s on s.id = t.project_id;

do $$
declare
  opts merge_options%rowtype;
begin
  select * into strict opts from merge_options;
  if opts.operation not in ('move', 'delete') then
    raise exception 'operation must be move or delete';
  end if;
  if not exists (select 1 from merge_sources) or exists (
    select 1 from merge_sources s left join public.projects p on p.id = s.id
    where p.id is null or s.id = opts.target_id
  ) then
    raise exception 'Source IDs must exist and exclude the target';
  end if;
  if not exists (
    select 1 from public.projects
    where id = opts.target_id and status = 'active' and legacy_team_id is null
  ) then
    raise exception 'The target must be an active shared project';
  end if;
  if opts.expected_tasks <> (select count(*) from merge_task_before) then
    raise exception 'Source task count differs from the reviewed inventory';
  end if;

  if opts.operation = 'delete' then
    if opts.expected_tasks <> 0 or exists (
      select 1 from public.test_plans p join merge_sources s on s.id = p.project_id
    ) or exists (
      select 1 from public.projects p join merge_sources s on s.id = p.id
      where p.no_test_status = 'pending'
    ) then
      raise exception 'Source projects still have tasks, test plans, or pending no-test requests';
    end if;
    if exists (
      select 1 from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'public.projects'::regclass
        and (c.conrelid, c.conname, c.confdeltype::text) not in (
          ('public.tasks'::regclass::oid, 'tasks_project_id_fkey', 'n'),
          ('public.test_plans'::regclass::oid, 'test_plans_project_id_fkey', 'r'),
          ('public.task_approval_audits'::regclass::oid, 'task_approval_audits_project_id_fkey', 'n'),
          ('public.project_status_events'::regclass::oid, 'project_status_events_project_id_fkey', 'c'),
          ('public.project_no_test_events'::regclass::oid, 'project_no_test_events_project_id_fkey', 'c')
        )
    ) then
      raise exception 'Unexpected project foreign key: inspect its delete behavior before proceeding';
    end if;
    return;
  end if;

  if opts.expected_tasks < 1 then
    raise exception 'No tasks to move';
  end if;
  if exists (
    select 1 from public.projects p
    where (p.id = opts.target_id or p.id in (select id from merge_sources))
      and (p.test_state <> 'not_requested' or p.no_test_status <> 'none' or not p.requires_testing)
  ) or exists (
    select 1 from public.test_plans p
    where p.project_id = opts.target_id or p.project_id in (select id from merge_sources)
  ) or exists (
    select 1 from merge_task_before t
    where t.work_source not in ('development', 'legacy_single_test')
      or num_nonnulls(t.test_plan_id, t.test_cycle_id, t.test_activity_id,
                     t.construction_work_id, t.construction_task_id) > 0
  ) or exists (
    select 1 from public.test_cycle_scope_tasks s join merge_task_before t on t.id = s.task_id
  ) or exists (
    select 1 from public.test_cycle_repair_tasks r join merge_task_before t
      on t.id in (r.scope_task_id, r.repair_task_id)
  ) then
    raise exception 'Test-center or no-test records require a project-specific migration plan';
  end if;

  if exists (
    select 1 from public.tasks child join public.tasks parent on parent.id = child.linked_task_id
    left join merge_task_before moving_child on moving_child.id = child.id
    left join merge_task_before moving_parent on moving_parent.id = parent.id
    where (moving_child.id is not null or moving_parent.id is not null)
      and (case when moving_child.id is not null then opts.target_id else child.project_id end)
        is distinct from
          (case when moving_parent.id is not null then opts.target_id else parent.project_id end)
  ) then
    raise exception 'Linked development and legacy test tasks would end up in different projects';
  end if;
end;
$$;

\if :delete_sources
  -- Capture the original project records and approval foreign keys before deletion.
  select jsonb_build_object('table', archive.table_name, 'row', archive.row_data)
  from (
    select 'projects' as table_name, to_jsonb(p) as row_data
      from public.projects p join merge_sources s on s.id = p.id
    union all
    select 'project_status_events', to_jsonb(e)
      from public.project_status_events e join merge_sources s on s.id = e.project_id
    union all
    select 'project_no_test_events', to_jsonb(e)
      from public.project_no_test_events e join merge_sources s on s.id = e.project_id
    union all
    select 'project_admin_action_audits', to_jsonb(a)
      from public.project_admin_action_audits a join merge_sources s on s.id = a.project_id
    union all
    select 'task_approval_audits', to_jsonb(a)
      from public.task_approval_audits a join merge_sources s on s.id = a.project_id
  ) archive order by archive.table_name, archive.row_data->>'id';

  delete from public.projects p using merge_sources s where p.id = s.id returning p.id;

  do $$
  begin
    if exists (select 1 from public.projects p join merge_sources s on s.id = p.id) then
      raise exception 'Source project deletion post-check failed';
    end if;
  end;
  $$;
\else
  select b.id as task_id, b.project_id as old_project_id, o.target_id, b.status, b.work_source
  from merge_task_before b cross join merge_options o order by b.project_id, b.id;

  select b.id as review_task_without_active_group_leader, b.developer_id
  from merge_task_before b where b.status = 'review'
    and not exists (select 1 from public.task_group_leaders(b.developer_id));

  set local app.task_management_rpc = 'on';
  set local app.legacy_test_maintenance = 'on';

  do $$
  declare
    destination uuid := (select target_id from merge_options);
    has_review_tasks boolean := exists (select 1 from merge_task_before where status = 'review');
    moved bigint;
  begin
    if has_review_tasks then
      if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.tasks'::regclass and tgname = 'trg_tasks_rules' and tgenabled = 'O'
      ) then
        raise exception 'Task rules trigger is missing or has an unexpected state';
      end if;
      -- This trigger rejects any change to a task staying in review, even in a management context.
      alter table public.tasks disable trigger trg_tasks_rules;
    end if;

    update public.tasks t set project_id = destination
    from merge_task_before b where t.id = b.id;
    get diagnostics moved = row_count;

    if has_review_tasks then
      alter table public.tasks enable trigger trg_tasks_rules;
    end if;
    if moved <> (select expected_tasks from merge_options) or exists (
      select 1 from merge_task_before b left join public.tasks t on t.id = b.id
      where t.project_id is distinct from destination
        or (to_jsonb(t) - 'project_id' - 'updated_at')
           is distinct from (to_jsonb(b) - 'project_id' - 'updated_at')
    ) or exists (
      select 1 from public.tasks t join merge_sources s on s.id = t.project_id
    ) then
      raise exception 'Task migration post-check failed';
    end if;
    perform public.recompute_project_actual_start(destination);
    raise notice 'Moved % task(s) to %', moved, destination;
  end;
  $$;

  select t.status, count(*) as destination_task_count
  from public.tasks t join merge_options o on o.target_id = t.project_id
  group by t.status order by t.status;
\endif

\if :apply
  commit;
\else
  rollback;
\endif
