-- =============================================================
-- 0007_project_task_approval.sql  项目任务审批（v2.13，D7-D10）
-- 所有项目开发任务完成前进入 review；审批权只来自 projects.owner_id。
-- 0006 的 acceptance_* / requires_acceptance 列仅保留历史数据，不再参与业务判断。
-- =============================================================

comment on column public.projects.acceptance_mode is
  'v2.12 历史兼容列；v2.13 起停用，不得用于状态流转或权限判断';
comment on column public.projects.acceptance_owner_id is
  'v2.12 历史兼容列；v2.13 起停用，审批人只取 projects.owner_id';
comment on column public.tasks.requires_acceptance is
  'v2.12 历史兼容列；v2.13 起停用，所有项目开发任务均需审批';

-- 每次通过/驳回独立留痕；负责人变更不回写历史快照。
create table public.task_approval_audits (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  project_owner_id uuid references public.developers(id) on delete set null,
  project_owner_name text,
  actor_id uuid references public.developers(id) on delete set null,
  actor_name text not null,
  actor_role varchar(50) not null check (actor_role in ('admin', 'manager', 'user')),
  decision varchar(20) not null check (decision in ('approved', 'rejected')),
  from_status varchar(50) not null default 'review',
  to_status varchar(50) not null check (to_status in ('in_progress', 'done', 'delayed_done')),
  is_admin_proxy boolean not null default false,
  admin_proxy_reason text,
  decision_note text,
  submitted_at_snapshot timestamptz,
  completed_at_snapshot timestamptz,
  created_at timestamptz not null default now(),
  constraint task_approval_admin_reason_required check (
    (not is_admin_proxy and admin_proxy_reason is null)
    or (is_admin_proxy and length(trim(admin_proxy_reason)) > 0)
  )
);

create index idx_task_approval_audits_task_created
  on public.task_approval_audits(task_id, created_at desc);

alter table public.task_approval_audits enable row level security;
alter table public.task_approval_audits force row level security;
create policy task_approval_audits_select on public.task_approval_audits
  for select to authenticated using (true);
grant select on public.task_approval_audits to authenticated;
revoke insert, update, delete on public.task_approval_audits from authenticated;

-- 普通审批权限唯一来源：当前项目负责人。admin 若同时是负责人，按负责人身份正常审批。
create or replace function public.can_approve_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.tasks t
    join public.projects p on p.id = t.project_id
    join public.developers d on d.id = p.owner_id and d.is_active
    where t.id = p_task_id
      and t.task_type = 'dev'
      and p.owner_id is not null
      and public.current_developer_id() = p.owner_id
  );
$$;

-- v2.12 验收入口退出运行态；历史列保留，旧客户端不能继续修改它们。
drop trigger if exists trg_tasks_acceptance_guard on public.tasks;

-- 任务策略：项目开发任务统一 review；无项目开发任务直接完成；测试任务以结论直接完成。
create or replace function public.enforce_task_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_dev uuid := public.current_developer_id();
  completion_time timestamptz;
  owner_dev uuid;
  is_admin_proxy boolean := public.is_admin()
    and coalesce(current_setting('app.admin_approval_proxy', true), '') = 'on';
  admin_proxy_reason text := nullif(trim(coalesce(
    current_setting('app.admin_approval_reason', true), ''
  )), '');
begin
  -- 1) 离开 review：历史 review 保持原状态并继续按当前项目负责人处理。
  if old.status = 'review' and new.status <> 'review' then
    select p.owner_id into owner_dev from public.projects p where p.id = old.project_id;

    if old.project_id is not null and owner_dev is null then
      raise exception '项目缺少负责人，请先在项目管理中补充负责人后再审批';
    end if;
    if not public.can_approve_task(old.id) and not is_admin_proxy then
      raise exception '无审批权限：仅当前项目负责人可以审批；管理员请使用异常代办入口';
    end if;
    if is_admin_proxy and admin_proxy_reason is null then
      raise exception '管理员异常代办必须填写代办原因';
    end if;

    if new.status in ('done', 'delayed_done') then
      completion_time := coalesce(old.submitted_at, now());
      new.completed_at := completion_time;
      new.status := case
        when new.due_date is not null and completion_time::date > new.due_date then 'delayed_done'
        else 'done'
      end;
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
      raise exception '审核中的任务只能审批完成或驳回到进行中';
    end if;
    return new;
  end if;

  -- 2) 开发任务提交完成：项目任务强制 review；无项目任务直接完成。
  if old.task_type = 'dev'
     and old.status = 'in_progress'
     and new.status in ('review', 'done', 'delayed_done') then
    completion_time := now();
    if new.due_date is not null and completion_time::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，提交审核前需填写延期原因';
    end if;
    new.submitted_at := completion_time;
    new.approved_by_role := null;
    new.approved_by_user := null;
    new.reject_note := null;

    if old.project_id is not null then
      select p.owner_id into owner_dev from public.projects p where p.id = old.project_id;
      if owner_dev is null then
        raise exception '项目缺少负责人，请先在项目管理中补充负责人后再提交审核';
      end if;
      new.status := 'review';
      new.completed_at := null;
    else
      new.completed_at := completion_time;
      new.status := case
        when new.due_date is not null and completion_time::date > new.due_date then 'delayed_done'
        else 'done'
      end;
    end if;
    return new;
  end if;

  -- 3) 测试通过后的开发任务：项目任务一律 review；无项目任务直接完成。
  if old.task_type = 'dev'
     and old.status = 'testing'
     and new.status in ('review', 'done', 'delayed_done') then
    if old.project_id is not null then
      select p.owner_id into owner_dev from public.projects p where p.id = old.project_id;
      if owner_dev is null then
        raise exception '项目缺少负责人，请先补充负责人后再提交测试结论';
      end if;
      new.status := 'review';
      new.completed_at := null;
      new.approved_by_role := null;
      new.approved_by_user := null;
    else
      completion_time := coalesce(old.submitted_at, now());
      new.completed_at := completion_time;
      new.status := case
        when new.due_date is not null and completion_time::date > new.due_date then 'delayed_done'
        else 'done'
      end;
      new.approved_by_role := null;
      new.approved_by_user := null;
      new.reject_note := null;
    end if;
    return new;
  end if;

  -- 4) 其他兼容入口进入 review 时仍校验项目负责人；测试任务不走审批。
  if old.status <> 'review' and new.status = 'review' then
    if old.task_type = 'test' then
      raise exception '测试任务以测试结论结束，不走项目审批';
    end if;
    if old.project_id is null then
      raise exception '无项目任务不进入项目审批，应由负责人直接完成';
    end if;
    select p.owner_id into owner_dev from public.projects p where p.id = old.project_id;
    if owner_dev is null then
      raise exception '项目缺少负责人，请先在项目管理中补充负责人后再提交审核';
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
    if new.due_date is not null and new.submitted_at::date > new.due_date
       and (new.delay_note is null or length(trim(new.delay_note)) = 0) then
      raise exception '任务已超期，提交审核前需填写延期原因';
    end if;
    return new;
  end if;

  -- 5) 提测与锁定规则保持不变。
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

  if old.status = 'review' and new.status = 'review'
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception '任务审核中已锁定，只能执行审批通过或驳回';
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

-- 允许任务负责人维护自己的在办任务、manager/admin 做日常管理、项目负责人审批。
-- admin/manager 对 review 的越权操作仍会被 enforce_task_rules 拒绝。
drop policy if exists task_update on public.tasks;
create policy task_update on public.tasks for update to authenticated
  using (
    public.is_admin() or public.is_manager()
    or developer_id = public.current_developer_id()
    or (status = 'review' and public.can_approve_task(id))
  )
  with check (
    public.is_admin() or public.is_manager()
    or developer_id = public.current_developer_id()
    or public.can_approve_task(id)
  );

-- admin 异常代办的唯一入口。项目存在但缺少负责人时必须先补负责人。
create or replace function public.admin_proxy_task_review(
  p_task_id uuid,
  p_approve boolean,
  p_reason text,
  p_reject_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks%rowtype;
  v_owner uuid;
  v_reason text := nullif(trim(p_reason), '');
  v_reject text := nullif(trim(p_reject_note), '');
begin
  if not public.is_admin() then raise exception '仅管理员可执行异常代办'; end if;
  if public.current_developer_id() is null then raise exception '当前管理员账号未绑定人员档案，无法记录审批审计'; end if;
  if v_reason is null then raise exception '管理员异常代办必须填写代办原因'; end if;
  if length(v_reason) > 2000 then raise exception '代办原因不能超过 2000 个字符'; end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception '任务不存在'; end if;
  if v_task.status <> 'review' then raise exception '仅审核中的任务可执行异常代办'; end if;
  if v_task.task_type = 'test' then raise exception '测试任务不走项目审批'; end if;

  if v_task.project_id is not null then
    select p.owner_id into v_owner from public.projects p where p.id = v_task.project_id;
    if v_owner is null then
      raise exception '项目缺少负责人，请先在项目管理中补充负责人，不能回退给组长或管理员日常审批';
    end if;
  end if;

  if not p_approve and v_reject is null then raise exception '驳回任务必须填写驳回原因'; end if;
  if length(coalesce(v_reject, '')) > 2000 then raise exception '驳回原因不能超过 2000 个字符'; end if;

  perform set_config('app.admin_approval_proxy', 'on', true);
  perform set_config('app.admin_approval_reason', v_reason, true);

  if p_approve then
    update public.tasks set status = 'done' where id = p_task_id;
  else
    update public.tasks set status = 'in_progress', reject_note = v_reject where id = p_task_id;
  end if;
end;
$$;

revoke execute on function public.admin_proxy_task_review(uuid, boolean, text, text) from public;
grant execute on function public.admin_proxy_task_review(uuid, boolean, text, text) to authenticated;

-- 审批/驳回审计：保留当时项目负责人，不随项目负责人变更回写。
create or replace function public.record_task_approval_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_owner_name text;
  v_actor_name text;
  v_proxy boolean := public.is_admin()
    and coalesce(current_setting('app.admin_approval_proxy', true), '') = 'on';
  v_proxy_reason text := nullif(trim(coalesce(
    current_setting('app.admin_approval_reason', true), ''
  )), '');
begin
  if old.status = 'review' and new.status <> 'review' then
    select p.owner_id, d.name into v_owner, v_owner_name
    from public.projects p
    left join public.developers d on d.id = p.owner_id
    where p.id = old.project_id;
    select d.name into v_actor_name
    from public.developers d where d.id = public.current_developer_id();
    insert into public.task_approval_audits (
      task_id, project_id, project_owner_id, project_owner_name,
      actor_id, actor_name, actor_role,
      decision, to_status, is_admin_proxy, admin_proxy_reason,
      decision_note, submitted_at_snapshot, completed_at_snapshot
    ) values (
      old.id, old.project_id, v_owner, v_owner_name,
      public.current_developer_id(), coalesce(v_actor_name, '未知人员'), public.auth_role(),
      case when new.status in ('done', 'delayed_done') then 'approved' else 'rejected' end,
      new.status, v_proxy, case when v_proxy then v_proxy_reason else null end,
      case when new.status = 'in_progress' then new.reject_note else null end,
      old.submitted_at, new.completed_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_approval_audit on public.tasks;
create trigger trg_tasks_approval_audit
  after update on public.tasks
  for each row execute function public.record_task_approval_audit();

-- 通知只发给当前项目负责人；通过/驳回后通知任务负责人。
create or replace function public.notify_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  approver uuid;
begin
  if old.status <> 'review' and new.status = 'review' then
    select p.owner_id into approver from public.projects p where p.id = new.project_id;
    if approver is not null then
      perform public.notify(approver, 'task_submitted',
        jsonb_build_object('task_id', new.id, 'title', new.title));
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
  return new;
end;
$$;

-- 移除 v2.12 可调用能力；只保留物理列以兼容历史数据。
drop function if exists public.set_task_acceptance(uuid, boolean);
drop function if exists public.guard_task_acceptance();
drop function if exists public.task_requires_acceptance(uuid);
drop function if exists public.project_requires_acceptance(uuid, boolean);
drop function if exists public.can_manage_task_acceptance(uuid);
drop function if exists public.can_manage_project_acceptance(uuid);
drop function if exists public.project_acceptance_owner(uuid);
drop function if exists public.can_accept_task(uuid);
