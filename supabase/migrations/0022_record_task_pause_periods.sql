create table public.task_pause_periods (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  paused_at timestamptz not null,
  resumed_at timestamptz,
  check (resumed_at >= paused_at)
);

create index task_pause_periods_history_idx on public.task_pause_periods(task_id, paused_at desc, id desc);
create unique index task_pause_periods_open_idx on public.task_pause_periods(task_id) where resumed_at is null;

alter table public.task_pause_periods enable row level security;
revoke all on public.task_pause_periods from public, anon, authenticated;
grant select on public.task_pause_periods to authenticated;
create policy task_pause_periods_read on public.task_pause_periods for select to authenticated
  using (public.can_view_task(task_id));

create function public.track_task_pause_periods()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_transition_at timestamptz := clock_timestamp();
begin
  if new.status = 'paused' then
    insert into public.task_pause_periods(task_id, paused_at) values (new.id, v_transition_at);
  else
    update public.task_pause_periods set resumed_at = greatest(v_transition_at, paused_at)
    where task_id = new.id and resumed_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.track_task_pause_periods() from public, anon, authenticated;

create trigger trg_tasks_pause_periods after update of status on public.tasks
  for each row when (
    new.task_type = 'dev' and new.work_source = 'development'
    and ((old.status = 'in_progress' and new.status = 'paused')
      or (old.status = 'paused' and new.status = 'in_progress'))
  ) execute function public.track_task_pause_periods();

-- The trigger lock blocks concurrent task updates while current pauses are backfilled.
-- Earlier work-segment gaps could also be time spent in review.
insert into public.task_pause_periods(task_id, paused_at)
select t.id, max(ws.ended_at)
from public.tasks t
join public.task_work_segments ws on ws.task_id = t.id
where t.status = 'paused' and t.task_type = 'dev' and t.work_source = 'development'
  and ws.entry_source = 'automatic' and ws.ended_at is not null and ws.voided_at is null
group by t.id;

notify pgrst, 'reload schema';
