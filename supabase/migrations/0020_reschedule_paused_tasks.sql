alter table public.tasks add column planned_work_days integer check (planned_work_days > 0);

create or replace function public.is_task_overdue(p_status text, p_due_date date)
returns boolean language sql stable set search_path = public as $$
  select p_status not in ('paused', 'review', 'done', 'delayed_done')
    and p_due_date < (now() at time zone 'Asia/Shanghai')::date;
$$;

-- Keep submission, approval and the task list's work-day aggregation on the same calendar.
alter function public.enforce_task_rules() set timezone = 'Asia/Shanghai';
alter function public.admin_execute_task_action(uuid, text, text, text) set timezone = 'Asia/Shanghai';
alter function public.list_tasks(text, text, text, uuid, text[], text, text, uuid, text, text, text, boolean, text, uuid, int, int)
  set timezone = 'Asia/Shanghai';

create function public.reschedule_task_on_resume()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_resume_date date := (now() at time zone 'Asia/Shanghai')::date;
  v_worked_days integer;
  v_worked_on_resume_date boolean;
begin
  if tg_op = 'INSERT' then
    new.planned_work_days := null;
    return new;
  end if;

  -- A manual schedule change sets a new baseline. An automatic extension preserves it.
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

  select count(distinct work_day)::integer, coalesce(bool_or(work_day = v_resume_date), false)
    into v_worked_days, v_worked_on_resume_date
  from public.task_work_segments ws
  cross join lateral (
    select (ws.started_at at time zone 'Asia/Shanghai')::date + day_offset as work_day
    from generate_series(0, (ws.ended_at at time zone 'Asia/Shanghai')::date
                            - (ws.started_at at time zone 'Asia/Shanghai')::date) as offsets(day_offset)
  ) days
  where ws.task_id = new.id and ws.ended_at is not null and ws.voided_at is null;

  new.planned_work_days := coalesce(new.planned_work_days, new.due_date - new.start_date + 1);
  -- The resume date is the first remaining day unless a prior segment already used it.
  new.due_date := greatest(new.due_date, v_resume_date + greatest(0,
    new.planned_work_days - v_worked_days - case when v_worked_on_resume_date then 0 else 1 end));
  return new;
end;
$$;

revoke all on function public.reschedule_task_on_resume() from public;

-- Run after the actor and state guards validate the requested transition.
-- The work-segment trigger opens the new segment after the row update.
create trigger trg_tasks_schedule_on_resume before insert or update on public.tasks
  for each row execute function public.reschedule_task_on_resume();

notify pgrst, 'reload schema';
