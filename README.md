# Gather 项目管理系统

Gather 是一个面向研发团队的项目与任务管理系统。前端使用 React 构建，后端使用 Supabase 提供用户认证、PostgreSQL 数据库、行级权限控制（RLS）、数据库函数和实时通知能力。

## 功能概览

- 邮箱注册、登录和角色权限控制（管理员、经理、普通成员）
- 开发人员、小组和项目管理
- 任务创建、分配、状态流转、延期和工时记录
- 统一测试中心、测试计划、测试轮次、测试报告和测试建设工作
- 项目负责人审批、管理员代办审批及审批审计
- 项目驾驶舱、项目进度和测试质量汇总
- 站内通知及实时刷新

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、React Router、Tailwind CSS |
| 构建 | Webpack 5、PostCSS |
| UI/图表 | Lucide React、Framer Motion、Recharts、date-fns |
| 后端 | Supabase（PostgreSQL、Auth、Realtime、RLS、RPC） |

## 本地启动

### 环境要求

- Node.js 18 或更高版本（推荐 Node.js 22 LTS）
- npm
- 可选：Supabase 本地实例或远程 Supabase 项目

### 安装依赖

```bash
npm ci
```

### 配置环境变量

复制示例文件：

```bash
copy .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
```

`SUPABASE_ANON_KEY` 是用于浏览器连接 Supabase 的公开客户端 Key；不要在前端、文档或 Git 仓库中写入 `SERVICE_ROLE_KEY`、数据库密码、SMTP 密码或任何私有凭据。

### 启动开发服务

```bash
npm start
```

默认访问地址：`http://localhost:3000`。

### 质量检查和生产构建

```bash
npm run typecheck
npm run build
```

构建产物位于 `dist/`，该目录不提交到 Git。

## 演示模式

当 `.env` 缺失、变量为空，或仍使用示例占位值时，系统会自动使用浏览器本地的模拟数据进入演示模式。

演示模式仅用于页面体验和本地演示：

- 任意邮箱和密码均可登录；
- 数据保存在浏览器 `localStorage`；
- 不会连接正式 Supabase，也不能用于正式业务数据。

配置真实 Supabase 后重新执行构建，即可切换到正式后端。

## 数据库迁移

数据库迁移文件位于 [`supabase/migrations`](supabase/migrations)。新环境必须按文件编号顺序执行：

```text
0001_init.sql
0002_functions_rls.sql
0003_triggers_seed.sql
0004_test_metrics.sql
0005_test_methods.sql
0006_project_acceptance.sql
0007_project_task_approval.sql
0008_project_cockpit.sql
0009_testing_center.sql
0010_internal_test_project_candidates.sql
0011_fix_test_conclusion_and_construction_summary.sql
```

迁移包含表结构、RLS 策略、触发器和 RPC。请勿跳号、重复执行或在生产库中直接修改已执行迁移；详细操作见 [DEPLOY.md](DEPLOY.md)。

另外，实时通知依赖将 `public.notifications` 加入 `supabase_realtime` publication，部署文档已提供对应 SQL。

## 部署

完整的自托管 Supabase、Nginx、HTTPS、数据库初始化、备份、恢复和升级说明请见：[DEPLOY.md](DEPLOY.md)。

生产环境至少应做到：

- 前端与 Supabase API 使用 HTTPS；
- 仅对公网开放 80/443，数据库和 Supabase 原始端口仅监听本机；
- `.env` 不提交到 Git；
- 定期进行数据库备份并同步到异地存储；
- 先在测试环境验证迁移和升级。

## 目录说明

```text
src/                    React 页面、组件、上下文和客户端逻辑
src/lib/supabase.ts     Supabase 客户端与演示模式切换
src/lib/demoClient.ts   本地演示数据和模拟 Supabase 接口
supabase/migrations/    PostgreSQL 表结构、RLS、触发器和 RPC 迁移
scripts/                辅助脚本
public/                 静态页面模板
DEPLOY.md               生产部署与运维手册
gather-需求-v2.md       需求说明
```

## 安全说明

- `.env` 已被 `.gitignore` 忽略，不应提交；若怀疑凭据曾被提交，应立即轮换。
- 浏览器端仅使用匿名/公开客户端 Key，业务权限由 Supabase RLS 与数据库函数控制。
- `SERVICE_ROLE_KEY` 能绕过 RLS，仅能保存在受控的服务端环境。
- 上线前请完成管理员账号、SMTP、备份和恢复演练。

## 许可

当前仓库未声明开源许可。未经项目负责人确认，不应将其公开发布或复用。
