alter table public.task_work_segments
  add column started_from_status text,
  add column ended_to_status text;

create or replace function public.track_work_segments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.work_source in ('test_activity', 'construction') then return new; end if;

  if old.status <> 'in_progress' and new.status = 'in_progress' then
    insert into public.task_work_segments(task_id, developer_id, started_at, started_from_status)
    values (new.id, new.developer_id, now(), old.status);
  elsif old.status = 'in_progress' and new.status <> 'in_progress' then
    update public.task_work_segments
    set ended_at = now(), ended_to_status = new.status
    where task_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;

-- The old work trigger uses transaction time while pause history uses clock time.
-- Match pauses between consecutive work segments instead of comparing timestamps for equality.
with segments as (
  select ws.id, ws.task_id, ws.ended_at,
    lead(ws.id) over task_segments as next_id,
    lead(ws.started_at) over task_segments as next_started_at,
    lead(ws.ended_at) over task_segments as next_ended_at
  from public.task_work_segments ws
  where ws.entry_source = 'automatic' and ws.voided_at is null
  window task_segments as (partition by ws.task_id order by ws.started_at, ws.ended_at, ws.id)
), pauses as (
  select s.id, s.next_id, s.next_started_at, s.next_ended_at, p.resumed_at
  from segments s
  join public.task_pause_periods p on p.task_id = s.task_id
    and p.paused_at >= s.ended_at
    and (s.next_started_at is null or p.paused_at < s.next_started_at)
), transitions as (
  select id, null::text as started_from_status, 'paused' as ended_to_status from pauses
  union all
  select next_id, 'paused', null
  from pauses
  where resumed_at >= next_started_at and (next_ended_at is null or resumed_at <= next_ended_at)
), reasons as (
  select id, max(started_from_status) as started_from_status, max(ended_to_status) as ended_to_status
  from transitions
  group by id
)
update public.task_work_segments ws
set started_from_status = r.started_from_status, ended_to_status = r.ended_to_status
from reasons r where r.id = ws.id;

update public.task_work_segments ws set started_from_status = 'review'
where ws.entry_source = 'automatic' and ws.voided_at is null
  and exists (
    select 1 from public.task_approval_audits a
    where a.task_id = ws.task_id and a.decision = 'rejected'
      and a.to_status = 'in_progress' and a.created_at = ws.started_at
  );

-- Legacy test workflows also wrote submitted_at when entering testing.
update public.task_work_segments ws
set ended_to_status = case
  when t.project_id is null and t.status in ('done', 'delayed_done') and t.completed_at = ws.ended_at then t.status
  else 'review'
end
from public.tasks t
where t.id = ws.task_id and t.task_type = 'dev' and t.work_source = 'development'
  and ws.entry_source = 'automatic' and ws.voided_at is null and ws.ended_to_status is null
  and not exists (
    select 1 from public.tasks legacy
    where legacy.linked_task_id = t.id and legacy.work_source = 'legacy_single_test'
  )
  and (
    (t.status in ('review', 'done', 'delayed_done') and t.submitted_at = ws.ended_at)
    or exists (
      select 1 from public.task_approval_audits a
      where a.task_id = ws.task_id and a.submitted_at_snapshot = ws.ended_at
    )
  );

notify pgrst, 'reload schema';
