-- =============================================================
-- 0004_test_metrics.sql  禅道测试汇总 / 测试轮次落地（v2.9）
-- 禅道保留用例和 Bug 明细，本系统只保存每轮结构化汇总。
-- =============================================================

-- ---------- test_rounds 渐进升级 ----------
alter table public.test_rounds rename column case_total to executed_case_count;

alter table public.test_rounds
  add column planned_case_count int,
  add column zentao_url text,
  add column started_at timestamptz;

-- 轮次在开始测试时先创建草稿，结论与结论时间稍后写入。
alter table public.test_rounds alter column result drop not null;
alter table public.test_rounds alter column concluded_at drop not null;
alter table public.test_rounds alter column concluded_at drop default;

alter table public.test_rounds
  add constraint test_rounds_round_no_positive check (round_no > 0),
  add constraint test_rounds_planned_range check (planned_case_count is null or planned_case_count between 0 and 1000000),
  add constraint test_rounds_executed_range check (executed_case_count is null or executed_case_count between 0 and 1000000),
  add constraint test_rounds_bug_range check (bug_count between 0 and 1000000),
  add constraint test_rounds_reopen_range check (reopen_count between 0 and 1000000),
  add constraint test_rounds_zentao_url_http check (
    zentao_url is null or zentao_url ~* '^https?://[^[:space:]]+$'
  );

create unique index idx_test_rounds_test_task_unique on public.test_rounds(test_task_id);

-- 所有登录用户可读；不创建客户端写策略，写入只允许经 security definer RPC。
alter table public.test_rounds enable row level security;
create policy test_rounds_select on public.test_rounds
  for select to authenticated using (true);

-- ---------- 开始测试：原子创建轮次草稿 + 开始任务 ----------
create or replace function public.start_test_task(
  p_test_task_id uuid,
  p_planned_case_count int,
  p_zentao_url text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_test public.tasks%rowtype;
  v_actor uuid := public.current_developer_id();
  v_round_no int;
  v_round_id uuid;
  v_url text := nullif(trim(p_zentao_url), '');
begin
  select * into v_test from public.tasks where id = p_test_task_id for update;
  if not found then raise exception '测试任务不存在'; end if;
  if v_test.task_type <> 'test' then raise exception '该任务不是测试任务'; end if;
  if v_test.status <> 'todo' then raise exception '只有待处理的测试任务可以开始测试'; end if;
  if not (public.is_admin() or public.is_manager() or v_test.developer_id = v_actor) then
    raise exception '仅测试负责人或管理者可开始测试';
  end if;
  if p_planned_case_count is null or p_planned_case_count < 0 or p_planned_case_count > 1000000 then
    raise exception '计划用例数必须是 0～1000000 的整数';
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
    test_task_id, round_no, result, blocked, planned_case_count,
    executed_case_count, bug_count, reopen_count, note,
    started_at, concluded_at, concluded_by, zentao_url
  ) values (
    p_test_task_id, v_round_no, null, false, p_planned_case_count,
    null, 0, 0, null,
    now(), null, null, v_url
  ) returning id into v_round_id;

  -- 状态更新触发现有工时段逻辑。
  update public.tasks set status = 'in_progress' where id = p_test_task_id;
  return v_round_id;
end;
$$;

-- 删除旧签名，使用带默认参数的新签名保持旧客户端的三参数调用可解析。
drop function if exists public.conclude_test(uuid, boolean, text);

-- ---------- 测试结论：保存汇总 + 完成测试 + 联动开发任务 ----------
create function public.conclude_test(
  p_test_task_id uuid,
  p_pass boolean,
  p_note text default null,
  p_planned_case_count int default null,
  p_executed_case_count int default null,
  p_bug_count int default null,
  p_reopen_count int default 0,
  p_blocked boolean default false,
  p_zentao_url text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_test public.tasks%rowtype;
  v_actor uuid := public.current_developer_id();
  v_round public.test_rounds%rowtype;
  v_round_no int;
  v_url text := nullif(trim(p_zentao_url), '');
begin
  select * into v_test from public.tasks where id = p_test_task_id for update;
  if not found then raise exception '测试任务不存在'; end if;
  if v_test.task_type <> 'test' then raise exception '该任务不是测试任务'; end if;
  if v_test.status <> 'in_progress' then raise exception '请先开始测试任务再给出结论'; end if;
  if not (public.is_admin() or public.is_manager() or v_test.developer_id = v_actor) then
    raise exception '仅测试负责人或管理者可给出测试结论';
  end if;
  if p_executed_case_count is null or p_executed_case_count < 0 or p_executed_case_count > 1000000 then
    raise exception '实际执行用例数必须是 0～1000000 的整数';
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

  -- 兼容升级前已经进入进行中的测试任务：结论时补建轮次草稿。
  if not found then
    if p_planned_case_count is null or p_planned_case_count < 0 or p_planned_case_count > 1000000 then
      raise exception '历史测试任务缺少计划用例数，请补充后再提交结论';
    end if;
    select coalesce(max(tr.round_no), 0) + 1 into v_round_no
    from public.test_rounds tr
    join public.tasks tt on tt.id = tr.test_task_id
    where tt.linked_task_id is not distinct from v_test.linked_task_id;

    insert into public.test_rounds (
      test_task_id, round_no, result, blocked, planned_case_count,
      executed_case_count, bug_count, reopen_count, note,
      started_at, concluded_at, concluded_by, zentao_url
    ) values (
      p_test_task_id, v_round_no, null, false, p_planned_case_count,
      null, 0, 0, null,
      coalesce(v_test.updated_at, now()), null, null, v_url
    ) returning * into v_round;
  end if;

  if v_round.result is not null then raise exception '该测试任务已经提交过结论'; end if;
  if v_round.planned_case_count is null and p_planned_case_count is null then
    raise exception '请补充计划用例数后再提交结论';
  end if;

  update public.test_rounds
  set result = case when p_pass then 'pass' else 'fail' end,
      planned_case_count = coalesce(p_planned_case_count, planned_case_count),
      executed_case_count = p_executed_case_count,
      bug_count = p_bug_count,
      reopen_count = p_reopen_count,
      blocked = p_blocked,
      note = p_note,
      concluded_by = v_actor,
      concluded_at = now(),
      zentao_url = coalesce(v_url, zentao_url)
  where test_task_id = p_test_task_id;

  -- 测试任务完成（结论即交付，不走审批）；工时段由现有触发器闭合。
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
