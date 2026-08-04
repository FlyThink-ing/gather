-- =============================================================
-- 0005_test_methods.sql  测试方式分流（v2.10）
-- 标准用例测试记录用例数量；快速/探索性验证记录范围与原因。
-- =============================================================

alter table public.test_rounds
  add column test_method text not null default 'case_based',
  add column verification_scope text,
  add column verification_reason text;

alter table public.test_rounds
  add constraint test_rounds_method_valid
    check (test_method in ('case_based', 'exploratory')),
  add constraint test_rounds_verification_text_length
    check (
      (verification_scope is null or length(verification_scope) <= 2000)
      and (verification_reason is null or length(verification_reason) <= 2000)
    ),
  add constraint test_rounds_exploratory_payload
    check (
      test_method = 'case_based'
      or (
        planned_case_count is null
        and executed_case_count is null
        and length(trim(verification_scope)) > 0
        and length(trim(verification_reason)) > 0
      )
    );

drop function if exists public.start_test_task(uuid, int, text);

create function public.start_test_task(
  p_test_task_id uuid,
  p_test_method text default 'case_based',
  p_planned_case_count int default null,
  p_verification_scope text default null,
  p_verification_reason text default null,
  p_zentao_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_test public.tasks%rowtype;
  v_actor uuid := public.current_developer_id();
  v_round_no int;
  v_round_id uuid;
  v_method text := trim(coalesce(p_test_method, ''));
  v_scope text := nullif(trim(p_verification_scope), '');
  v_reason text := nullif(trim(p_verification_reason), '');
  v_url text := nullif(trim(p_zentao_url), '');
begin
  select * into v_test from public.tasks where id = p_test_task_id for update;
  if not found then raise exception '测试任务不存在'; end if;
  if v_test.task_type <> 'test' then raise exception '该任务不是测试任务'; end if;
  if v_test.status <> 'todo' then raise exception '只有待处理的测试任务可以开始测试'; end if;
  if not (public.is_admin() or public.is_manager() or v_test.developer_id = v_actor) then
    raise exception '仅测试负责人或管理员可开始测试';
  end if;
  if v_method not in ('case_based', 'exploratory') then raise exception '测试方式无效'; end if;
  if v_method = 'case_based' and (
    p_planned_case_count is null or p_planned_case_count <= 0 or p_planned_case_count > 1000000
  ) then
    raise exception '标准用例测试的计划用例数必须是 1～1000000 的整数';
  end if;
  if v_method = 'exploratory' and (v_scope is null or v_reason is null) then
    raise exception '快速 / 探索性验证必须填写验证范围和采用原因';
  end if;
  if length(coalesce(v_scope, '')) > 2000 or length(coalesce(v_reason, '')) > 2000 then
    raise exception '验证范围和采用原因不能超过 2000 个字符';
  end if;
  if v_url is not null and v_url !~* '^https?://[^[:space:]]+$' then
    raise exception '禅道链接必须以 http:// 或 https:// 开头';
  end if;
  if exists (select 1 from public.test_rounds where test_task_id = p_test_task_id) then
    raise exception '该测试任务已创建测试汇总，请刷新后重试';
  end if;

  select coalesce(max(tr.round_no), 0) + 1 into v_round_no
  from public.test_rounds tr
  join public.tasks tt on tt.id = tr.test_task_id
  where tt.linked_task_id is not distinct from v_test.linked_task_id;

  insert into public.test_rounds (
    test_task_id, round_no, test_method, result, blocked,
    planned_case_count, executed_case_count,
    verification_scope, verification_reason,
    bug_count, reopen_count, note,
    started_at, concluded_at, concluded_by, zentao_url
  ) values (
    p_test_task_id, v_round_no, v_method, null, false,
    case when v_method = 'case_based' then p_planned_case_count else null end,
    null,
    case when v_method = 'exploratory' then v_scope else null end,
    case when v_method = 'exploratory' then v_reason else null end,
    0, 0, null,
    now(), null, null, v_url
  ) returning id into v_round_id;

  update public.tasks set status = 'in_progress' where id = p_test_task_id;
  return v_round_id;
end;
$$;

drop function if exists public.conclude_test(uuid, boolean, text, int, int, int, int, boolean, text);

create function public.conclude_test(
  p_test_task_id uuid,
  p_pass boolean,
  p_note text default null,
  p_planned_case_count int default null,
  p_executed_case_count int default null,
  p_bug_count int default null,
  p_reopen_count int default 0,
  p_blocked boolean default false,
  p_zentao_url text default null,
  p_test_method text default null,
  p_verification_scope text default null,
  p_verification_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_test public.tasks%rowtype;
  v_actor uuid := public.current_developer_id();
  v_round public.test_rounds%rowtype;
  v_round_no int;
  v_method text;
  v_scope text := nullif(trim(p_verification_scope), '');
  v_reason text := nullif(trim(p_verification_reason), '');
  v_url text := nullif(trim(p_zentao_url), '');
begin
  select * into v_test from public.tasks where id = p_test_task_id for update;
  if not found then raise exception '测试任务不存在'; end if;
  if v_test.task_type <> 'test' then raise exception '该任务不是测试任务'; end if;
  if v_test.status <> 'in_progress' then raise exception '请先开始测试任务再给出结论'; end if;
  if not (public.is_admin() or public.is_manager() or v_test.developer_id = v_actor) then
    raise exception '仅测试负责人或管理员可给出测试结论';
  end if;
  if p_bug_count is null or p_bug_count < 0 or p_bug_count > 1000000 then
    raise exception '新增 Bug 数必须是 0～1000000 的整数';
  end if;
  if p_reopen_count is null or p_reopen_count < 0 or p_reopen_count > 1000000 then
    raise exception 'Reopen 数必须是 0～1000000 的整数';
  end if;
  if p_blocked and p_pass then raise exception '主流程阻断时测试结论不能为通过'; end if;
  if not p_pass and (p_note is null or length(trim(p_note)) = 0) then
    raise exception '测试不通过必须填写原因';
  end if;
  if v_url is not null and v_url !~* '^https?://[^[:space:]]+$' then
    raise exception '禅道链接必须以 http:// 或 https:// 开头';
  end if;

  select * into v_round from public.test_rounds
  where test_task_id = p_test_task_id for update;

  -- 兼容升级前已处于进行中的测试任务：在结论时选择测试方式并补建汇总。
  if not found then
    v_method := trim(coalesce(p_test_method, ''));
    if v_method not in ('case_based', 'exploratory') then raise exception '请选择本轮测试方式'; end if;
    if v_method = 'case_based' and (
      p_planned_case_count is null or p_planned_case_count <= 0 or p_planned_case_count > 1000000
    ) then
      raise exception '标准用例测试的计划用例数必须是 1～1000000 的整数';
    end if;
    if v_method = 'exploratory' and (v_scope is null or v_reason is null) then
      raise exception '快速 / 探索性验证必须填写验证范围和采用原因';
    end if;
    if length(coalesce(v_scope, '')) > 2000 or length(coalesce(v_reason, '')) > 2000 then
      raise exception '验证范围和采用原因不能超过 2000 个字符';
    end if;

    select coalesce(max(tr.round_no), 0) + 1 into v_round_no
    from public.test_rounds tr
    join public.tasks tt on tt.id = tr.test_task_id
    where tt.linked_task_id is not distinct from v_test.linked_task_id;

    insert into public.test_rounds (
      test_task_id, round_no, test_method, result, blocked,
      planned_case_count, executed_case_count,
      verification_scope, verification_reason,
      bug_count, reopen_count, note,
      started_at, concluded_at, concluded_by, zentao_url
    ) values (
      p_test_task_id, v_round_no, v_method, null, false,
      case when v_method = 'case_based' then p_planned_case_count else null end,
      null,
      case when v_method = 'exploratory' then v_scope else null end,
      case when v_method = 'exploratory' then v_reason else null end,
      0, 0, null,
      coalesce(v_test.updated_at, now()), null, null, v_url
    ) returning * into v_round;
  end if;

  if v_round.result is not null then raise exception '该测试任务已经提交过结论'; end if;
  v_method := coalesce(v_round.test_method, 'case_based');

  if v_method = 'case_based' then
    if coalesce(p_planned_case_count, v_round.planned_case_count) is null
      or coalesce(p_planned_case_count, v_round.planned_case_count) <= 0 then
      raise exception '请补充计划用例数后再提交结论';
    end if;
    if p_executed_case_count is null or p_executed_case_count < 0 or p_executed_case_count > 1000000 then
      raise exception '实际执行用例数必须是 0～1000000 的整数';
    end if;
  elsif p_executed_case_count is not null then
    raise exception '快速 / 探索性验证不记录用例数量';
  end if;

  update public.test_rounds
  set result = case when p_pass then 'pass' else 'fail' end,
      planned_case_count = case when v_method = 'case_based'
        then coalesce(p_planned_case_count, planned_case_count) else null end,
      executed_case_count = case when v_method = 'case_based'
        then p_executed_case_count else null end,
      bug_count = p_bug_count,
      reopen_count = p_reopen_count,
      blocked = p_blocked,
      note = p_note,
      concluded_by = v_actor,
      concluded_at = now(),
      zentao_url = coalesce(v_url, zentao_url)
  where test_task_id = p_test_task_id;

  update public.tasks
  set status = 'done', test_result = case when p_pass then 'pass' else 'fail' end,
      test_note = p_note, submitted_at = now(), completed_at = now()
  where id = p_test_task_id;

  if v_test.linked_task_id is not null then
    if p_pass then
      update public.tasks set status = 'review'
      where id = v_test.linked_task_id and status = 'testing';
      perform public.notify(
        (select developer_id from public.tasks where id = v_test.linked_task_id),
        'test_passed', jsonb_build_object('task_id', v_test.linked_task_id, 'title', v_test.title));
    else
      update public.tasks set status = 'in_progress', reject_note = p_note
      where id = v_test.linked_task_id and status = 'testing';
      perform public.notify(
        (select developer_id from public.tasks where id = v_test.linked_task_id),
        'test_failed', jsonb_build_object('task_id', v_test.linked_task_id, 'title', v_test.title, 'reason', p_note));
    end if;
  end if;
end;
$$;
