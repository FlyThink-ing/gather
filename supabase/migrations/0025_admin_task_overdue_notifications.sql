create extension if not exists pg_cron with schema pg_catalog;

create table public.task_overdue_alerts (
  task_id uuid not null references public.tasks(id) on delete cascade,
  due_date date not null,
  primary key (task_id, due_date)
);

alter table public.task_overdue_alerts enable row level security;
revoke all on table public.task_overdue_alerts from public, anon, authenticated;

-- Register existing overdue deadlines without notifying administrators about the backlog.
insert into public.task_overdue_alerts (task_id, due_date)
select id, due_date from public.tasks
where public.is_task_overdue(status, due_date);

create function public.notify_admins_of_overdue_tasks()
returns integer language sql set search_path = public as $$
  with admins as (
    select d.id
    from public.user_roles r
    join public.developers d on d.user_id = r.user_id
    where r.role = 'admin' and d.is_active
  ), claimed as (
    insert into public.task_overdue_alerts (task_id, due_date)
    select t.id, t.due_date
    from public.tasks t
    where public.is_task_overdue(t.status, t.due_date)
      and exists (select 1 from admins)
      and not exists (
        select 1 from public.task_overdue_alerts a
        where a.task_id = t.id and a.due_date = t.due_date
      )
    for no key update of t skip locked
    on conflict (task_id, due_date) do nothing
    returning task_id, due_date
  ), sent as (
    insert into public.notifications (recipient_id, type, payload)
    select a.id, 'task_overdue', jsonb_build_object(
      'task_id', c.task_id, 'title', t.title, 'due_date', c.due_date
    )
    from claimed c
    join public.tasks t on t.id = c.task_id
    cross join admins a
    returning 1
  )
  select count(*)::integer from sent;
$$;

revoke all on function public.notify_admins_of_overdue_tasks() from public, anon, authenticated, service_role;

select cron.schedule('gather-admin-task-overdue', '*/5 * * * *', 'select public.notify_admins_of_overdue_tasks()');
