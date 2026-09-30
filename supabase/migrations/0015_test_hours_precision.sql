-- =============================================================
-- 0015_test_hours_precision.sql
-- Preserve quarter-hour corrections across plan, cycle, activity, and
-- resource-summary APIs. Presentation code may still format these values.
-- =============================================================

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
    select r.developer_id,d.name,d.position,r.source,round(sum(r.planned_hours),2) planned_hours,round(sum(r.actual_hours),2) actual_hours
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
      select round(coalesce(sum(ap.planned_hours),0)::numeric,2) planned_hours
      from public.test_activity_participants ap join public.test_activities a on a.id=ap.activity_id
      join public.test_cycles c on c.id=a.cycle_id where c.plan_id=tp.id
    )plan_eff on true
    left join lateral(
      select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,2) actual_hours
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
  select round(coalesce(sum(ap.planned_hours),0)::numeric,2) into v_planned
  from public.test_activity_participants ap join public.test_activities a on a.id=ap.activity_id
  join public.test_cycles c on c.id=a.cycle_id where c.plan_id=p_plan_id;
  select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,2) into v_actual
  from public.tasks t join public.task_work_segments ws on ws.task_id=t.id
  where t.test_plan_id=p_plan_id and ws.ended_at is not null and ws.voided_at is null;
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object(
    'main_tester_name',d.name,
    'planned_hours',coalesce((select round(sum(ap.planned_hours),2) from public.test_activity_participants ap join public.test_activities a on a.id=ap.activity_id where a.cycle_id=c.id),0),
    'actual_hours',coalesce((select round(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),2) from public.tasks t join public.task_work_segments ws on ws.task_id=t.id where t.test_cycle_id=c.id and ws.ended_at is not null and ws.voided_at is null),0),
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
        select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,2) hours
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

revoke all on function public.get_test_resource_summary(date,date) from public;
revoke all on function public.get_testing_center(text,text,int,int) from public;
revoke all on function public.get_test_plan_detail(uuid) from public;
grant execute on function public.get_test_resource_summary(date,date) to authenticated;
grant execute on function public.get_testing_center(text,text,int,int) to authenticated;
grant execute on function public.get_test_plan_detail(uuid) to authenticated;
