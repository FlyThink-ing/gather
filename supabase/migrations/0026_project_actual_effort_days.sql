-- 合并每项任务覆盖的北京时间日期区间，避免逐日展开历史工时段。
create function public.task_actual_days(p_task_id uuid)
returns int language sql stable set search_path=public as $$
  select coalesce(sum(upper(work_days)-lower(work_days)),0)::int
  from unnest((
    select range_agg(daterange(
      (ws.started_at at time zone 'Asia/Shanghai')::date,
      (ws.ended_at at time zone 'Asia/Shanghai')::date,
      '[]'
    ))
    from public.task_work_segments ws
    where ws.task_id=p_task_id and ws.voided_at is null
      and isfinite(ws.started_at) and isfinite(ws.ended_at) and ws.ended_at>=ws.started_at
  )) as work_days;
$$;

revoke all on function public.task_actual_days(uuid) from public, anon, authenticated;

create or replace function public.project_summary_json(p_project_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select to_jsonb(p)||jsonb_build_object(
    'plan_days',case when p.start_date is not null and p.end_date is not null and p.end_date>=p.start_date then (p.end_date-p.start_date)+1 end,
    'actual_cycle_days',case when p.actual_started_at is null or (p.status='completed' and p.completed_at is null) then null
      else (coalesce(p.completed_at,now())::date-p.actual_started_at::date)+1 end,
    'actual_effort_days',coalesce(ts.actual_days,0),
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
      count(*) filter(where public.is_task_overdue(t.status, t.due_date))::int overdue_count,
      count(*) filter(where (t.task_type='dev' and t.status='testing') or (t.task_type='test' and t.status not in('done','delayed_done') and t.test_result is null))::int testing_active_count,
      count(*) filter(where t.status in('done','delayed_done'))::int completed_count,
      count(*) filter(where t.status='delayed_done')::int delayed_done_count,
      count(*) filter(where t.developer_id is null)::int unassigned_count,
      count(*) filter(where t.task_type='dev' and t.status not in('done','delayed_done'))::int unfinished_dev_count,
      count(*) filter(where t.task_type='test' and t.status not in('done','delayed_done'))::int active_test_count,
      count(*) filter(where t.status='todo')::int todo_count,count(*) filter(where t.status='in_progress')::int in_progress_count,
      count(*) filter(where t.status='paused')::int paused_count,count(*) filter(where t.status='testing')::int testing_status_count,
      count(*) filter(where t.status='done')::int done_count,
      sum(public.task_actual_days(t.id)) actual_days
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
    'test_actual_days',coalesce(eff.actual_days,0),'test_actual_hours',coalesce(eff.actual_hours,0),'cycles',coalesce(ca.cycles,'[]'::jsonb)
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
    select sum(public.task_actual_days(t.id)) actual_days,
      round(coalesce(sum(seg.hours),0)::numeric,1) actual_hours
    from public.tasks t
    left join lateral(
      select sum(extract(epoch from(ws.ended_at-ws.started_at))/3600) hours
      from public.task_work_segments ws
      where ws.task_id=t.id and ws.ended_at is not null and ws.voided_at is null
    )seg on true
    where t.test_plan_id=tp.id and t.work_source='test_activity'
  )eff on true where p.id=p_project_id;
  return v_result;
end;
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
  select coalesce(jsonb_agg(to_jsonb(x) order by x.actual_effort_days desc,x.person_name),'[]'::jsonb) into v_people
  from(
    select t.developer_id,coalesce(d.name,'Unassigned') person_name,d.position,count(*)::int task_count,
      count(*) filter(where t.task_type='dev')::int dev_task_count,count(*) filter(where t.task_type='test')::int test_task_count,
      count(*) filter(where t.status in('done','delayed_done'))::int completed_task_count,
      count(*) filter(where t.status='review')::int review_task_count,
      count(*) filter(where public.is_task_overdue(t.status, t.due_date))::int overdue_task_count,
      coalesce(sum(public.task_actual_days(t.id)),0) actual_effort_days,
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
      round(coalesce(eff.hours,0)::numeric,1) actual_effort_hours
    from public.tasks t
    left join public.projects p on p.id=t.project_id
    left join lateral(
      select sum(extract(epoch from(ws.ended_at-ws.started_at))/3600.0) hours
      from public.task_work_segments ws
      where ws.task_id=t.id and ws.ended_at is not null and ws.voided_at is null
    )eff on true
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
  page_rows as(select counted.*,public.task_actual_days(id) actual_day_count from counted order by created_at desc,id
    offset (greatest(coalesce(p_page,1),1)-1)*least(greatest(coalesce(p_page_size,10),1),100)
    limit least(greatest(coalesce(p_page_size,10),1),100))
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(r)-'total_count' order by r.created_at desc,r.id) from page_rows r),'[]'::jsonb),
    'total',coalesce((select max(total_count) from counted),0),
    'page',greatest(coalesce(p_page,1),1),'page_size',least(greatest(coalesce(p_page_size,10),1),100)
  );
$$;

notify pgrst, 'reload schema';
