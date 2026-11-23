-- An empty array records a schedule with no weekend duty. Null preserves legacy calendar-day plans.
alter table public.tasks
  add column weekend_work_dates date[],
  add column original_due_date date,
  drop constraint tasks_planned_work_days_check,
  add constraint tasks_planned_work_days_check check (planned_work_days >= 0);

create or replace function public.reschedule_task_on_resume()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_resume_date date := (now() at time zone 'Asia/Shanghai')::date;
  v_pause_date date;
  v_worked_days integer;
  v_planned_days integer;
  v_rescheduled_due_date date;
begin
  if new.weekend_work_dates is not null then
    new.weekend_work_dates := array(
      select distinct duty_date
      from unnest(new.weekend_work_dates) as dates(duty_date)
      where isfinite(duty_date) and duty_date between new.start_date and new.due_date
        and extract(isodow from duty_date) in (6, 7)
      order by duty_date
    );
  end if;

  if tg_op = 'INSERT' then
    new.planned_work_days := null;
    new.original_due_date := null;
    return new;
  end if;

  if (new.start_date, new.due_date, new.weekend_work_dates)
      is distinct from (old.start_date, old.due_date, old.weekend_work_dates) then
    new.planned_work_days := null;
    new.original_due_date := null;
  else
    new.planned_work_days := old.planned_work_days;
    new.original_due_date := old.original_due_date;
  end if;

  if new.task_type <> 'dev' or new.work_source <> 'development'
     or old.status <> 'paused' or new.status <> 'in_progress'
     or new.start_date is null or new.due_date is null or new.due_date < new.start_date then
    return new;
  end if;

  -- Pausing closes the current work segment. Its end time survives edits while paused.
  select (max(ws.ended_at) at time zone 'Asia/Shanghai')::date into v_pause_date
  from public.task_work_segments ws
  where ws.task_id = new.id and ws.ended_at is not null and ws.voided_at is null;

  if v_pause_date is null or v_pause_date >= v_resume_date or v_pause_date > new.due_date then
    return new;
  end if;

  select count(distinct work_day)::integer into v_worked_days
  from public.task_work_segments ws
  cross join lateral (
    select (ws.started_at at time zone 'Asia/Shanghai')::date + day_offset as work_day
    from generate_series(0, (ws.ended_at at time zone 'Asia/Shanghai')::date
                            - (ws.started_at at time zone 'Asia/Shanghai')::date) as offsets(day_offset)
  ) days
  where ws.task_id = new.id and ws.ended_at is not null and ws.voided_at is null;

  if new.planned_work_days is not null then
    v_planned_days := new.planned_work_days;
  elsif new.weekend_work_dates is null then
    v_planned_days := new.due_date - new.start_date + 1;
  else
    -- Count full weeks and the weekday portion of the final partial week.
    select (new.due_date - new.start_date) / 7 * 5 + count(*)::integer
      + cardinality(new.weekend_work_dates) into v_planned_days
    from generate_series(0, (new.due_date - new.start_date) % 7) as offsets(day_offset)
    where extract(isodow from new.start_date + day_offset) between 1 and 5;
  end if;
  v_rescheduled_due_date := v_resume_date + greatest(0, v_planned_days - v_worked_days - 1);
  if v_rescheduled_due_date > new.due_date then
    new.original_due_date := coalesce(new.original_due_date, case
      when new.planned_work_days is not null and new.weekend_work_dates is null
        then new.start_date + (new.planned_work_days - 1)
      else new.due_date
    end);
    new.planned_work_days := v_planned_days;
    new.due_date := v_rescheduled_due_date;
    insert into public.task_management_audits(task_id, action, before_data, after_data, actor_id, reason)
    values (new.id, 'auto_reschedule', jsonb_build_object('due_date', old.due_date),
      jsonb_build_object('due_date', new.due_date, 'planned_work_days', v_planned_days,
        'paused_on', v_pause_date, 'resumed_on', v_resume_date),
      public.current_developer_id(), '挂起后跨天恢复，按剩余计划工期自动顺延');
  end if;
  return new;
end;
$$;

-- Replace the signatures while retaining the original arguments for existing callers.
drop function public.lead_manage_task(uuid,uuid,date,date,text,text);
drop function public.admin_manage_task(uuid,uuid,uuid,date,date,text,text);

create or replace function public.lead_manage_task(
  p_task_id uuid, p_developer_id uuid, p_start_date date, p_due_date date, p_priority text, p_reason text,
  p_weekend_work_dates date[] default null
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
  update public.tasks set developer_id=p_developer_id,start_date=p_start_date,due_date=p_due_date,priority=p_priority,
    weekend_work_dates=coalesce(p_weekend_work_dates,v_old.weekend_work_dates)
  where id=p_task_id returning * into v_new;
  insert into public.task_management_audits(task_id,action,before_data,after_data,actor_id,reason)
  values(p_task_id,'lead_manage',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

create or replace function public.admin_manage_task(
  p_task_id uuid, p_developer_id uuid, p_team_id uuid, p_start_date date, p_due_date date, p_priority text, p_reason text,
  p_weekend_work_dates date[] default null
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
  update public.tasks set developer_id=p_developer_id,team_id=p_team_id,start_date=p_start_date,due_date=p_due_date,priority=p_priority,
    weekend_work_dates=coalesce(p_weekend_work_dates,v_old.weekend_work_dates)
  where id=p_task_id returning * into v_new;
  insert into public.task_management_audits(task_id,action,before_data,after_data,actor_id,reason)
  values(p_task_id,'admin_manage',to_jsonb(v_old),to_jsonb(v_new),public.current_developer_id(),v_reason);
  return v_new;
end;
$$;

revoke all on function public.lead_manage_task(uuid,uuid,date,date,text,text,date[]) from public;
revoke all on function public.admin_manage_task(uuid,uuid,uuid,date,date,text,text,date[]) from public;
grant execute on function public.lead_manage_task(uuid,uuid,date,date,text,text,date[]) to authenticated;
grant execute on function public.admin_manage_task(uuid,uuid,uuid,date,date,text,text,date[]) to authenticated;

notify pgrst, 'reload schema';
