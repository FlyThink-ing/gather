-- =============================================================
-- 0001_init.sql  表结构 / 外键 / 索引
-- 需求文档 v2 · 第九章数据模型
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- 通用 updated_at 触发器函数 ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles（用户资料，Auth 侧最小字段，D6：业务真源为 developers）----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------- user_roles（用户角色，与 auth.users 1:1）----------
create table public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'user' check (role in ('admin','manager','user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_user_roles_updated before update on public.user_roles
  for each row execute function public.set_updated_at();

-- ---------- developers（开发人员，业务唯一真源）----------
create table public.developers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users(id) on delete set null,
  name       text not null,
  position   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_developers_updated before update on public.developers
  for each row execute function public.set_updated_at();

-- ---------- teams（小组）----------
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  leader_id  uuid references public.developers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_teams_updated before update on public.teams
  for each row execute function public.set_updated_at();
create index idx_teams_leader on public.teams(leader_id);

-- ---------- developer_teams（开发-小组 M:N）----------
create table public.developer_teams (
  id           uuid primary key default gen_random_uuid(),
  developer_id uuid not null references public.developers(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (developer_id, team_id)
);
create index idx_dev_teams_dev on public.developer_teams(developer_id);
create index idx_dev_teams_team on public.developer_teams(team_id);

-- ---------- projects（项目，D3：team_id NOT NULL + RESTRICT）----------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        varchar(200) not null,
  description text,
  status      varchar(50) not null default 'active' check (status in ('active','completed','paused')),
  start_date  date,
  end_date    date,
  team_id     uuid not null references public.teams(id) on delete restrict,
  owner_id    uuid not null references public.developers(id) on delete restrict,  -- 项目负责人（审批人，必填）；删除人员前需先移交其负责的项目
  created_by  uuid references public.developers(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();
create index idx_projects_team on public.projects(team_id);
create index idx_projects_owner on public.projects(owner_id);

-- ---------- tasks（任务）----------
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  title            varchar(255) not null,
  description      text,
  status           varchar(50) not null default 'todo'
                     check (status in ('todo','in_progress','paused','testing','review','done','delayed_done')),
  task_type        varchar(10) not null default 'dev' check (task_type in ('dev','test')),  -- v2.5 开发/测试任务
  linked_task_id   uuid references public.tasks(id) on delete set null,  -- 测试任务→关联的开发任务
  test_result      varchar(10) check (test_result in ('pass','fail')),   -- 测试结论（仅测试任务）
  test_note        text,  -- 测试结论备注
  priority         varchar(50) not null default 'medium'
                     check (priority in ('low','medium','high','urgent')),
  project_id       uuid references public.projects(id) on delete set null,
  developer_id     uuid references public.developers(id) on delete set null,
  team_id          uuid references public.teams(id) on delete set null,
  start_date       date not null,
  due_date         date not null,
  submitted_at     timestamptz,  -- 最近一次提交审核的时间（工作实际完成时刻）
  completed_at     timestamptz,  -- 完成时间 = 审批通过时生效的 submitted_at
  approved_by_role varchar(50) check (approved_by_role in ('admin','manager')),
  approved_by_user uuid references public.developers(id) on delete set null,
  delay_note       text,
  reject_note      text,
  created_by       uuid references public.developers(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();
create index idx_tasks_project on public.tasks(project_id);
create index idx_tasks_developer on public.tasks(developer_id);
create index idx_tasks_linked on public.tasks(linked_task_id);

-- 测试轮次（v2.6）：一个开发任务对应一个测试任务（1:1），每轮结论记一行
-- 结构化指标：用例数/bug数/reopen数/主流程不通；tasks.test_result/test_note 仅为最新轮快照
create table public.test_rounds (
  id            uuid primary key default gen_random_uuid(),
  test_task_id  uuid not null references public.tasks(id) on delete cascade,
  round_no      int not null,
  result        varchar(10) not null check (result in ('pass','fail')),
  blocked       boolean not null default false,  -- 主流程不通（阻塞级）
  case_total    int,                             -- 执行用例数
  bug_count     int not null default 0,          -- 本轮新增 bug 数
  reopen_count  int not null default 0,          -- 本轮 reopen 数
  note          text,
  concluded_by  uuid references public.developers(id) on delete set null,
  concluded_at  timestamptz not null default now()
);
create index idx_test_rounds_task on public.test_rounds(test_task_id);

-- 实际工时段（v2.4）：任务进入 in_progress 开段、离开时闭段，由触发器维护
-- ended_at 为空 = 正在进行的开段。甘特图据此绘制「实际投入」分段
create table public.task_work_segments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  developer_id uuid references public.developers(id) on delete set null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index idx_work_segments_task on public.task_work_segments(task_id);
create index idx_tasks_team on public.tasks(team_id);
create index idx_tasks_status on public.tasks(status);

-- ---------- task_comments（任务评论）----------
create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid references public.developers(id) on delete set null,
  content    text not null,
  created_at timestamptz not null default now()
);
create index idx_comments_task on public.task_comments(task_id);

-- ---------- notifications（通知，一期仅站内）----------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.developers(id) on delete cascade,
  type         varchar(50) not null,
  payload      jsonb not null default '{}'::jsonb,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index idx_notif_recipient on public.notifications(recipient_id, is_read);
