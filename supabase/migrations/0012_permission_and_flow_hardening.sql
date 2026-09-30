-- =============================================================
-- 0012_permission_and_flow_hardening.sql
-- Unified project/task visibility, operation boundaries, test-plan visibility,
-- resource accounting, and audited manual test-work corrections.
-- =============================================================

-- ---------- Common capability predicates ----------
create or replace function public.is_team_lead_for(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_team_id is not null and exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.leader_id = public.current_developer_id()
  );
$$;

create or replace function public.can_view_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1
    from public.tasks t
    left join public.projects p on p.id = t.project_id
    where t.id = p_task_id
      and (
        t.developer_id = public.current_developer_id()
        or p.owner_id = public.current_developer_id()
        or exists (
          select 1
          from public.developer_teams member
          join public.teams led on led.id = member.team_id
          where member.developer_id = t.developer_id
            and led.leader_id = public.current_developer_id()
        )
        or (t.work_source='test_activity' and public.can_view_test_plan(t.test_plan_id))
        or (t.work_source='construction' and public.can_view_construction(t.construction_work_id))
      )
  );
$$;

create or replace function public.can_view_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (
        p.owner_id = public.current_developer_id()
        or public.is_team_lead_for(p.team_id)
        or exists (
          select 1 from public.tasks t
          where t.project_id = p.id and public.can_view_task(t.id)
        )
        or exists (
          select 1 from public.test_plans tp
          join public.test_cycles c on c.plan_id=tp.id
          left join public.test_cycle_participants cp on cp.cycle_id=c.id
          where tp.project_id=p.id and (
            tp.created_by=public.current_developer_id()
            or c.main_tester_id=public.current_developer_id()
            or cp.developer_id=public.current_developer_id()
          )
        )
      )
  );
$$;

create or replace function public.can_execute_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.task_type='dev' and t.work_source='development'
      and t.developer_id = public.current_developer_id()
  );
$$;

create or replace function public.owns_task_project(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.tasks t join public.projects p on p.id=t.project_id
    where t.id=p_task_id and p.owner_id=public.current_developer_id()
  );
$$;

create or replace function public.can_lead_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.tasks t
    join public.developer_teams member on member.developer_id=t.developer_id
    join public.teams led on led.id=member.team_id
    where t.id=p_task_id and led.leader_id=public.current_developer_id()
  );
$$;

create or replace function public.can_approve_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.tasks t
    join public.projects p on p.id = t.project_id
    join public.developers d on d.id = p.owner_id and d.is_active
    where t.id = p_task_id
      and t.task_type = 'dev'
      and t.status = 'review'
      and p.owner_id = public.current_developer_id()
  );
$$;

revoke all on function public.is_team_lead_for(uuid) from public;
revoke all on function public.can_view_task(uuid) from public;
revoke all on function public.can_view_project(uuid) from public;
revoke all on function public.can_execute_task(uuid) from public;
revoke all on function public.owns_task_project(uuid) from public;
revoke all on function public.can_lead_task(uuid) from public;
revoke all on function public.can_approve_task(uuid) from public;
grant execute on function public.is_team_lead_for(uuid) to authenticated;
grant execute on function public.can_view_task(uuid) to authenticated;
grant execute on function public.can_view_project(uuid) to authenticated;
grant execute on function public.can_execute_task(uuid) to authenticated;
grant execute on function public.owns_task_project(uuid) to authenticated;
grant execute on function public.can_lead_task(uuid) to authenticated;
grant execute on function public.can_approve_task(uuid) to authenticated;

-- ---------- Project update boundary and admin audit ----------
create table public.project_admin_action_audits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  action text not null check (action in ('business_update','structure_update')),
  before_data jsonb not null,
  after_data jsonb not null,
  actor_id uuid references public.developers(id) on delete set null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);
create index idx_project_admin_action_audits_project
  on public.project_admin_action_audits(project_id, created_at desc);
alter table public.project_admin_action_audits enable row level security;
alter table public.project_admin_action_audits force row level security;
create policy project_admin_action_audits_read on public.project_admin_action_audits
  for select to authenticated using (public.is_admin() or public.can_view_project(project_id));
grant select on public.project_admin_action_audits to authenticated;
revoke insert, update, delete on public.project_admin_action_audits from authenticated;

drop policy if exists proj_select on public.projects;
drop policy if exists proj_insert on public.projects;
drop policy if exists proj_update on public.projects;
drop policy if exists proj_delete on public.projects;
create policy proj_select on public.projects for select to authenticated
  using (public.can_view_project(id));
create policy proj_insert on public.projects for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_manager() and public.is_team_lead_for(team_id))
  );
create policy proj_update on public.projects for update to authenticated
  using (owner_id = public.current_developer_id())
  with check (owner_id = public.current_developer_id());

create or replace function public.guard_project_update_boundary()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_internal boolean :=
    coalesce(current_setting('app.project_business_rpc', true), '') = 'on'
    or coalesce(current_setting('app.project_structure_rpc', true), '') = 'on'
    or coalesce(current_setting('app.project_complete_rpc', true), '') = 'on'
    or coalesce(current_setting('app.project_actual_start_automation', true), '') = 'on'
    or coalesce(current_setting('app.test_center_rpc', true), '') = 'on';
begin
  if v_internal then return new; end if;
  if old.owner_id <> public.current_developer_id() then
    raise exception 'Only the current project owner may update project business fields';
  end if;
  if new.team_id is distinct from old.team_id
     or new.owner_id is distinct from old.owner_id
     or new.status is distinct from old.status
     or new.actual_started_at is distinct from old.actual_started_at
     or new.completed_at is distinct from old.completed_at then
    raise exception 'Project structure and lifecycle fields require a dedicated audited action';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_0012_project_update_boundary on public.projects;
create trigger trg_0012_project_update_boundary
  before update on public.projects
  for each row execute function public.guard_project_update_boundary();

create or replace function public.update_project_business(
  p_project_id uuid,
  p_name text,
  p_description text,
  p_start_date date,
  p_end_date date
) returns public.projects language plpgsql security definer set search_path = public as $$
declare v_project public.projects%rowtype;
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project does not exist'; end if;
  if v_project.owner_id <> public.current_developer_id() then
    raise exception 'Only the current project owner may edit project business fields';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Project name is required'; end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'Project end date cannot be earlier than start date';
  end if;
  perform set_config('app.project_business_rpc', 'on', true);
  update public.projects set
    name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
    start_date = p_start_date, end_date = p_end_date
  where id = p_project_id returning * into v_project;
  return v_project;
end;
$$;

create or replace function public.admin_update_project_business(
  p_project_id uuid,
  p_name text,
  p_description text,
  p_start_date date,
  p_end_date date,
  p_reason text
) returns public.projects language plpgsql security definer set search_path = public as $$
declare v_old public.projects%rowtype; v_new public.projects%rowtype; v_reason text := nullif(trim(p_reason), '');
begin
  if not public.is_admin() then raise exception 'Only admin may use the exception proxy'; end if;
  if public.current_developer_id() is null then raise exception 'Admin account is not linked to a developer profile'; end if;
  if v_reason is null then raise exception 'Admin exception reason is required'; end if;
  select * into v_old from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project does not exist'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Project name is required'; end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'Project end date cannot be earlier than start date';
  end if;
  perform set_config('app.project_business_rpc', 'on', true);
  update public.projects set name=trim(p_name), description=nullif(trim(coalesce(p_description,'')),''),
    start_date=p_start_date, end_date=p_end_date
  where id=p_project_id returning * into v_new;
  insert into public.project_admin_action_audits(project_id,action,before_data,after_data,actor_id,reason)
  values(p_project_id,'business_update',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

create or replace function public.change_project_governance(
  p_project_id uuid, p_team_id uuid, p_owner_id uuid, p_reason text
) returns public.projects language plpgsql security definer set search_path = public as $$
declare v_old public.projects%rowtype; v_new public.projects%rowtype; v_reason text := nullif(trim(p_reason), '');
begin
  if public.current_developer_id() is null then raise exception 'Account is not linked to a developer profile'; end if;
  if v_reason is null then raise exception 'Structure change reason is required'; end if;
  if not exists(select 1 from public.teams where id=p_team_id) then raise exception 'Team does not exist'; end if;
  if not exists(select 1 from public.developers where id=p_owner_id and is_active) then raise exception 'Owner must be active'; end if;
  select * into v_old from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project does not exist'; end if;
  if not public.is_admin() and not (
    public.is_manager() and public.is_team_lead_for(v_old.team_id) and public.is_team_lead_for(p_team_id)
  ) then raise exception 'Only admin or the manager responsible for both teams may change project governance'; end if;
  perform set_config('app.project_structure_rpc','on',true);
  update public.projects set team_id=p_team_id,owner_id=p_owner_id where id=p_project_id returning * into v_new;
  insert into public.project_admin_action_audits(project_id,action,before_data,after_data,actor_id,reason)
  values(p_project_id,'structure_update',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

revoke all on function public.update_project_business(uuid,text,text,date,date) from public;
revoke all on function public.admin_update_project_business(uuid,text,text,date,date,text) from public;
revoke all on function public.change_project_governance(uuid,uuid,uuid,text) from public;
grant execute on function public.update_project_business(uuid,text,text,date,date) to authenticated;
grant execute on function public.admin_update_project_business(uuid,text,text,date,date,text) to authenticated;
grant execute on function public.change_project_governance(uuid,uuid,uuid,text) to authenticated;

create or replace function public.transition_project(
  p_project_id uuid, p_action text, p_reason text default null
) returns public.projects language plpgsql security definer set search_path = public as $$
declare v_project public.projects%rowtype; v_next text; v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  select * into v_project from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project does not exist'; end if;
  if v_project.owner_id<>public.current_developer_id() and not public.is_admin() then
    raise exception 'Only the project owner may pause or resume the project';
  end if;
  if public.is_admin() and v_project.owner_id<>public.current_developer_id() and v_reason is null then
    raise exception 'Admin exception reason is required';
  end if;
  if p_action='pause' and v_project.status='active' then v_next:='paused';
  elsif p_action='resume' and v_project.status='paused' then v_next:='active';
  else raise exception 'Action is not valid for the current project state'; end if;
  perform set_config('app.project_business_rpc','on',true);
  if public.is_admin() and v_project.owner_id<>public.current_developer_id() then
    perform set_config('app.project_admin_force','on',true);
    perform set_config('app.project_force_reason',v_reason,true);
  end if;
  update public.projects set status=v_next where id=p_project_id returning * into v_project;
  return v_project;
end;
$$;

alter function public.complete_project(uuid,boolean,text) rename to complete_project_v218;
revoke all on function public.complete_project_v218(uuid,boolean,text) from public,authenticated;
create function public.complete_project(
  p_project_id uuid,p_force boolean default false,p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner uuid; v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  select owner_id into v_owner from public.projects where id=p_project_id;
  if not found then raise exception 'Project does not exist'; end if;
  if public.is_admin() and v_owner<>public.current_developer_id() then
    if not p_force or v_reason is null then raise exception 'Admin exception completion requires force=true and a reason'; end if;
  elsif v_owner<>public.current_developer_id() then
    raise exception 'Only the project owner may complete the project';
  end if;
  return public.complete_project_v218(p_project_id,p_force,p_reason);
end;
$$;
revoke all on function public.transition_project(uuid,text,text) from public;
revoke all on function public.complete_project(uuid,boolean,text) from public;
grant execute on function public.transition_project(uuid,text,text) to authenticated;
grant execute on function public.complete_project(uuid,boolean,text) to authenticated;

-- ---------- Task operation boundary and management audit ----------
create table public.task_management_audits (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  action text not null check (action in ('lead_manage','admin_manage','admin_execute')),
  before_data jsonb not null,
  after_data jsonb not null,
  actor_id uuid references public.developers(id) on delete set null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);
create index idx_task_management_audits_task on public.task_management_audits(task_id,created_at desc);
alter table public.task_management_audits enable row level security;
alter table public.task_management_audits force row level security;
create policy task_management_audits_read on public.task_management_audits for select to authenticated
  using (public.can_view_task(task_id));
grant select on public.task_management_audits to authenticated;
revoke insert, update, delete on public.task_management_audits from authenticated;

drop policy if exists task_select on public.tasks;
drop policy if exists task_insert on public.tasks;
drop policy if exists task_update on public.tasks;
drop policy if exists task_delete on public.tasks;
create policy task_select on public.tasks for select to authenticated using (public.can_view_task(id));
create policy task_insert on public.tasks for insert to authenticated with check(
  -- P0 direct-insert invariant (static assertion): ordinary table INSERT is
  -- only for development tasks. Test-center tasks must use their audited
  -- SECURITY DEFINER RPCs, whose table-owner execution bypasses this RLS check.
  task_type='dev'
  and work_source='development'
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
      -- Projectless development tasks remain valid per the v2.13/0007 flow.
      -- A known project UUID must not make an otherwise invisible project writable.
      (project_id is null or public.can_view_project(project_id))
      and (
        developer_id=public.current_developer_id()
        or (
          public.is_manager()
          and exists(
            select 1 from public.developer_teams member join public.teams led on led.id=member.team_id
            where member.developer_id=tasks.developer_id and led.leader_id=public.current_developer_id()
          )
        )
      )
    )
  )
);
create policy task_update on public.tasks for update to authenticated
  using (
    public.can_execute_task(id)
    or (status='review' and public.can_approve_task(id))
  )
  with check (
    public.can_execute_task(id)
    or public.owns_task_project(id)
  );

create or replace function public.guard_task_actor_boundary()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rpc boolean :=
    coalesce(current_setting('app.test_center_rpc',true),'')='on'
    or coalesce(current_setting('app.legacy_test_maintenance',true),'')='on'
    or coalesce(current_setting('app.task_management_rpc',true),'')='on'
    or coalesce(current_setting('app.admin_task_action',true),'')='on'
    or coalesce(current_setting('app.admin_approval_proxy',true),'')='on';
begin
  if v_rpc then return new; end if;

  -- P0 approval invariant (static assertion): a normal project owner may only
  -- submit status, plus reject_note when returning review -> in_progress.
  -- All other OLD task fields must remain byte-for-byte equivalent; updated_at
  -- is ignored because the shared timestamp trigger maintains it afterwards.
  if old.status='review' and public.can_approve_task(old.id) then
    if new.status='review' then
      if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
        raise exception 'Review tasks are locked; use approve or reject only';
      end if;
      return new;
    end if;

    if new.status in ('done','delayed_done') then
      if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
        raise exception 'Approval may only change task status';
      end if;
      return new;
    end if;

    if new.status='in_progress' then
      if (to_jsonb(new)-'status'-'reject_note'-'updated_at')
           is distinct from (to_jsonb(old)-'status'-'reject_note'-'updated_at') then
        raise exception 'Rejection may only change task status and reject reason';
      end if;
      return new;
    end if;

    raise exception 'Review tasks may only be approved or rejected to in progress';
  end if;

  -- P0 state-machine invariant (static assertions): todo cannot jump to done;
  -- testing/review/terminal rows are locked to ordinary PATCH; transitions only
  -- accept status (and delay_note on submission). Dedicated RPC contexts above
  -- remain responsible for their own capability, state and audit checks.
  -- Isolated-DB regression contract:
  --   assignee PATCH todo -> done        => Illegal task status transition
  --   assignee PATCH done title/fields   => Testing and terminal tasks are locked
  if old.status in ('testing','done','delayed_done') then
    raise exception 'Testing and terminal tasks are locked to ordinary updates';
  end if;
  if old.status='review' then
    raise exception 'Only the current project owner may approve or reject a review task';
  end if;
  if old.developer_id is null or old.developer_id<>public.current_developer_id() then
    raise exception 'Only the current assignee may update an active task';
  end if;

  if old.status is distinct from new.status then
    if old.status='todo' and new.status='in_progress' then
      if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
        raise exception 'Starting a task may only change status';
      end if;
      return new;
    end if;

    if old.status='in_progress' and new.status='paused' then
      if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
        raise exception 'Pausing a task may only change status';
      end if;
      return new;
    end if;

    if old.status='in_progress' and new.status in ('review','done','delayed_done') then
      if (to_jsonb(new)-'status'-'delay_note'-'updated_at')
           is distinct from (to_jsonb(old)-'status'-'delay_note'-'updated_at') then
        raise exception 'Submitting a task may only change status and delay reason';
      end if;
      return new;
    end if;

    if old.status='paused' and new.status='in_progress' then
      if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
        raise exception 'Resuming a task may only change status';
      end if;
      return new;
    end if;

    raise exception 'Illegal task status transition: % -> %',old.status,new.status;
  end if;

  if old.status in ('todo','paused') then
    if (to_jsonb(new)-'title'-'description'-'updated_at')
         is distinct from (to_jsonb(old)-'title'-'description'-'updated_at') then
      raise exception 'Only title and description may be edited without a task state action';
    end if;
  elsif old.status='in_progress' then
    if (to_jsonb(new)-'title'-'description'-'delay_note'-'updated_at')
         is distinct from (to_jsonb(old)-'title'-'description'-'delay_note'-'updated_at') then
      raise exception 'Only title, description and delay reason may be edited while in progress';
    end if;
  else
    raise exception 'Current task state is locked to ordinary updates';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_0012_task_actor_boundary on public.tasks;
create trigger trg_0012_task_actor_boundary before update on public.tasks
  for each row execute function public.guard_task_actor_boundary();

create or replace function public.lead_manage_task(
  p_task_id uuid, p_developer_id uuid, p_start_date date, p_due_date date, p_priority text, p_reason text
) returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_old public.tasks%rowtype; v_new public.tasks%rowtype; v_reason text:=nullif(trim(p_reason),'');
begin
  select * into v_old from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task does not exist'; end if;
  if not public.can_lead_task(p_task_id) then raise exception 'Only the leader of this task team may manage assignment or schedule'; end if;
  if v_old.status in ('review','testing','done','delayed_done') then raise exception 'Locked or terminal tasks cannot be reassigned/rescheduled'; end if;
  if v_reason is null then raise exception 'Management reason is required'; end if;
  if p_due_date<p_start_date then raise exception 'Due date cannot be earlier than start date'; end if;
  if p_priority not in ('low','medium','high','urgent') then raise exception 'Invalid priority'; end if;
  if p_developer_id is not null and not exists(
    select 1 from public.developer_teams where developer_id=p_developer_id and team_id=v_old.team_id
  ) then raise exception 'New assignee is not a member of the task team'; end if;
  perform set_config('app.task_management_rpc','on',true);
  update public.tasks set developer_id=p_developer_id,start_date=p_start_date,due_date=p_due_date,priority=p_priority
  where id=p_task_id returning * into v_new;
  insert into public.task_management_audits(task_id,action,before_data,after_data,actor_id,reason)
  values(p_task_id,'lead_manage',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

create or replace function public.admin_manage_task(
  p_task_id uuid, p_developer_id uuid, p_team_id uuid, p_start_date date, p_due_date date, p_priority text, p_reason text
) returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_old public.tasks%rowtype; v_new public.tasks%rowtype; v_reason text:=nullif(trim(p_reason),'');
begin
  if not public.is_admin() then raise exception 'Only admin may use the exception proxy'; end if;
  if public.current_developer_id() is null then raise exception 'Admin account is not linked to a developer profile'; end if;
  if v_reason is null then raise exception 'Admin exception reason is required'; end if;
  if p_due_date<p_start_date then raise exception 'Due date cannot be earlier than start date'; end if;
  if p_priority not in ('low','medium','high','urgent') then raise exception 'Invalid priority'; end if;
  select * into v_old from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task does not exist'; end if;
  perform set_config('app.task_management_rpc','on',true);
  update public.tasks set developer_id=p_developer_id,team_id=p_team_id,start_date=p_start_date,due_date=p_due_date,priority=p_priority
  where id=p_task_id returning * into v_new;
  insert into public.task_management_audits(task_id,action,before_data,after_data,actor_id,reason)
  values(p_task_id,'admin_manage',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

create or replace function public.admin_execute_task_action(
  p_task_id uuid, p_action text, p_reason text, p_delay_note text default null
) returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_old public.tasks%rowtype; v_new public.tasks%rowtype; v_reason text:=nullif(trim(p_reason),''); v_status text;
begin
  if not public.is_admin() then raise exception 'Only admin may use the exception proxy'; end if;
  if public.current_developer_id() is null then raise exception 'Admin account is not linked to a developer profile'; end if;
  if v_reason is null then raise exception 'Admin exception reason is required'; end if;
  select * into v_old from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task does not exist'; end if;
  if p_action='start' and v_old.status='todo' then v_status:='in_progress';
  elsif p_action='pause' and v_old.status='in_progress' then v_status:='paused';
  elsif p_action='resume' and v_old.status='paused' then v_status:='in_progress';
  elsif p_action='submit' and v_old.status='in_progress' then v_status:='review';
  else raise exception 'Action is not valid for the current task state'; end if;
  if p_action='submit' and v_old.due_date<current_date and nullif(trim(coalesce(p_delay_note,'')),'') is null then
    raise exception 'Overdue submission requires a delay reason';
  end if;
  perform set_config('app.admin_task_action','on',true);
  update public.tasks set status=v_status,
    delay_note=case when p_action='submit' then nullif(trim(coalesce(p_delay_note,'')),'') else delay_note end
  where id=p_task_id returning * into v_new;
  insert into public.task_management_audits(task_id,action,before_data,after_data,actor_id,reason)
  values(p_task_id,'admin_execute',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

revoke all on function public.lead_manage_task(uuid,uuid,date,date,text,text) from public;
revoke all on function public.admin_manage_task(uuid,uuid,uuid,date,date,text,text) from public;
revoke all on function public.admin_execute_task_action(uuid,text,text,text) from public;
grant execute on function public.lead_manage_task(uuid,uuid,date,date,text,text) to authenticated;
grant execute on function public.admin_manage_task(uuid,uuid,uuid,date,date,text,text) to authenticated;
grant execute on function public.admin_execute_task_action(uuid,text,text,text) to authenticated;

-- Related task data follows the same visible task set.
drop policy if exists cmt_select on public.task_comments;
create policy cmt_select on public.task_comments for select to authenticated using (public.can_view_task(task_id));
drop policy if exists cmt_insert on public.task_comments;
drop policy if exists cmt_update on public.task_comments;
drop policy if exists cmt_delete on public.task_comments;
create policy cmt_insert on public.task_comments for insert to authenticated
  with check(author_id=public.current_developer_id() and public.can_view_task(task_id));
create policy cmt_update on public.task_comments for update to authenticated
  using(author_id=public.current_developer_id() and public.can_view_task(task_id))
  with check(author_id=public.current_developer_id() and public.can_view_task(task_id));
create policy cmt_delete on public.task_comments for delete to authenticated
  using((author_id=public.current_developer_id() or public.is_admin()) and public.can_view_task(task_id));
drop policy if exists test_rounds_select on public.test_rounds;
create policy test_rounds_select on public.test_rounds for select to authenticated using (public.can_view_task(test_task_id));
drop policy if exists task_approval_audits_select on public.task_approval_audits;
create policy task_approval_audits_select on public.task_approval_audits for select to authenticated using (public.can_view_task(task_id));
drop policy if exists project_status_events_select on public.project_status_events;
create policy project_status_events_select on public.project_status_events for select to authenticated using (public.can_view_project(project_id));
drop policy if exists no_test_events_read on public.project_no_test_events;
create policy no_test_events_read on public.project_no_test_events for select to authenticated using (public.can_view_project(project_id));

-- ---------- Valid work-segment truth and audited manual corrections ----------
alter table public.task_work_segments
  add column voided_at timestamptz,
  add column voided_by uuid references public.developers(id) on delete set null,
  add column void_reason text,
  add column updated_at timestamptz not null default now(),
  add constraint task_work_segments_void_consistency check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(trim(void_reason))>0)
  );
create index idx_work_segments_valid_task on public.task_work_segments(task_id,started_at) where voided_at is null;

drop policy if exists task_work_segments_read on public.task_work_segments;
drop policy if exists work_select on public.task_work_segments;
drop policy if exists tws_select on public.task_work_segments;
create policy task_work_segments_read on public.task_work_segments for select to authenticated
  using (public.can_view_task(task_id));

create table public.task_work_segment_audits (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.task_work_segments(id) on delete restrict,
  task_id uuid not null references public.tasks(id) on delete cascade,
  action text not null check (action in ('updated','voided')),
  before_data jsonb not null,
  after_data jsonb not null,
  actor_id uuid references public.developers(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_task_work_segment_audits_segment on public.task_work_segment_audits(segment_id,created_at desc);
alter table public.task_work_segment_audits enable row level security;
alter table public.task_work_segment_audits force row level security;
create policy task_work_segment_audits_read on public.task_work_segment_audits for select to authenticated
  using (public.can_view_task(task_id));
grant select on public.task_work_segment_audits to authenticated;
revoke insert,update,delete on public.task_work_segment_audits from authenticated;

create or replace function public.can_correct_test_work_segment(p_segment_id uuid, p_reason text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_task public.tasks%rowtype; v_segment public.task_work_segments%rowtype; v_terminal boolean; v_team uuid;
begin
  select * into v_segment from public.task_work_segments where id=p_segment_id;
  if not found or v_segment.ended_at is null or v_segment.voided_at is not null then return false; end if;
  select * into v_task from public.tasks where id=v_segment.task_id;
  if not found or v_task.work_source not in ('test_activity','construction') then return false; end if;
  v_terminal := v_task.status in ('done','delayed_done');
  if v_task.work_source='test_activity' then
    select tp.test_team_id, v_terminal or c.status in ('passed','failed','cancelled')
    into v_team,v_terminal
    from public.test_cycles c join public.test_plans tp on tp.id=c.plan_id where c.id=v_task.test_cycle_id;
  else
    select null::uuid, v_terminal or w.status in ('completed','cancelled')
    into v_team,v_terminal from public.test_construction_works w where w.id=v_task.construction_work_id;
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then return false; end if;
  if public.is_admin() then return true; end if;
  -- P0 correction-source invariant (static assertion): automatic segments
  -- are never silently editable by the recorded developer. Test leads/admin
  -- correct automatic anomalies and every terminal record through this audit.
  if v_terminal or v_segment.entry_source='automatic' then
    return public.is_test_lead(v_team);
  end if;
  return v_segment.entry_source='manual'
    and v_task.status in ('in_progress','paused')
    and v_segment.developer_id=public.current_developer_id();
end;
$$;

create or replace function public.recompute_project_actual_start(p_project_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_project_id is null then return; end if;
  perform set_config('app.project_actual_start_automation','on',true);
  update public.projects p set actual_started_at=(
    select min(ws.started_at)
    from public.tasks t join public.task_work_segments ws on ws.task_id=t.id
    where t.project_id=p.id and ws.ended_at is not null and ws.voided_at is null
  ) where p.id=p_project_id;
end;
$$;

create or replace function public.track_project_actual_start()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_new_project uuid; v_old_project uuid;
begin
  select project_id into v_new_project from public.tasks where id=new.task_id;
  if tg_op='UPDATE' then select project_id into v_old_project from public.tasks where id=old.task_id; end if;
  perform public.recompute_project_actual_start(v_new_project);
  if v_old_project is distinct from v_new_project then perform public.recompute_project_actual_start(v_old_project); end if;
  return new;
end;
$$;
drop trigger if exists trg_work_segments_project_start on public.task_work_segments;
create trigger trg_work_segments_project_start
  after insert or update of started_at,ended_at,task_id,voided_at on public.task_work_segments
  for each row execute function public.track_project_actual_start();

create or replace function public.get_test_work_entries(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_task(p_task_id) then raise exception 'No permission to view this task work log'; end if;
  if not exists(select 1 from public.tasks where id=p_task_id and work_source in ('test_activity','construction')) then
    raise exception 'Task is not a test-center work object';
  end if;
  return jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(ws)||jsonb_build_object('developer_name',d.name) order by ws.started_at desc)
      from public.task_work_segments ws left join public.developers d on d.id=ws.developer_id
      where ws.task_id=p_task_id),'[]'::jsonb),
    'audits',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from public.task_work_segment_audits a where a.task_id=p_task_id),'[]'::jsonb)
  );
end;
$$;

create or replace function public.update_test_work_entry(
  p_segment_id uuid,p_work_date date,p_hours numeric,p_note text,p_reason text default null
) returns public.task_work_segments language plpgsql security definer set search_path = public as $$
declare v_old public.task_work_segments%rowtype; v_new public.task_work_segments%rowtype; v_start timestamptz;
begin
  if p_work_date is null then raise exception 'Work date is required'; end if;
  if p_hours<=0 or p_hours>24 then raise exception 'Daily hours must be greater than 0 and no more than 24'; end if;
  if not public.can_correct_test_work_segment(p_segment_id,p_reason) then raise exception 'No permission to correct this work entry'; end if;
  select * into v_old from public.task_work_segments where id=p_segment_id for update;
  v_start:=p_work_date::timestamp+interval '9 hours';
  update public.task_work_segments set started_at=v_start,ended_at=v_start+(p_hours||' hours')::interval,
    note=nullif(trim(coalesce(p_note,'')),''),updated_at=now()
  where id=p_segment_id returning * into v_new;
  insert into public.task_work_segment_audits(segment_id,task_id,action,before_data,after_data,actor_id,reason)
  values(p_segment_id,v_old.task_id,'updated',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),nullif(trim(coalesce(p_reason,'')),''));
  return v_new;
end;
$$;

create or replace function public.void_test_work_entry(p_segment_id uuid,p_reason text)
returns public.task_work_segments language plpgsql security definer set search_path = public as $$
declare v_old public.task_work_segments%rowtype; v_new public.task_work_segments%rowtype; v_reason text:=nullif(trim(p_reason),'');
begin
  if v_reason is null then raise exception 'Void reason is required'; end if;
  if not public.can_correct_test_work_segment(p_segment_id,p_reason) then raise exception 'No permission to void this work entry'; end if;
  select * into v_old from public.task_work_segments where id=p_segment_id for update;
  update public.task_work_segments set voided_at=now(),voided_by=public.current_developer_id(),void_reason=v_reason,updated_at=now()
  where id=p_segment_id returning * into v_new;
  insert into public.task_work_segment_audits(segment_id,task_id,action,before_data,after_data,actor_id,reason)
  values(p_segment_id,v_old.task_id,'voided',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

revoke all on function public.can_correct_test_work_segment(uuid,text) from public;
revoke all on function public.recompute_project_actual_start(uuid) from public;
revoke all on function public.get_test_work_entries(uuid) from public;
revoke all on function public.update_test_work_entry(uuid,date,numeric,text,text) from public;
revoke all on function public.void_test_work_entry(uuid,text) from public;
grant execute on function public.get_test_work_entries(uuid) to authenticated;
grant execute on function public.update_test_work_entry(uuid,date,numeric,text,text) to authenticated;
grant execute on function public.void_test_work_entry(uuid,text) to authenticated;

-- ---------- Server-side task list and pending-approval count ----------
create or replace function public.list_tasks(
  p_scope text default 'all', p_query text default null, p_task_type text default null,
  p_project_id uuid default null, p_statuses text[] default null, p_priority text default null,
  p_assignee text default null, p_team_id uuid default null, p_timing text default null,
  p_preset text default null, p_result text default null, p_blocked boolean default null,
  p_summary text default null, p_focus_id uuid default null, p_page int default 1,
  p_page_size int default 10
) returns jsonb language sql stable security definer set search_path = public as $$
  with filtered as (
    select t.*,
      round(coalesce(eff.hours,0)::numeric,1) actual_effort_hours,
      coalesce(days.day_count,0)::int actual_day_count
    from public.tasks t
    left join public.projects p on p.id=t.project_id
    left join lateral(
      select sum(extract(epoch from(ws.ended_at-ws.started_at))/3600.0) hours
      from public.task_work_segments ws
      where ws.task_id=t.id and ws.ended_at is not null and ws.voided_at is null
    )eff on true
    left join lateral(
      select count(distinct g.work_day)::int day_count
      from public.task_work_segments ws
      cross join lateral generate_series(ws.started_at::date,ws.ended_at::date,interval '1 day')g(work_day)
      where ws.task_id=t.id and ws.ended_at is not null and ws.voided_at is null
    )days on true
    where public.can_view_task(t.id)
      and (p_focus_id is null or t.id=p_focus_id)
      and (p_project_id is null or t.project_id=p_project_id)
      and (coalesce(p_task_type,'')='' or t.task_type=p_task_type)
      and (p_statuses is null or cardinality(p_statuses)=0 or t.status=any(p_statuses))
      and (coalesce(p_priority,'')='' or t.priority=p_priority)
      and (p_team_id is null or t.team_id=p_team_id)
      and (coalesce(p_assignee,'')='' or (p_assignee='unassigned' and t.developer_id is null)
        or (p_assignee<>'unassigned' and t.developer_id::text=p_assignee))
      and (coalesce(p_timing,'')='' or (p_timing='overdue' and t.status not in('done','delayed_done') and t.due_date<current_date)
        or (p_timing='delayed' and t.status='delayed_done'))
      and (coalesce(p_preset,'')=''
        or (p_preset='testing_active' and ((t.task_type='dev' and t.status='testing') or (t.task_type='test' and t.status not in('done','delayed_done') and t.test_result is null)))
        or (p_preset='pending_my_approval' and t.status='review' and p.owner_id=public.current_developer_id())
        or (p_preset='in_progress' and t.status='in_progress')
        or (p_preset='completed' and t.status='done')
        or (p_preset='delayed_done' and t.status='delayed_done')
        or (p_preset='overdue' and t.status not in('done','delayed_done') and t.due_date<current_date))
      and (coalesce(p_result,'')='' or (t.task_type='test' and t.test_result=p_result))
      and (p_blocked is null or exists(select 1 from public.test_rounds tr where tr.test_task_id=t.id and tr.blocked=p_blocked))
      and (coalesce(p_summary,'')='' or (p_summary='missing' and t.task_type='test' and t.test_result is not null
        and not exists(select 1 from public.test_rounds tr where tr.test_task_id=t.id and tr.result is not null)))
      and (coalesce(trim(p_query),'')='' or t.title ilike '%'||trim(p_query)||'%'
        or coalesce(t.description,'') ilike '%'||trim(p_query)||'%' or coalesce(p.name,'') ilike '%'||trim(p_query)||'%')
      and (coalesce(p_scope,'all')='all'
        or (p_scope='mine' and t.developer_id=public.current_developer_id())
        -- P0 team-scope invariant (static assertion): team = current assignee's
        -- own tasks UNION tasks assigned to effective members of led teams.
        -- Never authorize team scope from tasks.team_id alone.
        or (p_scope='team' and (
          t.developer_id=public.current_developer_id()
          or exists(
            select 1 from public.developer_teams member join public.teams led on led.id=member.team_id
            where member.developer_id=t.developer_id and led.leader_id=public.current_developer_id()
          )
        )))
  ), counted as(select filtered.*,count(*) over()::int total_count from filtered),
  page_rows as(select * from counted order by created_at desc,id
    offset (greatest(coalesce(p_page,1),1)-1)*least(greatest(coalesce(p_page_size,10),1),100)
    limit least(greatest(coalesce(p_page_size,10),1),100))
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(r)-'total_count' order by r.created_at desc,r.id) from page_rows r),'[]'::jsonb),
    'total',coalesce((select max(total_count) from counted),0),
    'page',greatest(coalesce(p_page,1),1),'page_size',least(greatest(coalesce(p_page_size,10),1),100)
  );
$$;

create or replace function public.get_my_pending_approval_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.tasks t join public.projects p on p.id=t.project_id
  where t.status='review' and t.task_type='dev' and p.owner_id=public.current_developer_id()
    and public.can_view_task(t.id);
$$;

create or replace function public.get_dashboard_task_counts()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'total',count(*)::int,
    'in_progress',count(*) filter(where t.status='in_progress')::int,
    'testing_active',count(*) filter(where (t.task_type='dev' and t.status='testing')
      or (t.task_type='test' and t.status not in('done','delayed_done') and t.test_result is null))::int,
    'pending_my_approval',count(*) filter(where t.status='review' and p.owner_id=public.current_developer_id())::int,
    'completed',count(*) filter(where t.status='done')::int,
    'delayed_done',count(*) filter(where t.status='delayed_done')::int,
    'overdue',count(*) filter(where t.status not in('done','delayed_done') and t.due_date<current_date)::int
  )
  from public.tasks t left join public.projects p on p.id=t.project_id
  where public.can_view_task(t.id);
$$;

revoke all on function public.list_tasks(text,text,text,uuid,text[],text,text,uuid,text,text,text,boolean,text,uuid,int,int) from public;
revoke all on function public.get_my_pending_approval_count() from public;
revoke all on function public.get_dashboard_task_counts() from public;
grant execute on function public.list_tasks(text,text,text,uuid,text[],text,text,uuid,text,text,text,boolean,text,uuid,int,int) to authenticated;
grant execute on function public.get_my_pending_approval_count() to authenticated;
grant execute on function public.get_dashboard_task_counts() to authenticated;

-- ---------- Test-plan and construction visibility ----------
create or replace function public.can_view_test_plan(p_plan_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists(
    select 1 from public.test_plans tp
    left join public.projects p on p.id=tp.project_id
    where tp.id=p_plan_id and (
      tp.created_by=public.current_developer_id()
      or p.owner_id=public.current_developer_id()
      or public.is_test_lead(tp.test_team_id)
      or exists(select 1 from public.test_cycles c where c.plan_id=tp.id and c.main_tester_id=public.current_developer_id())
      or exists(select 1 from public.test_cycles c join public.test_cycle_participants cp on cp.cycle_id=c.id
        where c.plan_id=tp.id and cp.developer_id=public.current_developer_id())
      or exists(select 1 from public.test_cycles c join public.test_activities a on a.cycle_id=c.id
        where c.plan_id=tp.id and a.owner_id=public.current_developer_id())
      or exists(select 1 from public.test_cycles c join public.test_activities a on a.cycle_id=c.id
        join public.test_activity_participants ap on ap.activity_id=a.id
        where c.plan_id=tp.id and ap.developer_id=public.current_developer_id())
    )
  );
$$;

create or replace function public.can_view_construction(p_work_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists(
    select 1 from public.test_construction_works w
    where w.id=p_work_id and (
      w.created_by=public.current_developer_id() or w.owner_id=public.current_developer_id()
      or public.is_test_lead()
      or exists(select 1 from public.test_construction_participants cp where cp.work_id=w.id and cp.developer_id=public.current_developer_id())
      or exists(select 1 from public.test_construction_tasks ct where ct.work_id=w.id and ct.owner_id=public.current_developer_id())
    )
  );
$$;

revoke all on function public.can_view_test_plan(uuid) from public;
revoke all on function public.can_view_construction(uuid) from public;
grant execute on function public.can_view_test_plan(uuid) to authenticated;
grant execute on function public.can_view_construction(uuid) to authenticated;

create or replace function public.get_test_resource_summary(p_from date default null,p_to date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with plan_rows as(
    select ap.developer_id,tp.source::text source,sum(ap.planned_hours)::numeric planned_hours,0::numeric actual_hours
    from public.test_activity_participants ap
    join public.test_activities a on a.id=ap.activity_id
    join public.test_cycles c on c.id=a.cycle_id
    join public.test_plans tp on tp.id=c.plan_id
    where public.can_view_test_plan(tp.id)
      and (p_from is null or a.planned_end>=p_from) and (p_to is null or a.planned_start<=p_to)
    group by ap.developer_id,tp.source
  ), construction_plan as(
    -- P0 construction-effort invariant (static assertion): formal planned
    -- effort comes from assigned construction subtasks, never work-level
    -- participant pre-allocation. This matches construction detail/list totals.
    select ct.owner_id developer_id,'construction'::text source,sum(ct.planned_hours)::numeric,0::numeric
    from public.test_construction_tasks ct join public.test_construction_works w on w.id=ct.work_id
    where public.can_view_construction(w.id)
      and (p_from is null or ct.planned_end>=p_from) and (p_to is null or ct.planned_start<=p_to)
    group by ct.owner_id
  ), actual_rows as(
    select ws.developer_id,
      case when t.work_source='construction' then 'construction'
        when tp.source='external_request' then 'external_request' else 'internal_project' end source,
      0::numeric planned_hours,
      sum(extract(epoch from(
        least(ws.ended_at,coalesce((p_to+1)::timestamp,ws.ended_at))
        - greatest(ws.started_at,coalesce(p_from::timestamp,ws.started_at))
      ))/3600.0)::numeric actual_hours
    from public.task_work_segments ws join public.tasks t on t.id=ws.task_id
    left join public.test_plans tp on tp.id=t.test_plan_id
    where ws.ended_at is not null and ws.voided_at is null and t.work_source in('test_activity','construction')
      and (p_from is null or ws.ended_at>p_from::timestamp)
      and (p_to is null or ws.started_at<(p_to+1)::timestamp)
      and ((t.work_source='test_activity' and public.can_view_test_plan(t.test_plan_id))
        or (t.work_source='construction' and public.can_view_construction(t.construction_work_id)))
    group by ws.developer_id,case when t.work_source='construction' then 'construction' when tp.source='external_request' then 'external_request' else 'internal_project' end
  ), all_rows as(select * from plan_rows union all select * from construction_plan union all select * from actual_rows),
  grouped as(
    select r.developer_id,d.name,d.position,r.source,round(sum(r.planned_hours),1) planned_hours,round(sum(r.actual_hours),1) actual_hours
    from all_rows r join public.developers d on d.id=r.developer_id
    group by r.developer_id,d.name,d.position,r.source
  )
  select jsonb_build_object(
    'rows',coalesce(jsonb_agg(to_jsonb(grouped) order by name,source),'[]'::jsonb),
    'totals',jsonb_build_object(
      'internal_project',coalesce(sum(actual_hours) filter(where source='internal_project'),0),
      'external_request',coalesce(sum(actual_hours) filter(where source='external_request'),0),
      'construction',coalesce(sum(actual_hours) filter(where source='construction'),0),
      'all_sources',coalesce(sum(actual_hours),0)
    )
  ) from grouped;
$$;
revoke all on function public.get_test_resource_summary(date,date) from public;
grant execute on function public.get_test_resource_summary(date,date) to authenticated;

-- Harden direct reads that were historically global.
drop policy if exists project_no_test_events_read on public.project_no_test_events;
drop policy if exists no_test_events_read on public.project_no_test_events;
create policy no_test_events_read on public.project_no_test_events for select to authenticated
  using (public.can_view_project(project_id));

-- All touched SECURITY DEFINER functions are executable only by authenticated callers.
revoke all on function public.guard_project_update_boundary() from public;
revoke all on function public.guard_task_actor_boundary() from public;
revoke all on function public.track_project_actual_start() from public;

-- ---------- Visibility-safe project aggregates and deep-link cockpit ----------
create or replace function public.project_summary_json(p_project_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select to_jsonb(p)||jsonb_build_object(
    'plan_days',case when p.start_date is not null and p.end_date is not null and p.end_date>=p.start_date then (p.end_date-p.start_date)+1 end,
    'actual_cycle_days',case when p.actual_started_at is null or (p.status='completed' and p.completed_at is null) then null
      else (coalesce(p.completed_at,now())::date-p.actual_started_at::date)+1 end,
    'actual_effort_hours',round(coalesce(eff.hours,0)::numeric,1),
    'actual_effort_person_days',round((coalesce(eff.hours,0)/8.0)::numeric,1),
    'dev_task_total',coalesce(ts.dev_total,0),'dev_task_completed',coalesce(ts.dev_completed,0),
    'dev_completion_rate',case when coalesce(ts.dev_total,0)=0 then null else round(ts.dev_completed*100.0/ts.dev_total,1) end,
    'test_task_total',coalesce(ts.test_total,0),'review_count',coalesce(ts.review_count,0),
    'overdue_count',coalesce(ts.overdue_count,0),'testing_active_count',coalesce(ts.testing_active_count,0),
    'completed_task_count',coalesce(ts.completed_count,0),'delayed_done_count',coalesce(ts.delayed_done_count,0),
    'unassigned_count',coalesce(ts.unassigned_count,0),'unfinished_dev_count',coalesce(ts.unfinished_dev_count,0),
    'active_test_count',coalesce(ts.active_test_count,0),'todo_count',coalesce(ts.todo_count,0),
    'in_progress_count',coalesce(ts.in_progress_count,0),'paused_count',coalesce(ts.paused_count,0),
    'testing_status_count',coalesce(ts.testing_status_count,0),'done_count',coalesce(ts.done_count,0),
    'test_round_total',coalesce(qa.round_total,0),'cumulative_bug_count',coalesce(qa.bug_count,0),
    'reopen_count',coalesce(qa.reopen_count,0),'failed_round_count',coalesce(qa.failed_round_count,0),
    'blocked_round_count',coalesce(qa.blocked_round_count,0),
    'test_pass_rate',case when coalesce(qa.concluded_rounds,0)=0 then null else round(qa.passed_rounds*100.0/qa.concluded_rounds,1) end,
    'summary_covered_count',coalesce(qa.covered_test_tasks,0),'summary_expected_count',coalesce(ts.concluded_test_tasks,0),
    'summary_coverage_rate',case when coalesce(ts.concluded_test_tasks,0)=0 then null else round(coalesce(qa.covered_test_tasks,0)*100.0/ts.concluded_test_tasks,1) end
  )
  from public.projects p
  left join lateral(
    select count(*) filter(where t.task_type='dev')::int dev_total,
      count(*) filter(where t.task_type='dev' and t.status in('done','delayed_done'))::int dev_completed,
      count(*) filter(where t.task_type='test')::int test_total,
      count(*) filter(where t.task_type='test' and t.test_result is not null)::int concluded_test_tasks,
      count(*) filter(where t.status='review')::int review_count,
      count(*) filter(where t.status not in('done','delayed_done') and t.due_date<current_date)::int overdue_count,
      count(*) filter(where (t.task_type='dev' and t.status='testing') or (t.task_type='test' and t.status not in('done','delayed_done') and t.test_result is null))::int testing_active_count,
      count(*) filter(where t.status in('done','delayed_done'))::int completed_count,
      count(*) filter(where t.status='delayed_done')::int delayed_done_count,
      count(*) filter(where t.developer_id is null)::int unassigned_count,
      count(*) filter(where t.task_type='dev' and t.status not in('done','delayed_done'))::int unfinished_dev_count,
      count(*) filter(where t.task_type='test' and t.status not in('done','delayed_done'))::int active_test_count,
      count(*) filter(where t.status='todo')::int todo_count,count(*) filter(where t.status='in_progress')::int in_progress_count,
      count(*) filter(where t.status='paused')::int paused_count,count(*) filter(where t.status='testing')::int testing_status_count,
      count(*) filter(where t.status='done')::int done_count
    from public.tasks t where t.project_id=p.id and public.can_view_task(t.id)
  )ts on true
  left join lateral(
    select sum(extract(epoch from(ws.ended_at-ws.started_at))/3600.0) hours
    from public.task_work_segments ws join public.tasks t on t.id=ws.task_id
    where t.project_id=p.id and public.can_view_task(t.id) and ws.ended_at is not null and ws.voided_at is null
  )eff on true
  left join lateral(
    select count(*)::int round_total,count(*) filter(where tr.result is not null)::int concluded_rounds,
      count(*) filter(where tr.result='pass')::int passed_rounds,count(*) filter(where tr.result='fail')::int failed_round_count,
      count(*) filter(where tr.blocked)::int blocked_round_count,coalesce(sum(tr.bug_count),0)::int bug_count,
      coalesce(sum(tr.reopen_count),0)::int reopen_count,
      count(distinct tr.test_task_id) filter(where tr.result is not null)::int covered_test_tasks
    from public.test_rounds tr join public.tasks tt on tt.id=tr.test_task_id
    where tt.project_id=p.id and public.can_view_task(tt.id)
  )qa on true
  where p.id=p_project_id and public.can_view_project(p.id);
$$;

create or replace function public.get_project_test_summary(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.can_view_project(p_project_id) then raise exception 'No permission to view this project'; end if;
  select jsonb_build_object(
    'requires_testing',p.requires_testing,'test_state',p.test_state,'no_test_status',p.no_test_status,
    'no_test_reason',p.no_test_reason,'no_test_related_url',p.no_test_related_url,'no_test_decision_note',p.no_test_decision_note,
    'plan_id',tp.id,'plan_title',tp.title,'cycle_count',coalesce(ca.cycle_count,0),
    'passed_cycle_count',coalesce(ca.passed_count,0),'failed_cycle_count',coalesce(ca.failed_count,0),
    'active_cycle_count',coalesce(ca.active_count,0),'executed_count',coalesce(ba.executed_count,0),
    'bug_count',coalesce(ba.bug_count,0),'reopen_count',coalesce(ba.reopen_count,0),'blocked_count',coalesce(ba.blocked_count,0),
    'test_actual_hours',coalesce(eff.actual_hours,0),'cycles',coalesce(ca.cycles,'[]'::jsonb)
  ) into v_result
  from public.projects p
  left join lateral(
    select * from public.test_plans x where x.project_id=p.id and public.can_view_test_plan(x.id)
    order by x.created_at desc limit 1
  )tp on true
  left join lateral(
    select count(*)::int cycle_count,count(*) filter(where status='passed')::int passed_count,
      count(*) filter(where status='failed')::int failed_count,
      count(*) filter(where status not in('passed','failed','cancelled','returned'))::int active_count,
      jsonb_agg(to_jsonb(c) order by cycle_no desc) cycles
    from public.test_cycles c where c.plan_id=tp.id
  )ca on true
  left join lateral(
    select coalesce(sum(b.executed_count),0)::int executed_count,coalesce(sum(b.bug_count),0)::int bug_count,
      coalesce(sum(b.reopen_count),0)::int reopen_count,coalesce(sum(b.blocked_count),0)::int blocked_count
    from public.test_execution_batches b join public.test_cycles c on c.id=b.cycle_id where c.plan_id=tp.id
  )ba on true
  left join lateral(
    select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours
    from public.tasks t join public.task_work_segments ws on ws.task_id=t.id
    where t.test_plan_id=tp.id and t.work_source='test_activity' and ws.ended_at is not null and ws.voided_at is null
  )eff on true where p.id=p_project_id;
  return v_result;
end;
$$;

create or replace function public.get_project_summaries()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(
    public.project_summary_json(p.id)||case when metrics.plan_count>0 then jsonb_build_object(
      'test_round_total',metrics.cycle_count,'cumulative_bug_count',metrics.bug_count,'reopen_count',metrics.reopen_count,
      'failed_round_count',metrics.failed_count,'blocked_round_count',metrics.blocked_cycle_count,
      'test_pass_rate',case when metrics.concluded_count>0 then round(metrics.passed_count*100.0/metrics.concluded_count,1) end,
      'summary_covered_count',metrics.concluded_count,'summary_expected_count',metrics.cycle_count,
      'summary_coverage_rate',case when metrics.cycle_count>0 then round(metrics.concluded_count*100.0/metrics.cycle_count,1) end
    ) else '{}'::jsonb end order by p.created_at desc
  ),'[]'::jsonb)
  from public.projects p
  left join lateral(
    select count(distinct tp.id)::int plan_count,count(distinct c.id)::int cycle_count,
      count(distinct c.id) filter(where c.status in('passed','failed'))::int concluded_count,
      count(distinct c.id) filter(where c.status='passed')::int passed_count,
      count(distinct c.id) filter(where c.status='failed')::int failed_count,
      count(distinct c.id) filter(where exists(select 1 from public.test_execution_batches bx where bx.cycle_id=c.id and bx.blocked_count>0))::int blocked_cycle_count,
      coalesce(sum(b.bug_count),0)::int bug_count,coalesce(sum(b.reopen_count),0)::int reopen_count
    from public.test_plans tp left join public.test_cycles c on c.plan_id=tp.id left join public.test_execution_batches b on b.cycle_id=c.id
    where tp.project_id=p.id and public.can_view_test_plan(tp.id)
  )metrics on true
  where public.can_view_project(p.id);
$$;

create or replace function public.get_project_cockpit(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_old jsonb; v_people jsonb; v_quality jsonb; v_timeline jsonb;
begin
  if not public.can_view_project(p_project_id) then raise exception 'No permission to view this project'; end if;
  v_old:=public.get_project_cockpit_v215(p_project_id);
  select coalesce(jsonb_agg(item),'[]'::jsonb) into v_quality
  from jsonb_array_elements(coalesce(v_old->'quality_rounds','[]'::jsonb)) item
  where item->>'test_task_id' is not null and public.can_view_task((item->>'test_task_id')::uuid)
    and exists(select 1 from public.tasks t where t.id=(item->>'test_task_id')::uuid and t.work_source='legacy_single_test');
  select coalesce(jsonb_agg(to_jsonb(x) order by x.actual_effort_hours desc,x.person_name),'[]'::jsonb) into v_people
  from(
    select t.developer_id,coalesce(d.name,'Unassigned') person_name,d.position,count(*)::int task_count,
      count(*) filter(where t.task_type='dev')::int dev_task_count,count(*) filter(where t.task_type='test')::int test_task_count,
      count(*) filter(where t.status in('done','delayed_done'))::int completed_task_count,
      count(*) filter(where t.status='review')::int review_task_count,
      count(*) filter(where t.status not in('done','delayed_done') and t.due_date<current_date)::int overdue_task_count,
      round(coalesce(sum(seg.hours),0)::numeric,1) actual_effort_hours,
      round((coalesce(sum(seg.hours),0)/8.0)::numeric,1) actual_effort_person_days
    from public.tasks t left join public.developers d on d.id=t.developer_id
    left join lateral(select sum(extract(epoch from(ws.ended_at-ws.started_at))/3600.0) hours
      from public.task_work_segments ws where ws.task_id=t.id and ws.ended_at is not null and ws.voided_at is null)seg on true
    where t.project_id=p_project_id and public.can_view_task(t.id)
    group by t.developer_id,d.name,d.position
  )x;
  select coalesce(jsonb_agg(item order by item->>'occurred_at' desc),'[]'::jsonb) into v_timeline
  from jsonb_array_elements(coalesce(v_old->'timeline','[]'::jsonb)) item
  where coalesce(item->>'task_id','')='' or public.can_view_task((item->>'task_id')::uuid);
  return (v_old-'quality_rounds'-'people'-'timeline'-'project_testing')
    ||jsonb_build_object('quality_rounds',v_quality,'people',v_people,'timeline',v_timeline,
      'project_testing',public.get_project_test_summary(p_project_id));
end;
$$;

revoke all on function public.project_summary_json(uuid) from public,authenticated;
revoke all on function public.get_project_test_summary(uuid) from public;
revoke all on function public.get_project_summaries() from public;
revoke all on function public.get_project_cockpit(uuid) from public;
grant execute on function public.get_project_test_summary(uuid) to authenticated;
grant execute on function public.get_project_summaries() to authenticated;
grant execute on function public.get_project_cockpit(uuid) to authenticated;

-- ---------- Whole-plan test-center effort and valid-entry details ----------
create or replace function public.get_testing_center(
  p_source text default null,p_status text default null,p_page int default 1,p_page_size int default 20
) returns jsonb language sql stable security definer set search_path=public as $$
  with visible as(
    select tp.*,p.name project_name,tm.name test_team_name,d.name recommended_owner_name,
      lc.id latest_cycle_id,lc.cycle_no,lc.stage_version,lc.status cycle_status,lc.main_tester_id,md.name main_tester_name,
      lc.planned_start,lc.planned_end,coalesce(agg.planned_count,0) planned_case_count,
      coalesce(agg.executed_count,0) executed_case_count,coalesce(agg.passed_count,0) passed_count,
      coalesce(agg.failed_count,0) failed_count,coalesce(agg.blocked_count,0) blocked_count,
      coalesce(agg.bug_count,0) bug_count,coalesce(agg.reopen_count,0) reopen_count,
      coalesce(plan_eff.planned_hours,0) planned_hours,coalesce(eff.actual_hours,0) actual_hours
    from public.test_plans tp left join public.projects p on p.id=tp.project_id join public.teams tm on tm.id=tp.test_team_id
    left join public.developers d on d.id=tp.recommended_owner_id
    left join lateral(select * from public.test_cycles where plan_id=tp.id order by cycle_no desc limit 1)lc on true
    left join public.developers md on md.id=lc.main_tester_id
    left join lateral(
      select coalesce(sum(b.planned_count),0)::int planned_count,coalesce(sum(b.executed_count),0)::int executed_count,
        coalesce(sum(b.passed_count),0)::int passed_count,coalesce(sum(b.failed_count),0)::int failed_count,
        coalesce(sum(b.blocked_count),0)::int blocked_count,coalesce(sum(b.bug_count),0)::int bug_count,
        coalesce(sum(b.reopen_count),0)::int reopen_count
      from public.test_execution_batches b join public.test_cycles c on c.id=b.cycle_id where c.plan_id=tp.id
    )agg on true
    left join lateral(
      select round(coalesce(sum(ap.planned_hours),0)::numeric,1) planned_hours
      from public.test_activity_participants ap join public.test_activities a on a.id=ap.activity_id
      join public.test_cycles c on c.id=a.cycle_id where c.plan_id=tp.id
    )plan_eff on true
    left join lateral(
      select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours
      from public.tasks t join public.task_work_segments ws on ws.task_id=t.id
      where t.test_plan_id=tp.id and ws.ended_at is not null and ws.voided_at is null
    )eff on true
    where public.can_view_test_plan(tp.id) and (coalesce(p_source,'')='' or tp.source=p_source)
      and (coalesce(p_status,'')='' or lc.status=p_status)
  ),counted as(select visible.*,count(*) over() total_count from visible),
  paged as(select * from counted order by updated_at desc offset(greatest(p_page,1)-1)*least(greatest(p_page_size,1),100)
    limit least(greatest(p_page_size,1),100))
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)-'total_count' order by x.updated_at desc) from paged x),'[]'::jsonb),
    'total',coalesce((select max(total_count) from counted),0),'page',greatest(p_page,1),'page_size',least(greatest(p_page_size,1),100));
$$;

create or replace function public.get_test_plan_detail(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_plan jsonb; v_cycles jsonb; v_planned numeric; v_actual numeric;
begin
  if not public.can_view_test_plan(p_plan_id) then raise exception 'No permission to view this test plan'; end if;
  select to_jsonb(tp)||jsonb_build_object('project_name',p.name,'test_team_name',tm.name,'created_by_name',creator.name)
  into v_plan from public.test_plans tp left join public.projects p on p.id=tp.project_id
  join public.teams tm on tm.id=tp.test_team_id left join public.developers creator on creator.id=tp.created_by where tp.id=p_plan_id;
  if v_plan is null then raise exception 'Test plan does not exist'; end if;
  select round(coalesce(sum(ap.planned_hours),0)::numeric,1) into v_planned
  from public.test_activity_participants ap join public.test_activities a on a.id=ap.activity_id
  join public.test_cycles c on c.id=a.cycle_id where c.plan_id=p_plan_id;
  select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) into v_actual
  from public.tasks t join public.task_work_segments ws on ws.task_id=t.id
  where t.test_plan_id=p_plan_id and ws.ended_at is not null and ws.voided_at is null;
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object(
    'main_tester_name',d.name,
    'planned_hours',coalesce((select round(sum(ap.planned_hours),1) from public.test_activity_participants ap join public.test_activities a on a.id=ap.activity_id where a.cycle_id=c.id),0),
    'actual_hours',coalesce((select round(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),1) from public.tasks t join public.task_work_segments ws on ws.task_id=t.id where t.test_cycle_id=c.id and ws.ended_at is not null and ws.voided_at is null),0),
    'scope_tasks',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.test_cycle_scope_tasks s where s.cycle_id=c.id),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(cp)||jsonb_build_object('name',pd.name) order by cp.participant_role,pd.name) from public.test_cycle_participants cp join public.developers pd on pd.id=cp.developer_id where cp.cycle_id=c.id),'[]'::jsonb),
    'activities',coalesce((select jsonb_agg(
      to_jsonb(a)||jsonb_build_object(
        'owner_name',ad.name,
        'actual_hours',coalesce(ah.hours,0),
        'participants',coalesce((
          select jsonb_agg(jsonb_build_object(
            'developer_id',ap.developer_id,
            'name',pd.name,
            'planned_hours',ap.planned_hours
          ) order by pd.name)
          from public.test_activity_participants ap
          join public.developers pd on pd.id=ap.developer_id
          where ap.activity_id=a.id
        ),'[]'::jsonb)
      ) order by a.created_at)
      from public.test_activities a
      join public.developers ad on ad.id=a.owner_id
      left join lateral(
        select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) hours
        from public.task_work_segments ws
        where ws.task_id=a.task_id and ws.ended_at is not null and ws.voided_at is null
      )ah on true where a.cycle_id=c.id),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('executor_name',bd.name) order by b.executed_on desc,b.created_at desc) from public.test_execution_batches b join public.developers bd on bd.id=b.executor_id where b.cycle_id=c.id),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.report_type) from public.test_reports r where r.cycle_id=c.id),'[]'::jsonb),
    'repair_tasks',coalesce((select jsonb_agg(to_jsonb(rt)||jsonb_build_object('repair_task_title',t.title,'repair_task_status',t.status)) from public.test_cycle_repair_tasks rt join public.tasks t on t.id=rt.repair_task_id where rt.cycle_id=c.id),'[]'::jsonb)
  ) order by c.cycle_no desc),'[]'::jsonb) into v_cycles
  from public.test_cycles c left join public.developers d on d.id=c.main_tester_id where c.plan_id=p_plan_id;
  return v_plan||jsonb_build_object('planned_hours',v_planned,'actual_hours',v_actual,'cycles',v_cycles,
    'events',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ed.name) order by e.created_at desc) from public.test_plan_events e left join public.developers ed on ed.id=e.actor_id where e.plan_id=p_plan_id),'[]'::jsonb));
end;
$$;

-- Keep cycle, activity, and backing task states in one executable state.
-- This closes the accepted -> split(todo) -> start dead end for manual hours.
create or replace function public.transition_test_cycle(
  p_cycle_id uuid,
  p_action text,
  p_reason text default null
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_cycle public.test_cycles%rowtype;
  v_plan public.test_plans%rowtype;
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
  v_next text;
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id for update;
  if not found then raise exception 'Test cycle does not exist'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if not (v_cycle.main_tester_id=public.current_developer_id() or public.is_test_lead(v_plan.test_team_id) or public.is_admin()) then
    raise exception 'Only the main tester or test lead may operate this cycle';
  end if;

  if p_action='start' and v_cycle.status='accepted' then v_next:='in_progress';
  elsif p_action='pause' and v_cycle.status='in_progress' then
    if v_reason is null then raise exception 'Pause reason is required'; end if;
    v_next:='paused';
  elsif p_action='resume' and v_cycle.status='paused' then v_next:='in_progress';
  elsif p_action='cancel' and v_cycle.status not in('passed','failed','cancelled') then
    if v_reason is null then raise exception 'Cancellation reason is required'; end if;
    v_next:='cancelled';
  else
    raise exception 'The current cycle state does not allow this action';
  end if;

  update public.test_cycles set status=v_next,
    actual_started_at=case when p_action='start' then coalesce(actual_started_at,now()) else actual_started_at end,
    pause_reason=case when p_action='pause' then v_reason else pause_reason end,
    cancel_reason=case when p_action='cancel' then v_reason else cancel_reason end,
    actual_completed_at=case when p_action='cancel' then now() else actual_completed_at end
  where id=p_cycle_id;
  update public.test_plans set status=v_next where id=v_cycle.plan_id;

  -- P0 cycle-sync invariant (static assertion): these task updates are owned
  -- by the test-center RPC, never by an ordinary task UPDATE.
  perform set_config('app.test_center_rpc','on',true);
  if p_action='start' then
    update public.test_activities set status='in_progress'
      where cycle_id=p_cycle_id and status='todo';
    update public.tasks set status='in_progress'
      where test_cycle_id=p_cycle_id and work_source='test_activity' and status='todo';
  elsif p_action='pause' then
    update public.test_activities set status='paused'
      where cycle_id=p_cycle_id and status='in_progress';
    update public.tasks set status='paused'
      where test_cycle_id=p_cycle_id and work_source='test_activity' and status='in_progress';
  elsif p_action='resume' then
    update public.test_activities set status='in_progress'
      where cycle_id=p_cycle_id and status='paused';
    update public.tasks set status='in_progress'
      where test_cycle_id=p_cycle_id and work_source='test_activity' and status='paused';
  elsif p_action='cancel' then
    update public.test_activities set status='cancelled'
      where cycle_id=p_cycle_id and status not in('done','cancelled');
    -- The legacy task-state trigger permits todo -> in_progress -> paused but
    -- intentionally rejects todo -> paused. Use the legal two-step mapping;
    -- test work never opens automatic work segments.
    update public.tasks set status='in_progress'
      where test_cycle_id=p_cycle_id and work_source='test_activity' and status='todo';
    update public.tasks set status='paused'
      where test_cycle_id=p_cycle_id and work_source='test_activity'
        and status in('in_progress','paused');
  end if;

  if v_plan.project_id is not null then
    update public.projects set test_state=case
      when v_next='in_progress' then 'testing'
      when v_next='accepted' then 'scheduled'
      else test_state end
    where id=v_plan.project_id;
  end if;
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,reason)
  values(v_cycle.plan_id,p_cycle_id,'cycle_'||p_action,public.current_developer_id(),v_reason);
end;
$$;
revoke all on function public.transition_test_cycle(uuid,text,text) from public;
grant execute on function public.transition_test_cycle(uuid,text,text) to authenticated;

create or replace function public.record_test_work_hours(p_task_id uuid,p_work_date date,p_hours numeric,p_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_task public.tasks%rowtype; v_id uuid; v_start timestamptz; v_allowed boolean:=false;
begin
  select * into v_task from public.tasks where id=p_task_id;
  if not found or v_task.work_source not in('test_activity','construction') then raise exception 'Only test-center tasks accept manual hours'; end if;
  -- P0 work-entry state invariant (static assertion): manual test hours are
  -- accepted only while the assigned work object is actively executable.
  -- todo/testing/review/terminal states must all be rejected.
  if v_task.status not in('in_progress','paused') then raise exception 'Work hours can only be recorded while the work object is in progress or paused'; end if;
  if v_task.work_source='test_activity' and not exists(
    select 1 from public.test_activities a
    where a.id=v_task.test_activity_id and a.status in('in_progress','paused')
  ) then raise exception 'The test activity is not open for work-hour entry'; end if;
  if v_task.work_source='construction' and not exists(
    select 1 from public.test_construction_works w
    where w.id=v_task.construction_work_id and w.status in('active','paused')
  ) then raise exception 'The construction work is not open for work-hour entry'; end if;
  if p_work_date is null or p_hours<=0 or p_hours>24 then raise exception 'Work date and 0-24 hours are required'; end if;
  -- P0 work-entry invariant (static assertion): construction authorization is
  -- task-assignee only. Construction-wide participants must never authorize a
  -- person to record hours against another assignee's construction subtask.
  -- Test activities remain collaborative units, so their participants may log.
  v_allowed:=v_task.developer_id=public.current_developer_id()
    or (v_task.work_source='test_activity' and exists(
      select 1 from public.test_activity_participants ap
      where ap.activity_id=v_task.test_activity_id
        and ap.developer_id=public.current_developer_id()
    ));
  if not v_allowed then raise exception 'Only this construction task assignee or an assigned test-activity participant may record work hours'; end if;
  v_start:=p_work_date::timestamp+interval '9 hours';
  insert into public.task_work_segments(task_id,developer_id,started_at,ended_at,entry_source,note,created_by)
  values(p_task_id,public.current_developer_id(),v_start,v_start+(p_hours||' hours')::interval,'manual',nullif(trim(coalesce(p_note,'')),''),public.current_developer_id())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_construction_works(p_status text default null,p_page int default 1,p_page_size int default 20)
returns jsonb language sql stable security definer set search_path=public as $$
  with visible as(
    select w.*,d.name owner_name,coalesce(t.task_count,0) task_count,coalesce(t.done_count,0) done_count,
      coalesce(t.planned_hours,0) planned_hours,coalesce(e.actual_hours,0) actual_hours
    from public.test_construction_works w join public.developers d on d.id=w.owner_id
    left join lateral(select count(*)::int task_count,count(*) filter(where status='done')::int done_count,round(coalesce(sum(planned_hours),0)::numeric,1) planned_hours from public.test_construction_tasks where work_id=w.id)t on true
    left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours from public.tasks tk join public.task_work_segments ws on ws.task_id=tk.id where tk.construction_work_id=w.id and ws.ended_at is not null and ws.voided_at is null)e on true
    where public.can_view_construction(w.id) and (coalesce(p_status,'')='' or w.status=p_status)
  ),counted as(select visible.*,count(*) over() total_count from visible),paged as(select * from counted order by updated_at desc offset(greatest(p_page,1)-1)*least(greatest(p_page_size,1),100) limit least(greatest(p_page_size,1),100))
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)-'total_count' order by x.updated_at desc) from paged x),'[]'::jsonb),'total',coalesce((select max(total_count) from counted),0),'page',greatest(p_page,1),'page_size',least(greatest(p_page_size,1),100));
$$;

create or replace function public.get_construction_detail(p_work_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.can_view_construction(p_work_id) then raise exception 'No permission to view this construction work'; end if;
  select to_jsonb(w)||jsonb_build_object('owner_name',d.name,'task_count',coalesce(t.task_count,0),'done_count',coalesce(t.done_count,0),
    'planned_hours',coalesce(t.planned_hours,0),'actual_hours',coalesce(e.actual_hours,0),
    'participants',coalesce((select jsonb_agg(to_jsonb(cp)||jsonb_build_object('name',pd.name) order by cp.participant_role,pd.name) from public.test_construction_participants cp join public.developers pd on pd.id=cp.developer_id where cp.work_id=w.id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(ct)||jsonb_build_object('owner_name',td.name,'actual_hours',coalesce(te.hours,0)) order by ct.created_at) from public.test_construction_tasks ct join public.developers td on td.id=ct.owner_id left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) hours from public.task_work_segments ws where ws.task_id=ct.task_id and ws.ended_at is not null and ws.voided_at is null)te on true where ct.work_id=w.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(ce)||jsonb_build_object('actor_name',ed.name) order by ce.created_at desc) from public.test_construction_events ce left join public.developers ed on ed.id=ce.actor_id where ce.work_id=w.id),'[]'::jsonb)
  ) into v_result from public.test_construction_works w join public.developers d on d.id=w.owner_id
  left join lateral(select count(*)::int task_count,count(*) filter(where status='done')::int done_count,round(coalesce(sum(planned_hours),0)::numeric,1) planned_hours from public.test_construction_tasks where work_id=w.id)t on true
  left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours from public.tasks tk join public.task_work_segments ws on ws.task_id=tk.id where tk.construction_work_id=w.id and ws.ended_at is not null and ws.voided_at is null)e on true
  where w.id=p_work_id;
  if v_result is null then raise exception 'Construction work does not exist'; end if;
  return v_result;
end;
$$;

revoke all on function public.get_testing_center(text,text,int,int) from public;
revoke all on function public.get_test_plan_detail(uuid) from public;
revoke all on function public.record_test_work_hours(uuid,date,numeric,text) from public;
revoke all on function public.get_construction_works(text,int,int) from public;
revoke all on function public.get_construction_detail(uuid) from public;
grant execute on function public.get_testing_center(text,text,int,int) to authenticated;
grant execute on function public.get_test_plan_detail(uuid) to authenticated;
grant execute on function public.record_test_work_hours(uuid,date,numeric,text) to authenticated;
grant execute on function public.get_construction_works(text,int,int) to authenticated;
grant execute on function public.get_construction_detail(uuid) to authenticated;

-- ---------- Internal test readiness: the current data model supports whole-project scope only ----------
create or replace function public.get_eligible_internal_test_projects(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=public.current_developer_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Account is not linked to a developer profile'; end if;
  with assessed as(
    select p.id,p.name,p.team_id,tm.name team_name,p.test_state,p.status,p.no_test_status,
      exists(select 1 from public.test_plans tp join public.test_cycles c on c.plan_id=tp.id
        where tp.project_id=p.id and c.status not in('passed','failed','cancelled','returned')) has_active_cycle,
      exists(select 1 from public.tasks t where t.project_id=p.id and t.task_type='dev') has_dev_tasks,
      exists(select 1 from public.tasks t where t.project_id=p.id and t.task_type='dev'
        and (t.status not in('done','delayed_done') or t.completed_at is null or t.approved_by_user is null)) has_unready_task,
      (select count(*)::int from public.tasks t where t.project_id=p.id and t.task_type='dev'
        and t.status in('done','delayed_done') and t.completed_at is not null and t.approved_by_user is not null
        and not exists(select 1 from public.test_cycle_scope_tasks s join public.test_cycles c on c.id=s.cycle_id
          where s.task_id=t.id and c.status='passed')) eligible_task_count
    from public.projects p join public.teams tm on tm.id=p.team_id where p.owner_id=v_actor
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'team_id',team_id,'team_name',team_name,
      'test_state',test_state,'eligible_task_count',eligible_task_count) order by name) filter(where status='active'
      and no_test_status<>'approved' and not has_active_cycle and has_dev_tasks and not has_unready_task
      and eligible_task_count>0 and (nullif(trim(coalesce(p_search,'')),'') is null or name ilike '%'||trim(p_search)||'%')),'[]'::jsonb),
    'owned_project_count',count(*)::int,'inactive_count',count(*) filter(where status<>'active')::int,
    'no_test_approved_count',count(*) filter(where no_test_status='approved')::int,
    'active_cycle_count',count(*) filter(where has_active_cycle)::int,
    'no_eligible_task_count',count(*) filter(where not has_dev_tasks or has_unready_task or eligible_task_count=0)::int
  ) into v_result from assessed;
  return v_result;
end;
$$;

create or replace function public.create_test_plan(
  p_source text,p_title text,p_test_team_id uuid,p_project_id uuid default null,
  p_external_project_name text default null,p_external_owner_name text default null,
  p_version_name text default null,p_test_scope text default null,p_test_goal text default null,
  p_deliverables text default null,p_expected_start date default null,p_expected_end date default null,
  p_environment_note text default null,p_priority text default 'medium',p_related_url text default null,
  p_zentao_url text default null,p_recommended_owner_id uuid default null,p_report_types text[] default array[]::text[]
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_project public.projects%rowtype; v_actor uuid:=public.current_developer_id(); v_eligible int;
begin
  if p_source='internal_project' then
    select * into v_project from public.projects where id=p_project_id;
    if not found then raise exception 'Internal project does not exist'; end if;
    if v_project.owner_id<>v_actor then raise exception 'Only the project owner may start internal testing'; end if;
    if v_project.status<>'active' then raise exception 'Only active projects may start testing'; end if;
    if v_project.no_test_status='approved' then raise exception 'Project is approved as no-test'; end if;
    if exists(select 1 from public.test_plans tp join public.test_cycles c on c.plan_id=tp.id
      where tp.project_id=p_project_id and c.status not in('passed','failed','cancelled','returned')) then
      raise exception 'Project already has an active test cycle';
    end if;
    if not exists(select 1 from public.tasks t where t.project_id=p_project_id and t.task_type='dev')
      or exists(select 1 from public.tasks t where t.project_id=p_project_id and t.task_type='dev'
        and (t.status not in('done','delayed_done') or t.completed_at is null or t.approved_by_user is null)) then
      raise exception 'All development/repair tasks in the whole-project scope must be approved and completed before testing';
    end if;
    select count(*)::int into v_eligible from public.tasks t where t.project_id=p_project_id and t.task_type='dev'
      and not exists(select 1 from public.test_cycle_scope_tasks s join public.test_cycles c on c.id=s.cycle_id
        where s.task_id=t.id and c.status='passed');
    if v_eligible=0 then raise exception 'No approved task remains outside a passed cycle'; end if;
  end if;
  return public.create_test_plan_v218(p_source,p_title,p_test_team_id,p_project_id,p_external_project_name,
    p_external_owner_name,p_version_name,p_test_scope,p_test_goal,p_deliverables,p_expected_start,p_expected_end,
    p_environment_note,p_priority,p_related_url,p_zentao_url,p_recommended_owner_id,p_report_types);
end;
$$;

create or replace function public.admin_create_internal_test_plan(
  p_title text,p_test_team_id uuid,p_project_id uuid,p_version_name text,p_test_scope text,p_test_goal text,
  p_deliverables text,p_expected_start date,p_expected_end date,p_environment_note text,p_priority text,
  p_related_url text,p_zentao_url text,p_recommended_owner_id uuid,p_report_types text[],p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_project public.projects%rowtype; v_plan uuid; v_reason text:=nullif(trim(p_reason),'');
begin
  if not public.is_admin() then raise exception 'Only admin may use the exception proxy'; end if;
  if public.current_developer_id() is null or v_reason is null then raise exception 'Linked admin profile and exception reason are required'; end if;
  select * into v_project from public.projects where id=p_project_id;
  if not found or v_project.status<>'active' or v_project.no_test_status='approved' then raise exception 'Project is not eligible for testing'; end if;
  if exists(select 1 from public.test_plans tp join public.test_cycles c on c.plan_id=tp.id where tp.project_id=p_project_id and c.status not in('passed','failed','cancelled','returned')) then
    raise exception 'Project already has an active test cycle';
  end if;
  if not exists(select 1 from public.tasks t where t.project_id=p_project_id and t.task_type='dev')
    or exists(select 1 from public.tasks t where t.project_id=p_project_id and t.task_type='dev'
      and (t.status not in('done','delayed_done') or t.completed_at is null or t.approved_by_user is null)) then
    raise exception 'All whole-project development/repair tasks must be approved and completed';
  end if;
  v_plan:=public.create_test_plan_v218('internal_project',p_title,p_test_team_id,p_project_id,null,null,p_version_name,
    p_test_scope,p_test_goal,p_deliverables,p_expected_start,p_expected_end,p_environment_note,p_priority,p_related_url,
    p_zentao_url,p_recommended_owner_id,p_report_types);
  insert into public.test_plan_events(plan_id,event_type,actor_id,reason,payload)
  values(v_plan,'admin_proxy_created',public.current_developer_id(),v_reason,jsonb_build_object('project_id',p_project_id));
  return v_plan;
end;
$$;

revoke all on function public.get_eligible_internal_test_projects(text) from public;
revoke all on function public.create_test_plan(text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]) from public;
revoke all on function public.admin_create_internal_test_plan(text,uuid,uuid,text,text,text,text,date,date,text,text,text,text,uuid,text[],text) from public;
grant execute on function public.get_eligible_internal_test_projects(text) to authenticated;
grant execute on function public.create_test_plan(text,text,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text,text,uuid,text[]) to authenticated;
grant execute on function public.admin_create_internal_test_plan(text,uuid,uuid,text,text,text,text,date,date,text,text,text,text,uuid,text[],text) to authenticated;

-- Activity participant allocations are the only formal planned-effort source.
alter function public.add_test_activity(uuid,text,text,uuid,date,date,numeric,text,text,jsonb)
  rename to add_test_activity_v218;
revoke all on function public.add_test_activity_v218(uuid,text,text,uuid,date,date,numeric,text,text,jsonb) from public,authenticated;
create function public.add_test_activity(
  p_cycle_id uuid,p_activity_type text,p_title text,p_owner_id uuid,p_planned_start date,p_planned_end date,
  p_planned_hours numeric default 0,p_preconditions text default null,p_expected_deliverable text default null,
  p_participants jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_activity uuid; v_other numeric; v_owner numeric;
begin
  v_activity:=public.add_test_activity_v218(p_cycle_id,p_activity_type,p_title,p_owner_id,p_planned_start,p_planned_end,
    p_planned_hours,p_preconditions,p_expected_deliverable,p_participants);
  select coalesce(sum(greatest(0,coalesce(x.planned_hours,0))),0) into v_other
  from jsonb_to_recordset(coalesce(p_participants,'[]'::jsonb))x(developer_id uuid,planned_hours numeric)
  where x.developer_id is not null and x.developer_id<>p_owner_id;
  v_owner:=greatest(0,coalesce(p_planned_hours,0)-v_other);
  insert into public.test_activity_participants(activity_id,developer_id,planned_hours)
  values(v_activity,p_owner_id,v_owner)
  on conflict(activity_id,developer_id) do update set planned_hours=excluded.planned_hours;
  update public.test_activities a set planned_hours=(
    select coalesce(sum(ap.planned_hours),0) from public.test_activity_participants ap where ap.activity_id=a.id
  ) where a.id=v_activity;
  return v_activity;
end;
$$;
revoke all on function public.add_test_activity(uuid,text,text,uuid,date,date,numeric,text,text,jsonb) from public;
grant execute on function public.add_test_activity(uuid,text,text,uuid,date,date,numeric,text,text,jsonb) to authenticated;
