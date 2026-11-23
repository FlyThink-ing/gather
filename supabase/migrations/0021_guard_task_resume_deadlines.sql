alter table public.task_management_audits
  drop constraint task_management_audits_action_check,
  add constraint task_management_audits_action_check
    check (action in ('lead_manage', 'admin_manage', 'admin_execute', 'auto_reschedule'));

create or replace function public.reschedule_task_on_resume()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_resume_date date := (now() at time zone 'Asia/Shanghai')::date;
  v_pause_date date;
  v_worked_days integer;
  v_planned_days integer;
  v_rescheduled_due_date date;
begin
  if tg_op = 'INSERT' then
    new.planned_work_days := null;
    return new;
  end if;

  if (new.start_date, new.due_date) is distinct from (old.start_date, old.due_date) then
    new.planned_work_days := null;
  else
    new.planned_work_days := old.planned_work_days;
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

  v_planned_days := coalesce(new.planned_work_days, new.due_date - new.start_date + 1);
  v_rescheduled_due_date := v_resume_date + greatest(0, v_planned_days - v_worked_days - 1);
  if v_rescheduled_due_date > new.due_date then
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

create function public.get_dashboard_task_counts(p_task_type text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', count(*)::int,
    'in_progress', count(*) filter (where t.status = 'in_progress')::int,
    'paused', count(*) filter (where t.status = 'paused')::int,
    'testing_active', count(*) filter (where (t.task_type = 'dev' and t.status = 'testing')
      or (t.task_type = 'test' and t.status not in ('done', 'delayed_done') and t.test_result is null))::int,
    'pending_my_approval', count(*) filter (where t.status = 'review' and public.can_approve_task(t.id))::int,
    'completed', count(*) filter (where t.status = 'done')::int,
    'delayed_done', count(*) filter (where t.status = 'delayed_done')::int,
    'overdue', count(*) filter (where public.is_task_overdue(t.status, t.due_date))::int
  )
  from public.tasks t
  where (p_task_type is null or t.task_type = p_task_type) and public.can_view_task(t.id);
$$;

revoke all on function public.get_dashboard_task_counts(text) from public, anon, authenticated;
grant execute on function public.get_dashboard_task_counts(text) to authenticated;

create or replace function public.get_dashboard_task_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select public.get_dashboard_task_counts(null::text);
$$;

notify pgrst, 'reload schema';
