-- =============================================================
-- 0003_triggers_seed.sql  业务规则触发器 / 注册建档 / 通知 / 种子管理员
-- =============================================================

-- ---------- 注册后自动建档：profiles + user_roles + developers ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  insert into public.user_roles(user_id, role) values (new.id, 'user') on conflict do nothing;
  insert into public.developers(user_id, name, position)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'position'
  ) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 任务状态机 + 审批权限强制（RLS 之上的业务规则）----------
create or replace function public.enforce_task_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_dev uuid := public.current_developer_id();
begin
  -- 1) 离开 review（审批通过 或 驳回）：必须有审批权限
  if old.status = 'review' and new.status <> 'review' then
    if not public.can_approve_task(old.id) then
      raise exception '无审批权限：仅该项目所属小组组长或管理员可审批';
    end if;

    if new.status in ('done', 'delayed_done') then
      -- v2.3：完成时间 = 最近一次提交审核的时间（工作实际完成时刻），
      -- 延期判定也按提交时间算，避免审批延迟造成误判延期
      new.completed_at := coalesce(old.submitted_at, now());
      if new.due_date is not null and new.completed_at::date > new.due_date then
        new.status := 'delayed_done';
      else
        new.status := 'done';
      end if;
      new.approved_by_role := public.auth_role();
      new.approved_by_user := actor_dev;
      new.reject_note := null;

    elsif new.status = 'in_progress' then
      -- 驳回：必须填写原因
      if new.reject_note is null or length(trim(new.reject_note)) = 0 then
        raise exception '驳回任务必须填写驳回原因';
      end if;
      new.completed_at := null;
      new.approved_by_role := null;
      new.approved_by_user := null;
    end if;

    return new;
  end if;

  -- 2) 进入 review（提交审核）：记录提交时间；若已超期需填写延期备注
  --    v2.5：从 testing 进入 review（测试通过自动流转）保留提测时的 submitted_at
  if old.status <> 'review' and new.status = 'review' then
    if old.task_type = 'test' then
      raise exception '测试任务以"测试通过/不通过"结论结束，不走提审';
    end if;
    if old.status <> 'testing' then
      new.submitted_at := now();
      if new.due_date is not null and now()::date > new.due_date
         and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
        raise exception '任务已超期，提交审核前需填写延期备注';
      end if;
    end if;
    return new;
  end if;

  -- 2.5) 提测（v2.5）：submitted_at = 提测时刻（工作完成时刻）；超期同样需延期备注
  if old.status <> 'testing' and new.status = 'testing' then
    if old.task_type = 'test' then
      raise exception '测试任务不能再次提测';
    end if;
    if old.status <> 'in_progress' then
      raise exception '只有进行中的任务可以提测';
    end if;
    new.submitted_at := now();
    if new.due_date is not null and now()::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，提测前需填写延期备注';
    end if;
    return new;
  end if;

  -- 2.6) 测试中锁定（v2.5）：testing 只能流向 review（测试通过）或 in_progress（测试不通过打回）
  if old.status = 'testing' and new.status not in ('testing', 'review', 'in_progress') then
    raise exception '测试中的任务需等待测试结论';
  end if;

  -- 3) review 期间锁定：非管理员/非审批人不得修改
  if old.status = 'review' and new.status = 'review' then
    if not (public.is_admin() or public.can_approve_task(old.id)) then
      raise exception '任务审核中，负责人不可修改';
    end if;
  end if;

  -- 4) 挂起流转约束（v2.4）：paused 只能与 in_progress 互转
  if new.status = 'paused' and old.status <> 'paused' and old.status <> 'in_progress' then
    raise exception '只有进行中的任务可以挂起';
  end if;
  if old.status = 'paused' and new.status not in ('paused', 'in_progress') then
    raise exception '挂起的任务需先恢复为进行中';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_rules on public.tasks;
create trigger trg_tasks_rules before update on public.tasks
  for each row execute function public.enforce_task_rules();

-- ---------- 实际工时段维护（v2.4）----------
-- 进入 in_progress 开一段；离开 in_progress（挂起/提审）闭合未结束的段
create or replace function public.track_work_segments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'in_progress' and new.status = 'in_progress' then
    insert into public.task_work_segments(task_id, developer_id, started_at)
    values (new.id, new.developer_id, now());
  end if;
  if old.status = 'in_progress' and new.status <> 'in_progress' then
    update public.task_work_segments
    set ended_at = now()
    where task_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tasks_work_segments on public.tasks;
create trigger trg_tasks_work_segments after update on public.tasks
  for each row execute function public.track_work_segments();

-- ---------- 测试流程 RPC（v2.5）----------
-- 提测：开发任务转入测试中，并自动创建关联的测试任务
create or replace function public.submit_for_testing(
  p_task_id uuid, p_tester_id uuid, p_start date, p_due date,
  p_note text default null, p_delay_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_actor uuid := public.current_developer_id();
  v_test_id uuid;
  v_tester_pos text;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception '任务不存在'; end if;
  if v_task.task_type <> 'dev' then raise exception '测试任务不能再次提测'; end if;
  if v_task.status <> 'in_progress' then raise exception '只有进行中的任务可以提测'; end if;
  if not (public.is_admin() or public.is_manager() or v_task.developer_id = v_actor) then
    raise exception '仅任务负责人或管理者可提测';
  end if;
  select position into v_tester_pos from public.developers where id = p_tester_id and is_active;
  if v_tester_pos is distinct from '测试工程师' then
    raise exception '测试负责人必须是职位为「测试工程师」的在职人员';
  end if;
  if p_start is null or p_due is null or p_due < p_start then
    raise exception '请填写有效的测试开始/截止日期';
  end if;

  -- 转入测试中（触发器负责 submitted_at / 超期延期备注校验 / 工时段闭合）
  update public.tasks
  set status = 'testing', delay_note = coalesce(p_delay_note, delay_note)
  where id = p_task_id;

  -- 创建关联测试任务（继承项目/小组/优先级）
  insert into public.tasks (title, description, status, priority, task_type, linked_task_id,
                            project_id, developer_id, team_id, start_date, due_date, created_by)
  values ('【测试】' || v_task.title, p_note, 'todo', v_task.priority, 'test', v_task.id,
          v_task.project_id, p_tester_id, v_task.team_id, p_start, p_due, v_actor)
  returning id into v_test_id;

  perform public.notify(p_tester_id, 'test_assigned',
    jsonb_build_object('task_id', v_test_id, 'title', v_task.title));
  return v_test_id;
end;
$$;

-- 测试结论：测试任务完成（通过/不通过），联动开发任务流转
create or replace function public.conclude_test(
  p_test_task_id uuid, p_pass boolean, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_test public.tasks%rowtype;
  v_actor uuid := public.current_developer_id();
begin
  select * into v_test from public.tasks where id = p_test_task_id;
  if not found then raise exception '测试任务不存在'; end if;
  if v_test.task_type <> 'test' then raise exception '该任务不是测试任务'; end if;
  if v_test.status <> 'in_progress' then raise exception '请先开始测试任务再给出结论'; end if;
  if not (public.is_admin() or public.is_manager() or v_test.developer_id = v_actor) then
    raise exception '仅测试负责人或管理者可给出测试结论';
  end if;
  if not p_pass and (p_note is null or length(trim(p_note)) = 0) then
    raise exception '测试不通过必须填写原因';
  end if;

  -- 测试任务完成（结论即交付，不走审批）；工时段由触发器闭合
  update public.tasks
  set status = 'done', test_result = case when p_pass then 'pass' else 'fail' end,
      test_note = p_note, submitted_at = now(), completed_at = now()
  where id = p_test_task_id;

  -- 联动开发任务
  if v_test.linked_task_id is not null then
    if p_pass then
      update public.tasks set status = 'review' where id = v_test.linked_task_id and status = 'testing';
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

-- ---------- 通知写入辅助 ----------
create or replace function public.notify(p_recipient uuid, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null then return; end if;
  insert into public.notifications(recipient_id, type, payload)
  values (p_recipient, p_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- 任务创建：通知被指派的负责人
create or replace function public.notify_task_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.developer_id is not null and new.developer_id is distinct from new.created_by then
    perform public.notify(new.developer_id, 'task_assigned',
      jsonb_build_object('task_id', new.id, 'title', new.title));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tasks_notify_insert on public.tasks;
create trigger trg_tasks_notify_insert after insert on public.tasks
  for each row execute function public.notify_task_insert();

-- 任务状态变化：提交审核/审批通过/驳回 的通知
create or replace function public.notify_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  leader uuid;
  admin_dev record;
begin
  if old.status <> 'review' and new.status = 'review' then
    -- 审批人 = 项目负责人，未指定则回退到所属组组长（v2 §5.2）
    select coalesce(p.owner_id, tm.leader_id) into leader
    from public.projects p left join public.teams tm on tm.id = p.team_id
    where p.id = new.project_id;
    perform public.notify(leader, 'task_submitted',
      jsonb_build_object('task_id', new.id, 'title', new.title));
    for admin_dev in
      select d.id from public.developers d
      join public.user_roles ur on ur.user_id = d.user_id
      where ur.role = 'admin' and d.id is distinct from leader
    loop
      perform public.notify(admin_dev.id, 'task_submitted',
        jsonb_build_object('task_id', new.id, 'title', new.title));
    end loop;
  end if;

  if old.status = 'review' and new.status in ('done', 'delayed_done') then
    perform public.notify(new.developer_id, 'task_approved',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'result', new.status));
  end if;

  if old.status = 'review' and new.status = 'in_progress' then
    perform public.notify(new.developer_id, 'task_rejected',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'reason', new.reject_note));
  end if;

  return new;
end;
$$;
drop trigger if exists trg_tasks_notify_update on public.tasks;
create trigger trg_tasks_notify_update after update on public.tasks
  for each row execute function public.notify_task_update();

-- 新评论：通知任务负责人
create or replace function public.notify_comment_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_dev uuid;
begin
  select developer_id into owner_dev from public.tasks where id = new.task_id;
  if owner_dev is not null and owner_dev is distinct from new.author_id then
    perform public.notify(owner_dev, 'task_comment',
      jsonb_build_object('task_id', new.task_id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_comment_notify on public.task_comments;
create trigger trg_comment_notify after insert on public.task_comments
  for each row execute function public.notify_comment_insert();

-- =============================================================
-- 种子管理员（D2）
-- Supabase 的账号由 Auth(GoTrue) 管理，无法纯 SQL 创建登录用户。
-- 冷启动步骤：
--   1. 用目标邮箱在应用「注册」页正常注册并完成邮箱验证；
--   2. 回到 Supabase SQL Editor，执行下面这条把它提升为 admin：
--
--   update public.user_roles set role = 'admin'
--   where user_id = (select id from auth.users where email = 'admin@yourco.com');
--
-- 之后该 admin 即可在「权限管理」页提升其他用户。
-- =============================================================
