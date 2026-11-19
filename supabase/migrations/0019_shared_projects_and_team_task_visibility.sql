-- Projects are shared across teams. Keep the former team value for historical records.
alter table public.projects
  drop constraint projects_team_id_fkey,
  alter column team_id drop not null;
alter table public.projects rename column team_id to legacy_team_id;
drop index public.idx_projects_team;

comment on column public.projects.legacy_team_id is
  'Historical project team before 0019. Excluded from current authorization and team reporting.';

alter policy proj_insert on public.projects
  with check (public.is_admin() and legacy_team_id is null);

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
  if new.legacy_team_id is distinct from old.legacy_team_id then
    raise exception 'Historical project team cannot be changed';
  end if;
  if v_internal then return new; end if;
  if old.owner_id <> public.current_developer_id() then
    raise exception 'Only the current project owner may update project business fields';
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.status is distinct from old.status
     or new.actual_started_at is distinct from old.actual_started_at
     or new.completed_at is distinct from old.completed_at then
    raise exception 'Project structure and lifecycle fields require a dedicated audited action';
  end if;
  return new;
end;
$$;

drop function public.change_project_governance(uuid, uuid, uuid, text);

create function public.change_project_owner(p_project_id uuid, p_owner_id uuid, p_reason text)
returns public.projects language plpgsql security definer set search_path = public as $$
declare
  v_old public.projects%rowtype;
  v_new public.projects%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  if not public.is_admin() then raise exception 'Only admins may change the project owner'; end if;
  if public.current_developer_id() is null then raise exception 'Account is not linked to a developer profile'; end if;
  if v_reason is null then raise exception 'Owner change reason is required'; end if;
  if not exists(select 1 from public.developers where id=p_owner_id and is_active) then raise exception 'Owner must be active'; end if;
  select * into v_old from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project does not exist'; end if;

  perform set_config('app.project_structure_rpc','on',true);
  update public.projects set owner_id=p_owner_id where id=p_project_id returning * into v_new;
  insert into public.project_admin_action_audits(project_id,action,before_data,after_data,actor_id,reason)
  values(p_project_id,'structure_update',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

revoke all on function public.change_project_owner(uuid, uuid, text) from public, anon;
grant execute on function public.change_project_owner(uuid, uuid, text) to authenticated;

create function public.developer_team_ids(p_developer_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from public.developer_teams where developer_id=p_developer_id
  union
  select id from public.teams where leader_id=p_developer_id;
$$;

create function public.leads_task_member(p_developer_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.developer_team_ids(p_developer_id) as member(team_id)
    where public.is_team_lead_for(member.team_id)
  );
$$;

revoke all on function public.developer_team_ids(uuid) from public, anon, authenticated;
revoke all on function public.leads_task_member(uuid) from public, anon, authenticated;

-- Receive row values directly so INSERT ... RETURNING also sees the newly created row.
create function public.can_view_task_row(
  p_project_id uuid, p_assignee_id uuid, p_creator_id uuid, p_work_source text,
  p_test_plan_id uuid, p_construction_work_id uuid
)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or public.current_developer_id() in (p_assignee_id, p_creator_id)
    or exists (
      select 1 from public.projects p
      where p.id=p_project_id and p.owner_id=public.current_developer_id()
    )
    or public.leads_task_member(p_assignee_id)
    or public.leads_task_member(p_creator_id)
    or (p_work_source='test_activity' and public.can_view_test_plan(p_test_plan_id))
    or (p_work_source='construction' and public.can_view_construction(p_construction_work_id));
$$;

revoke all on function public.can_view_task_row(uuid, uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.can_view_task_row(uuid, uuid, uuid, text, uuid, uuid) to authenticated;

create or replace function public.can_view_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id=p_task_id and public.can_view_task_row(
      t.project_id, t.developer_id, t.created_by, t.work_source, t.test_plan_id, t.construction_work_id
    )
  );
$$;

alter policy task_select on public.tasks using (
  public.can_view_task_row(project_id, developer_id, created_by, work_source, test_plan_id, construction_work_id)
);

-- Creator-based visibility depends on the actual authenticated author.
alter table public.tasks alter column created_by set default public.current_developer_id();

alter policy task_insert on public.tasks with check (
  created_by is not distinct from public.current_developer_id()
  and task_type = 'dev'
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
    project_id is null
    or (status = 'todo' and submitted_at is null and completed_at is null
      and approved_by_role is null and approved_by_user is null and reject_note is null)
  )
  and (
    public.is_admin()
    or developer_id = public.current_developer_id()
    or (
      public.is_manager()
      and exists (
        select 1 from public.developer_teams member
        join public.teams led on led.id = member.team_id
        where member.developer_id = tasks.developer_id
          and led.leader_id = public.current_developer_id()
      )
    )
  )
);

create or replace function public.can_lead_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id=p_task_id and public.leads_task_member(t.developer_id)
  );
$$;

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
    select 1
    from public.developer_team_ids(v_old.developer_id) as current_team(team_id)
    join public.developer_team_ids(p_developer_id) as new_team(team_id) using (team_id)
    where public.is_team_lead_for(current_team.team_id)
  ) then raise exception 'New assignee must share a team you lead with the current assignee'; end if;
  perform set_config('app.task_management_rpc','on',true);
  update public.tasks set developer_id=p_developer_id,start_date=p_start_date,due_date=p_due_date,priority=p_priority
  where id=p_task_id returning * into v_new;
  insert into public.task_management_audits(task_id,action,before_data,after_data,actor_id,reason)
  values(p_task_id,'lead_manage',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

create or replace function public.can_view_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (
        p.owner_id = public.current_developer_id()
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

create or replace function public.get_task_creation_projects()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name, p.id), '[]'::jsonb)
  from public.projects p;
$$;

create or replace function public.get_eligible_internal_test_projects(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=public.current_developer_id(); v_result jsonb;
begin
  if v_actor is null then raise exception 'Account is not linked to a developer profile'; end if;
  with assessed as(
    select p.id,p.name,p.test_state,p.status,p.no_test_status,
      exists(select 1 from public.test_plans tp join public.test_cycles c on c.plan_id=tp.id
        where tp.project_id=p.id and c.status not in('passed','failed','cancelled','returned')) has_active_cycle,
      exists(select 1 from public.tasks t where t.project_id=p.id and t.task_type='dev') has_dev_tasks,
      exists(select 1 from public.tasks t where t.project_id=p.id and t.task_type='dev'
        and (t.status not in('done','delayed_done') or t.completed_at is null or t.approved_by_user is null)) has_unready_task,
      (select count(*)::int from public.tasks t where t.project_id=p.id and t.task_type='dev'
        and t.status in('done','delayed_done') and t.completed_at is not null and t.approved_by_user is not null
        and not exists(select 1 from public.test_cycle_scope_tasks s join public.test_cycles c on c.id=s.cycle_id
          where s.task_id=t.id and c.status='passed')) eligible_task_count
    from public.projects p where p.owner_id=v_actor
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,
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
      and (
        p_team_id is null or case
          when t.project_id is not null and t.task_type='dev' then p_team_id in (
            select public.developer_team_ids(coalesce(t.developer_id, t.created_by))
          )
          else t.team_id=p_team_id
        end
      )
      and (coalesce(p_assignee,'')='' or (p_assignee='unassigned' and t.developer_id is null)
        or (p_assignee<>'unassigned' and t.developer_id::text=p_assignee))
      and (coalesce(p_timing,'')='' or (p_timing='overdue' and public.is_task_overdue(t.status, t.due_date))
        or (p_timing='delayed' and t.status='delayed_done'))
      and (coalesce(p_preset,'')=''
        or (p_preset='testing_active' and ((t.task_type='dev' and t.status='testing') or (t.task_type='test' and t.status not in('done','delayed_done') and t.test_result is null)))
        or (p_preset='pending_my_approval' and t.status='review' and public.can_approve_task(t.id))
        or (p_preset='in_progress' and t.status='in_progress')
        or (p_preset='completed' and t.status='done')
        or (p_preset='delayed_done' and t.status='delayed_done')
        or (p_preset='overdue' and public.is_task_overdue(t.status, t.due_date)))
      and (coalesce(p_result,'')='' or (t.task_type='test' and t.test_result=p_result))
      and (p_blocked is null or exists(select 1 from public.test_rounds tr where tr.test_task_id=t.id and tr.blocked=p_blocked))
      and (coalesce(p_summary,'')='' or (p_summary='missing' and t.task_type='test' and t.test_result is not null
        and not exists(select 1 from public.test_rounds tr where tr.test_task_id=t.id and tr.result is not null)))
      and (coalesce(trim(p_query),'')='' or t.title ilike '%'||trim(p_query)||'%'
        or coalesce(t.description,'') ilike '%'||trim(p_query)||'%' or coalesce(p.name,'') ilike '%'||trim(p_query)||'%')
      and (coalesce(p_scope,'all')='all'
        or (p_scope='mine' and t.developer_id=public.current_developer_id())
        or (p_scope='team' and (
          public.current_developer_id() in (t.developer_id, t.created_by)
          or public.leads_task_member(t.developer_id)
          or public.leads_task_member(t.created_by)
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

notify pgrst, 'reload schema';
