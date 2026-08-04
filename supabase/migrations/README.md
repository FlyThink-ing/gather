# 迁移 SQL ↔ 演示层同步纪律

演示模式（`src/lib/demoClient.ts`）逐条镜像本目录迁移 SQL 的**行为性逻辑**，
以保证"本地演示测试可信、与正式环境行为一致"。

**规则：改下表左列的任何内容，必须同步改右列对应位置，否则视为未完成。**

| 迁移 SQL 位置 | 行为 | demoClient.ts 对应位置 |
| --- | --- | --- |
| 0001 各表 `DEFAULT` 子句 | 列默认值 | `TABLE_DEFAULTS` 常量 |
| 0001 `tasks.status` CHECK | 状态枚举 | `src/lib/types.ts` `TaskStatus` |
| 0001 `task_work_segments` 表 | 工时段结构 | seed() 的 `task_work_segments` + `TABLE_DEFAULTS` |
| 0003 `enforce_task_rules()` ①离开 review | 审批自动判定/审计字段/驳回必填原因 | `applyTaskRules` 第 1) 段 |
| 0003 `enforce_task_rules()` ②进入 review | submitted_at / 超期需延期备注 | `applyTaskRules` 第 2) 段 |
| 0003 `enforce_task_rules()` ③review 锁定 | 审核中锁定 | `applyTaskRules` 第 3) 段（演示恒 admin，仅保留结构）|
| 0003 `enforce_task_rules()` ④挂起约束 | paused 流转限制 | `applyTaskRules` 第 4) 段 |
| 0003 `track_work_segments()` | 工时段开/闭 | `applyTaskRules` 第 5) 段 |
| 0003 `notify_task_insert/update()` | 通知（指派/提审/审批/驳回）| `applyTaskRules` 内各 `notify(...)` 与 insert 分支 |
| 0003 `submit_for_testing()` / `conclude_test()` | v2.5-v2.10 历史流程；0009 已撤销登录用户执行权 | demo 对旧 RPC 统一返回“请使用测试中心” |
| 0003 `enforce_task_rules()` ⑤testing 相关 | 提测/测试锁定/test 任务禁提审 | `applyTaskRules` 第 2/2.5/2.6 段 |
| 0004 `test_rounds` 升级 | 测试汇总默认值/草稿/非负约束 | `TABLE_DEFAULTS.test_rounds` + seed() 的 `test_rounds` |
| 0004 `start_test_task()` / `conclude_test()` | v2.9 历史实现；0009 已撤销登录用户执行权 | demo 对旧 RPC 统一返回“请使用测试中心” |
| 0005 `test_rounds` 测试方式升级 | 标准用例/快速探索字段与约束 | `TABLE_DEFAULTS.test_rounds` + seed() 的 `test_rounds` |
| 0005 `start_test_task()` / `conclude_test()` | v2.10 历史实现；0009 已撤销登录用户执行权 | demo 对旧 RPC 统一返回“请使用测试中心” |
| 0006 项目轻量验收 | v2.12 历史迁移，字段保留但行为已由 0007 完整替代 | demo 不再读取这些历史字段 |
| 0007 `can_approve_task()` / RLS | 审批权只来自当前 `projects.owner_id` | `applyTaskRules` 的 review 权限判断 |
| 0007 `enforce_task_rules()` | 项目任务统一 review、测试通过进 review、无项目任务直完 | `applyTaskRules` 的完成/测试分支 |
| 0007 `task_approval_audits` | 审批人、负责人快照、管理员代办原因 | `task_approval_audits` store + 审计写入 |
| 0007 `admin_proxy_task_review()` | admin 独立代办入口与必填原因 | `rpc('admin_proxy_task_review')` 分支 |
| 0007 `notify_task_update()` | review 只通知项目负责人，通过/驳回通知任务负责人 | `applyTaskRules` 内 `notify(...)` |
| 0008 项目生命周期列/状态事件 | 真实启动时间、完成/重开与强制完成审计 | `TABLE_DEFAULTS.projects` + `project_status_events` store + `applyTaskRules` |
| 0008 `complete_project()` | 阻断未完成开发/测试/审批，admin 强制原因 | `rpc('complete_project')` 分支 |
| 0008 项目驾驶舱 RPC | 严格项目周期、投入、任务、测试质量与人员聚合 | `projectSummary()` / `projectCockpit()` |
| 0008 `list_tasks()` | URL 组合条件、范围、数据库分页与总数 | `rpc('list_tasks')` 分支 |
| 0009 统一测试计划/轮次/活动/批次/报告 | v2.16-v2.17 项目级与外部测试中心 | `test_plans` 等 store + 同名 RPC 分支 |
| 0009 无需测试申请 | 测试组长确认、退回、撤回与审计 | `project_no_test_events` + 对应 RPC 分支 |
| 0009 测试建设工作 | 独立状态机、拆分任务、手工工时、成果确认 | `test_construction_*` store + 对应 RPC 分支 |
| 0009 三来源资源汇总 | 内部项目/外部测试/测试建设；建设不计项目成本 | `rpc('get_test_resource_summary')` |
| 0009 项目测试完成门禁 | 通过轮次或已批准无需测试；admin 原因强制 | `rpc('complete_project')` 新门禁字段 |
| 0010 内部测试候选项目与创建复核 | 仅项目负责人；活动项目、无活动轮次、非无需测试、存在已审批未覆盖任务 | `rpc('get_eligible_internal_test_projects')` + `create_test_plan` 分支 |
| 0003 `handle_new_user()` | 注册建档 | 演示不模拟注册（任意凭据即 admin），无需同步 |
| 0002 RLS 策略 | 行级权限 | 演示恒 admin 会话，权限矩阵由前端 UI 层体现；如未来演示支持切换角色需补镜像 |

> 提示：演示层校验失败返回 `{ error: { message } }`（等效触发器 `raise exception`），
> 页面按真实 supabase-js 的错误处理路径走，无需区分环境。
