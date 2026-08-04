-- =============================================================
-- 0002_functions_rls.sql  RLS 辅助函数 + 行级安全策略
-- 需求文档 v2 · 第十一章
-- 说明：辅助函数用 SECURITY DEFINER 绕过 RLS，避免 user_roles 自引用递归
-- =============================================================

-- ---------- 辅助函数 ----------
create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.user_roles where user_id = auth.uid()), 'user');
$$;

create or replace function public.current_developer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.developers where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_role() = 'admin';
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_role() = 'manager';
$$;

-- 当前用户是否有某任务的审批权限：管理员，或「项目负责人」。
-- owner_id 已强制必填；leader 兜底仅作为历史数据的保险，正常不会触发（v2 §5.2）
create or replace function public.can_approve_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      left join public.teams tm on tm.id = p.team_id
      where t.id = p_task_id
        and (
          p.owner_id = public.current_developer_id()
          or (p.owner_id is null and tm.leader_id = public.current_developer_id())
        )
    );
$$;

-- ---------- 启用 RLS ----------
alter table public.profiles        enable row level security;
alter table public.user_roles      enable row level security;
alter table public.developers      enable row level security;
alter table public.teams           enable row level security;
alter table public.developer_teams enable row level security;
alter table public.projects        enable row level security;
alter table public.tasks           enable row level security;
alter table public.task_comments   enable row level security;
alter table public.notifications   enable row level security;
alter table public.task_work_segments enable row level security;

-- ---------- task_work_segments（只读；写入仅经由 security definer 触发器）----------
create policy tws_select on public.task_work_segments for select to authenticated using (true);
-- 不创建 insert/update/delete 策略：客户端不可直接写工时段

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_self   on public.profiles for update to authenticated using (id = auth.uid());

-- ---------- user_roles（仅 admin 增删改）----------
create policy roles_select on public.user_roles for select to authenticated using (true);
create policy roles_insert on public.user_roles for insert to authenticated with check (public.is_admin());
create policy roles_update on public.user_roles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy roles_delete on public.user_roles for delete to authenticated using (public.is_admin());

-- ---------- teams（仅 admin）----------
create policy teams_select on public.teams for select to authenticated using (true);
create policy teams_insert on public.teams for insert to authenticated with check (public.is_admin());
create policy teams_update on public.teams for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy teams_delete on public.teams for delete to authenticated using (public.is_admin());

-- ---------- developer_teams（admin/manager）----------
create policy dt_select on public.developer_teams for select to authenticated using (true);
create policy dt_write  on public.developer_teams for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());

-- ---------- developers（admin/manager 全权；本人可改自己记录，列级限制由前端约束到 position）----------
create policy dev_select on public.developers for select to authenticated using (true);
create policy dev_insert on public.developers for insert to authenticated
  with check (public.is_admin() or public.is_manager());
create policy dev_update on public.developers for update to authenticated
  using (public.is_admin() or public.is_manager() or user_id = auth.uid())
  with check (public.is_admin() or public.is_manager() or user_id = auth.uid());
create policy dev_delete on public.developers for delete to authenticated using (public.is_admin());

-- ---------- projects（admin/manager）----------
create policy proj_select on public.projects for select to authenticated using (true);
create policy proj_write  on public.projects for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());

-- ---------- tasks ----------
-- 查看：全部登录用户
create policy task_select on public.tasks for select to authenticated using (true);
-- 创建：admin/manager 任意；user 仅能把负责人指定为自己（D1）
create policy task_insert on public.tasks for insert to authenticated with check (
  public.is_admin() or public.is_manager() or developer_id = public.current_developer_id()
);
-- 编辑：admin/manager；或本人负责的任务。细粒度状态机与审批权限由触发器强制（见 0003）
create policy task_update on public.tasks for update to authenticated
  using (public.is_admin() or public.is_manager() or developer_id = public.current_developer_id())
  with check (public.is_admin() or public.is_manager() or developer_id = public.current_developer_id());
-- 删除：admin/manager
create policy task_delete on public.tasks for delete to authenticated
  using (public.is_admin() or public.is_manager());

-- ---------- task_comments ----------
create policy cmt_select on public.task_comments for select to authenticated using (true);
create policy cmt_insert on public.task_comments for insert to authenticated
  with check (author_id = public.current_developer_id());
create policy cmt_update on public.task_comments for update to authenticated
  using (author_id = public.current_developer_id()) with check (author_id = public.current_developer_id());
create policy cmt_delete on public.task_comments for delete to authenticated
  using (author_id = public.current_developer_id() or public.is_admin());

-- ---------- notifications（仅本人可见/标记已读；写入由触发器 SECURITY DEFINER 完成）----------
create policy notif_select on public.notifications for select to authenticated
  using (recipient_id = public.current_developer_id());
create policy notif_update on public.notifications for update to authenticated
  using (recipient_id = public.current_developer_id()) with check (recipient_id = public.current_developer_id());
create policy notif_delete on public.notifications for delete to authenticated
  using (recipient_id = public.current_developer_id());
