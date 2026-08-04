-- =============================================================
-- 0006_project_acceptance.sql  项目轻量验收（v2.12，D7/D8/D9）
-- 部门经理/小组负责人不自动验收；验收人优先，其次项目负责人，admin 异常兜底。
-- =============================================================

alter table public.projects
  add column acceptance_mode text not null default 'deliverable_only',
  add column acceptance_owner_id uuid references public.developers(id) on delete set null;

alter table public.projects
  add constraint projects_acceptance_mode_valid
  check (acceptance_mode in ('none', 'deliverable_only', 'all_tasks'));

create index idx_projects_acceptance_owner on public.projects(acceptance_owner_id);

alter table public.tasks
  add column requires_acceptance boolean not null default false;

-- 项目验收人可能是普通 user，验收审计不能继续限制为 admin/manager。
alter table public.tasks drop constraint if exists tasks_approved_by_role_check;
alter table public.tasks
  add constraint tasks_approved_by_role_check
  check (approved_by_role in ('admin', 'manager', 'user'));

-- 项目最终验收人：指定验收人优先，否则项目负责人。组长/部门经理不参与兜底。
create or replace function public.project_acceptance_owner(p_project_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(p.acceptance_owner_id, p.owner_id)
  from public.projects p where p.id = p_project_id;
$$;

create or replace function public.project_requires_acceptance(
  p_project_id uuid,
  p_task_flag boolean
) returns boolean language sql stable security definer set search_path = public as $$
  select case coalesce(p.acceptance_mode, 'deliverable_only')
    when 'none' then false
    when 'all_tasks' then true
    else coalesce(p_task_flag, false)
  end
  from public.projects p where p.id = p_project_id;
$$;

create or replace function public.task_requires_acceptance(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.project_requires_acceptance(t.project_id, t.requires_acceptance), false)
  from public.tasks t where t.id = p_task_id;
$$;

-- 可调整“验收项”标记：项目负责人、项目验收人、协作管理员(manager)、admin。
create or replace function public.can_manage_task_acceptance(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_manager() or exists (
    select 1 from public.tasks t
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id
      and public.current_developer_id() in (p.owner_id, p.acceptance_owner_id)
  );
$$;

create or replace function public.can_manage_project_acceptance(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_manager() or exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and public.current_developer_id() in (p.owner_id, p.acceptance_owner_id)
  );
$$;

-- 真正验收权限：指定验收人；未指定时项目负责人；admin 仅异常兜底。
create or replace function public.can_accept_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.tasks t
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id
      and public.current_developer_id() = coalesce(p.acceptance_owner_id, p.owner_id)
  );
$$;

-- 保留旧函数名供既有触发器/客户端兼容，但语义改为验收权限。
create or replace function public.can_approve_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_accept_task(p_task_id);
$$;

-- 验收字段的列级保护。验收人/项目负责人不是任务负责人时，只能改该标记。
create or replace function public.guard_task_acceptance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_dev uuid := public.current_developer_id();
begin
  if new.task_type = 'test' and new.requires_acceptance then
    raise exception '测试任务本身不设置验收项，验收规则作用于关联开发任务';
  end if;

  if tg_op = 'INSERT' then
    if new.requires_acceptance and not public.can_manage_project_acceptance(new.project_id) then
      raise exception '仅项目负责人、项目验收人、协作管理员或管理员可设置验收项';
    end if;
    return new;
  end if;

  if new.requires_acceptance is distinct from old.requires_acceptance then
    if old.status not in ('todo', 'in_progress', 'paused') then
      raise exception '任务进入测试、验收或完成后不能修改验收属性';
    end if;
    if not public.can_manage_task_acceptance(old.id) then
      raise exception '无权修改任务验收属性';
    end if;
  end if;

  -- 非任务负责人通过验收管理权限更新时，禁止借机修改其他任务字段。
  if not (public.is_admin() or public.is_manager() or old.developer_id = actor_dev)
     and public.can_manage_task_acceptance(old.id)
     and (to_jsonb(new) - 'requires_acceptance' - 'updated_at')
         is distinct from (to_jsonb(old) - 'requires_acceptance' - 'updated_at') then
    raise exception '项目负责人或验收人只能修改任务的验收属性';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_acceptance_guard on public.tasks;
create trigger trg_tasks_acceptance_guard
  before insert or update on public.tasks
  for each row execute function public.guard_task_acceptance();

-- 允许项目负责人/验收人触达任务行；列级边界由 guard_task_acceptance 强制。
drop policy if exists task_update on public.tasks;
create policy task_update on public.tasks for update to authenticated
  using (
    public.is_admin() or public.is_manager()
    or developer_id = public.current_developer_id()
    or public.can_manage_task_acceptance(id)
  )
  with check (
    public.is_admin() or public.is_manager()
    or developer_id = public.current_developer_id()
    or public.can_manage_task_acceptance(id)
  );

-- 单字段 RPC，供项目负责人/验收人在不拥有整条任务编辑权时使用。
create or replace function public.set_task_acceptance(
  p_task_id uuid,
  p_requires_acceptance boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tasks where id = p_task_id) then
    raise exception '任务不存在';
  end if;
  if not public.can_manage_task_acceptance(p_task_id) then
    raise exception '无权修改任务验收属性';
  end if;
  update public.tasks
  set requires_acceptance = coalesce(p_requires_acceptance, false)
  where id = p_task_id;
end;
$$;

-- 任务状态机：同一个“完成”动作按项目策略规范化为直接完成或进入 review。
create or replace function public.enforce_task_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_dev uuid := public.current_developer_id();
  needs_acceptance boolean;
  completion_time timestamptz;
begin
  -- 1) 历史/新任务离开 review：不重算是否应验收，保证历史 review 可继续处理。
  if old.status = 'review' and new.status <> 'review' then
    if not public.can_accept_task(old.id) then
      raise exception '无验收权限：仅项目验收人、项目负责人或管理员可操作';
    end if;

    if new.status in ('done', 'delayed_done') then
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
      if new.reject_note is null or length(trim(new.reject_note)) = 0 then
        raise exception '驳回任务必须填写驳回原因';
      end if;
      new.completed_at := null;
      new.approved_by_role := null;
      new.approved_by_user := null;
    else
      raise exception '验收中的任务只能通过完成或驳回到进行中';
    end if;
    return new;
  end if;

  -- 2) 开发任务发起完成：普通完成与“提交审核”都由项目策略统一决策。
  if old.task_type = 'dev'
     and old.status = 'in_progress'
     and new.status in ('review', 'done', 'delayed_done') then
    completion_time := now();
    if new.due_date is not null and completion_time::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，完成前需填写延期原因';
    end if;
    new.submitted_at := completion_time;
    needs_acceptance := coalesce(public.project_requires_acceptance(old.project_id, old.requires_acceptance), false);
    if needs_acceptance then
      new.status := 'review';
      new.completed_at := null;
      new.approved_by_role := null;
      new.approved_by_user := null;
    else
      new.completed_at := completion_time;
      new.status := case when new.due_date is not null and completion_time::date > new.due_date
        then 'delayed_done' else 'done' end;
      new.approved_by_role := null;
      new.approved_by_user := null;
      new.reject_note := null;
    end if;
    return new;
  end if;

  -- 3) 测试通过后的开发任务：按提测时刻完成，非验收项直接完成。
  if old.task_type = 'dev'
     and old.status = 'testing'
     and new.status in ('review', 'done', 'delayed_done') then
    needs_acceptance := coalesce(public.project_requires_acceptance(old.project_id, old.requires_acceptance), false);
    if needs_acceptance then
      new.status := 'review';
      new.completed_at := null;
    else
      completion_time := coalesce(old.submitted_at, now());
      new.completed_at := completion_time;
      new.status := case when new.due_date is not null and completion_time::date > new.due_date
        then 'delayed_done' else 'done' end;
      new.approved_by_role := null;
      new.approved_by_user := null;
      new.reject_note := null;
    end if;
    return new;
  end if;

  -- 4) 其他进入 review 的兼容路径。
  if old.status <> 'review' and new.status = 'review' then
    if old.task_type = 'test' then
      raise exception '测试任务以测试结论结束，不走验收';
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
    if new.due_date is not null and new.submitted_at::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，完成前需填写延期原因';
    end if;
    return new;
  end if;

  -- 5) 提测：保持现有质量流程。
  if old.status <> 'testing' and new.status = 'testing' then
    if old.task_type = 'test' then raise exception '测试任务不能再次提测'; end if;
    if old.status <> 'in_progress' then raise exception '只有进行中的任务可以提测'; end if;
    new.submitted_at := now();
    if new.due_date is not null and now()::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，提测前需填写延期备注';
    end if;
    return new;
  end if;

  if old.status = 'testing' and new.status not in ('testing', 'review', 'done', 'delayed_done', 'in_progress') then
    raise exception '测试中的任务需等待测试结论';
  end if;

  if old.status = 'review' and new.status = 'review' and not public.can_accept_task(old.id) then
    raise exception '任务验收中，仅验收人可修改';
  end if;

  if new.status = 'paused' and old.status not in ('paused', 'in_progress') then
    raise exception '只有进行中的任务可以挂起';
  end if;
  if old.status = 'paused' and new.status not in ('paused', 'in_progress') then
    raise exception '挂起的任务需先恢复为进行中';
  end if;
  return new;
end;
$$;

-- 通知只发给真实验收人；无可解析验收人时才通知 admin 异常兜底。
create or replace function public.notify_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  approver uuid;
  project_owner uuid;
  admin_dev record;
begin
  if old.status <> 'review' and new.status = 'review' then
    select coalesce(p.acceptance_owner_id, p.owner_id) into approver
    from public.projects p where p.id = new.project_id;
    if approver is not null then
      perform public.notify(approver, 'task_submitted',
        jsonb_build_object('task_id', new.id, 'title', new.title));
    else
      for admin_dev in
        select d.id from public.developers d
        join public.user_roles ur on ur.user_id = d.user_id
        where ur.role = 'admin'
      loop
        perform public.notify(admin_dev.id, 'task_acceptance_unassigned',
          jsonb_build_object('task_id', new.id, 'title', new.title));
      end loop;
    end if;
  end if;

  if old.status = 'review' and new.status in ('done', 'delayed_done') then
    perform public.notify(new.developer_id, 'task_approved',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'result', new.status));
  end if;

  if old.status = 'review' and new.status = 'in_progress' then
    perform public.notify(new.developer_id, 'task_rejected',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'reason', new.reject_note));
  end if;

  if old.status <> 'delayed_done' and new.status = 'delayed_done' and old.status <> 'review' then
    select p.owner_id into project_owner from public.projects p where p.id = new.project_id;
    perform public.notify(project_owner, 'task_delayed_completed',
      jsonb_build_object('task_id', new.id, 'title', new.title, 'reason', new.delay_note));
  end if;
  return new;
end;
$$;
