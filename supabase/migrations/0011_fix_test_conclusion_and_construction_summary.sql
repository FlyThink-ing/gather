-- Fix test conclusion terminal status mapping and construction detail summary.

create or replace function public.review_test_conclusion(
  p_cycle_id uuid,
  p_confirm boolean,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_cycle public.test_cycles%rowtype;
  v_plan public.test_plans%rowtype;
  v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
  v_terminal_status text;
begin
  select * into v_cycle from public.test_cycles where id=p_cycle_id for update;
  if not found then raise exception '测试轮次不存在'; end if;
  select * into v_plan from public.test_plans where id=v_cycle.plan_id;
  if not (public.is_test_lead(v_plan.test_team_id) or public.is_admin()) then raise exception '仅测试组长可以确认测试结论'; end if;
  if v_cycle.status<>'conclusion_pending' then raise exception '当前没有待确认的测试结论'; end if;
  if not p_confirm then
    if v_reason is null then raise exception '退回结论必须填写原因'; end if;
    update public.test_cycles set status='in_progress',conclusion_return_reason=v_reason where id=p_cycle_id;
    update public.test_plans set status='in_progress' where id=v_cycle.plan_id;
    insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,reason) values(v_cycle.plan_id,p_cycle_id,'conclusion_returned',public.current_developer_id(),v_reason);
    perform public.notify(v_cycle.main_tester_id,'test_conclusion_returned',jsonb_build_object('cycle_id',p_cycle_id,'reason',v_reason));
    return;
  end if;

  v_terminal_status:=case v_cycle.proposed_result
    when 'pass' then 'passed'
    when 'fail' then 'failed'
    else null
  end;
  if v_terminal_status is null then raise exception '待确认测试结论无效'; end if;

  update public.test_cycles set status=v_terminal_status,actual_completed_at=now(),
    conclusion_confirmed_by=public.current_developer_id(),conclusion_confirmed_at=now()
  where id=p_cycle_id;
  update public.test_plans set status=v_terminal_status where id=v_cycle.plan_id;
  if v_plan.project_id is not null then
    perform set_config('app.test_center_rpc','on',true);
    update public.projects set test_state=case when v_cycle.proposed_result='pass' then 'passed' else 'fixing' end
    where id=v_plan.project_id;
  end if;
  perform set_config('app.test_center_rpc','on',true);
  update public.tasks set status='done',submitted_at=coalesce(submitted_at,now()),completed_at=coalesce(completed_at,now())
  where test_cycle_id=p_cycle_id and work_source='test_activity' and status not in ('done','delayed_done');
  update public.test_activities set status='done' where cycle_id=p_cycle_id and status not in ('done','cancelled');
  insert into public.test_plan_events(plan_id,cycle_id,event_type,actor_id,payload)
  values(v_cycle.plan_id,p_cycle_id,'conclusion_confirmed',public.current_developer_id(),jsonb_build_object('result',v_cycle.proposed_result));
  perform public.notify(v_cycle.main_tester_id,'test_conclusion_confirmed',jsonb_build_object('cycle_id',p_cycle_id,'result',v_cycle.proposed_result));
  if v_plan.project_id is not null then
    perform public.notify((select owner_id from public.projects where id=v_plan.project_id),'project_test_concluded',
      jsonb_build_object('project_id',v_plan.project_id,'cycle_id',p_cycle_id,'result',v_cycle.proposed_result));
  end if;
end;
$$;

create or replace function public.get_construction_detail(p_work_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.can_view_construction(p_work_id) then raise exception '无权查看该测试建设工作'; end if;
  select to_jsonb(w)||jsonb_build_object(
    'owner_name',d.name,
    'task_count',coalesce(t.task_count,0),
    'done_count',coalesce(t.done_count,0),
    'planned_hours',coalesce(t.planned_hours,0),
    'actual_hours',coalesce(e.actual_hours,0),
    'participants',coalesce((select jsonb_agg(to_jsonb(cp)||jsonb_build_object('name',pd.name) order by cp.participant_role,pd.name) from public.test_construction_participants cp join public.developers pd on pd.id=cp.developer_id where cp.work_id=w.id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(ct)||jsonb_build_object('owner_name',td.name,'actual_hours',coalesce(te.hours,0)) order by ct.created_at) from public.test_construction_tasks ct join public.developers td on td.id=ct.owner_id left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) hours from public.task_work_segments ws where ws.task_id=ct.task_id and ws.ended_at is not null)te on true where ct.work_id=w.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(ce)||jsonb_build_object('actor_name',ed.name) order by ce.created_at desc) from public.test_construction_events ce left join public.developers ed on ed.id=ce.actor_id where ce.work_id=w.id),'[]'::jsonb)
  ) into v_result
  from public.test_construction_works w
  join public.developers d on d.id=w.owner_id
  left join lateral(select count(*)::int task_count,count(*) filter(where status='done')::int done_count,round(coalesce(sum(planned_hours),0)::numeric,1) planned_hours from public.test_construction_tasks where work_id=w.id)t on true
  left join lateral(select round(coalesce(sum(extract(epoch from(ws.ended_at-ws.started_at))/3600),0)::numeric,1) actual_hours from public.tasks tk join public.task_work_segments ws on ws.task_id=tk.id where tk.construction_work_id=w.id and ws.ended_at is not null)e on true
  where w.id=p_work_id;
  if v_result is null then raise exception '测试建设工作不存在'; end if;
  return v_result;
end;
$$;
