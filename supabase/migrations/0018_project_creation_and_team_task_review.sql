-- Project creation, development task review, and task project selection.
alter policy proj_insert on public.projects with check (public.is_admin());

-- The task assignee's actual team memberships determine the review scope.
-- A team leader is also a member of their own team.
create or replace function public.task_group_leaders(p_assignee_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct t.leader_id
  from public.teams t
  join public.developers lead on lead.id = t.leader_id and lead.is_active and lead.user_id is not null
  where t.leader_id = p_assignee_id
    or exists (
      select 1 from public.developer_teams member
      where member.developer_id = p_assignee_id and member.team_id = t.id
    );
$$;

revoke all on function public.task_group_leaders(uuid) from public, anon, authenticated;

create or replace function public.can_approve_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and t.task_type = 'dev'
      and t.project_id is not null
      and t.status = 'review'
      and public.current_developer_id() in (select public.task_group_leaders(t.developer_id))
  );
$$;

alter policy task_update on public.tasks
  using (public.can_execute_task(id) or (status = 'review' and public.can_approve_task(id)))
  with check (public.can_execute_task(id) or public.can_approve_task(id));

-- The creation picker exposes only project identity and its team.
-- Project and task detail access still follows the existing visibility rules.
-- A single JSON result avoids the API row limit truncating the picker.
drop function public.get_task_creation_projects();
create function public.get_task_creation_projects()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('id', p.id, 'name', p.name, 'team_id', p.team_id)
    order by p.name, p.id
  ), '[]'::jsonb)
  from public.projects p;
$$;

revoke all on function public.get_task_creation_projects() from public, anon;
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

drop function if exists public.can_create_own_team_project_task(uuid, uuid);

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

  -- Approvers may only change status, plus reject_note when returning a task.
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
    raise exception 'Only a leader of the assignee''s team may approve or reject a review task';
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

create or replace function public.enforce_task_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_dev uuid := public.current_developer_id();
  completion_time timestamptz;
  is_admin_proxy boolean := public.is_admin()
    and coalesce(current_setting('app.admin_approval_proxy', true), '') = 'on';
  admin_proxy_reason text := nullif(trim(coalesce(
    current_setting('app.admin_approval_reason', true), ''
  )), '');
begin
  -- Only the assignee's group leader can make a normal review decision.
  if old.status = 'review' and new.status <> 'review' then
    if not public.can_approve_task(old.id) and not is_admin_proxy then
      raise exception '无审批权限：由任务负责人所属小组的组长审批；管理员请使用异常代办入口';
    end if;
    if is_admin_proxy and admin_proxy_reason is null then
      raise exception '管理员异常代办必须填写代办原因';
    end if;

    if new.status in ('done', 'delayed_done') then
      completion_time := coalesce(old.submitted_at, now());
      new.completed_at := completion_time;
      new.status := case
        when new.due_date is not null and completion_time::date > new.due_date then 'delayed_done'
        else 'done'
      end;
      new.approved_by_role := public.auth_role();
      new.approved_by_user := actor_dev;
      new.reject_note := null;
    elsif new.status = 'in_progress' then
      if new.reject_note is null or length(trim(new.reject_note)) = 0 then
        raise exception '驳回任务必须填写驳回原因';
      end if;
      new.completed_at := null;
      new.approved_by_role := null;
      new.approved_by_user := null;
    else
      raise exception '审核中的任务只能审批完成或驳回到进行中';
    end if;
    return new;
  end if;

  -- 2) 开发任务提交完成：项目任务强制 review；无项目任务直接完成。
  if old.task_type = 'dev'
     and old.status = 'in_progress'
     and new.status in ('review', 'done', 'delayed_done') then
    completion_time := now();
    if new.due_date is not null and completion_time::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，提交审核前需填写延期原因';
    end if;
    new.submitted_at := completion_time;
    new.approved_by_role := null;
    new.approved_by_user := null;
    new.reject_note := null;

    if old.project_id is not null then
      new.status := 'review';
      new.completed_at := null;
    else
      new.completed_at := completion_time;
      new.status := case
        when new.due_date is not null and completion_time::date > new.due_date then 'delayed_done'
        else 'done'
      end;
    end if;
    return new;
  end if;

  -- 3) 测试通过后的开发任务：项目任务一律 review；无项目任务直接完成。
  if old.task_type = 'dev'
     and old.status = 'testing'
     and new.status in ('review', 'done', 'delayed_done') then
    if old.project_id is not null then
      new.status := 'review';
      new.completed_at := null;
      new.approved_by_role := null;
      new.approved_by_user := null;
    else
      completion_time := coalesce(old.submitted_at, now());
      new.completed_at := completion_time;
      new.status := case
        when new.due_date is not null and completion_time::date > new.due_date then 'delayed_done'
        else 'done'
      end;
      new.approved_by_role := null;
      new.approved_by_user := null;
      new.reject_note := null;
    end if;
    return new;
  end if;

  -- 4) 其他兼容入口进入 review 时仍校验任务类型及项目归属。
  if old.status <> 'review' and new.status = 'review' then
    if old.task_type = 'test' then
      raise exception '测试任务以测试结论结束，不走项目审批';
    end if;
    if old.project_id is null then
      raise exception '无项目任务不进入项目审批，应由负责人直接完成';
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
    if new.due_date is not null and new.submitted_at::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，提交审核前需填写延期原因';
    end if;
    return new;
  end if;

  -- 5) 提测与锁定规则保持不变。
  if old.status <> 'testing' and new.status = 'testing' then
    if old.task_type = 'test' then raise exception '测试任务不能再次提测'; end if;
    if old.status <> 'in_progress' then raise exception '只有进行中的任务可以提测'; end if;
    new.submitted_at := now();
    if new.due_date is not null and now()::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，提测前需填写延期备注';
    end if;
    return new;
  end if;

  if old.status = 'testing' and new.status not in ('testing', 'review', 'done', 'delayed_done', 'in_progress') then
    raise exception '测试中的任务需等待测试结论';
  end if;

  if old.status = 'review' and new.status = 'review'
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception '任务审核中已锁定，只能执行审批通过或驳回';
  end if;

  if new.status = 'paused' and old.status not in ('paused', 'in_progress') then
    raise exception '只有进行中的任务可以挂起';
  end if;
  if old.status = 'paused' and new.status not in ('paused', 'in_progress') then
    raise exception '挂起的任务需先恢复为进行中';
  end if;
  return new;
end;
$$;

create or replace function public.admin_proxy_task_review(
  p_task_id uuid,
  p_approve boolean,
  p_reason text,
  p_reject_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_reason text := nullif(trim(p_reason), '');
  v_reject text := nullif(trim(p_reject_note), '');
begin
  if not public.is_admin() then raise exception '仅管理员可执行异常代办'; end if;
  if public.current_developer_id() is null then raise exception '当前管理员账号未绑定人员档案，无法记录审批审计'; end if;
  if v_reason is null then raise exception '管理员异常代办必须填写代办原因'; end if;
  if length(v_reason) > 2000 then raise exception '代办原因不能超过 2000 个字符'; end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if v_task.status <> 'review' then raise exception '仅审核中的任务可执行异常代办'; end if;
  if v_task.task_type = 'test' then raise exception '测试任务不走项目审批'; end if;

  if not p_approve and v_reject is null then raise exception '驳回任务必须填写驳回原因'; end if;
  if length(coalesce(v_reject, '')) > 2000 then raise exception '驳回原因不能超过 2000 个字符'; end if;

  perform set_config('app.admin_approval_proxy', 'on', true);
  perform set_config('app.admin_approval_reason', v_reason, true);

  if p_approve then
    update public.tasks set status = 'done' where id = p_task_id;
  else
    update public.tasks set status = 'in_progress', reject_note = v_reject where id = p_task_id;
  end if;
end;
$$;

create or replace function public.notify_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'review' and new.status = 'review' then
    perform public.notify(leader.developer_id, 'task_submitted',
      jsonb_build_object('task_id', new.id, 'title', new.title))
    from public.task_group_leaders(new.developer_id) as leader(developer_id);
  end if;

  if old.status = 'review' and new.status in ('done', 'delayed_done') then
    perform public.notify(new.developer_id, 'task_approved',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'result', new.status));
  end if;

  if old.status = 'review' and new.status = 'in_progress' then
    perform public.notify(new.developer_id, 'task_rejected',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'reason', new.reject_note));
  end if;
  return new;
end;
$$;

create or replace function public.get_my_pending_approval_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.tasks t
  where t.status = 'review' and public.can_approve_task(t.id);
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
      and (p_team_id is null or t.team_id=p_team_id)
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

create or replace function public.get_dashboard_task_counts()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'total',count(*)::int,
    'in_progress',count(*) filter(where t.status='in_progress')::int,
    'testing_active',count(*) filter(where (t.task_type='dev' and t.status='testing')
      or (t.task_type='test' and t.status not in('done','delayed_done') and t.test_result is null))::int,
    'pending_my_approval',count(*) filter(where t.status='review' and public.can_approve_task(t.id))::int,
    'completed',count(*) filter(where t.status='done')::int,
    'delayed_done',count(*) filter(where t.status='delayed_done')::int,
    'overdue',count(*) filter(where public.is_task_overdue(t.status, t.due_date))::int
  )
  from public.tasks t
  where public.can_view_task(t.id);
$$;

notify pgrst, 'reload schema';
