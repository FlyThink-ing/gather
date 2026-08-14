# 权限与流程加固自动化回归

本文说明需求 v2.19 / migration `0012_permission_and_flow_hardening.sql` 的专项 Playwright 回归。专项测试不替代 smoke/full；部署后应先跑专项，再跑 smoke 与 full。

## 执行命令

静态合同检查不读取 `.env.uat`、不启动浏览器、不访问网络：

```powershell
npm.cmd run test:uat:hardening:static
```

部署 0012 后执行真实专项回归：

```powershell
npm.cmd run test:uat:hardening
```

专项用例全部带 `@hardening`，可继续使用 Playwright 的 `--grep`、`--project` 或单文件参数定向执行。关键专项账号缺失时测试直接失败并指出缺少的变量，不会 `skip` 后宣称通过。

## 专项账号关系

真实值只填写在本地 `.env.uat`，不得写进代码、文档、日志或报告。

| 变量前缀 | 关系要求 |
|---|---|
| `UAT_ADMIN_*` | admin，且绑定有效人员档案 |
| `UAT_TEAM_LEAD_*` | manager；测试运行时成为 UAT 项目组组长 |
| `UAT_OTHER_TEAM_LEAD_*` | 与归属组长不同的 manager |
| `UAT_EMPTY_MANAGER_*` | manager；仅领导本轮创建的空 UAT 小组 |
| `UAT_TEAM_MEMBER_*` | 普通 user；测试运行时加入本轮 UAT 项目组 |
| `UAT_OUTSIDER_*` | 普通 user；不加入上述项目组或测试计划 |
| `UAT_CROSS_GROUP_OWNER_*` | 跨组项目负责人；执行计数用例前不得有历史待审批任务 |
| `UAT_TEST_LEAD_*` | `is_test_team=true` 小组的组长 |
| `UAT_TEST_ENGINEER_*` | 在职“测试工程师” |
| `UAT_TEST_PARTICIPANT_*` | 与主测不同的普通测试参与人 |
| `UAT_AUTOMATION_TESTER_*` | 在职“自动化测试工程师” |

这些账号必须彼此独立。测试只检查变量是否存在和账号是否满足运行时关系，不会输出邮箱、密码、Token、Cookie 或 JWT。

## 用例与门禁

| ID | 层级 | 核心断言 |
|---|---|---|
| AUTH-PROJ-01 | P0 | owner 业务编辑；归属组长仅治理；异组组长/成员拒绝；admin 必须带原因并留下审计 |
| AUTH-TASK-01 | P0 | assignee 执行、组长专用管理、owner 审批、admin 异常代办；审批不得夹带字段；禁止状态跳跃、终态改写和未审计删除 |
| AUTH-TASK-INSERT | P0 | 普通 user 合法创建本人 `development/dev`；禁止伪造测试任务来源/类型或挂载不可见项目 UUID |
| VIS-TASK-01 | P0 | 默认列表、`scope`、项目来源、`focus`、REST/RPC 使用同一对象集合 |
| SCOPE-EMPTY-01 | P0 | team scope 为本人和所带组有效成员并集；空组 manager 即使传 `scope=all` 也只见本人；不得仅凭 `task.team_id` 扩权 |
| COUNT-REVIEW-01 | P0 | 跨组 owner 恰好一条 review；RPC、工作台、项目统计和点击后列表 total/ID 一致 |
| NAV-METRIC-01 | P1 | 工作台和项目统计卡支持键盘 Enter，导航筛选结果与数字一致 |
| VIS-TEST-01 | P1 | 全部开发任务就绪后才进入候选；requested 后 owner 只读可见，非参与人不可见；组长/主测/参与人职责分离 |
| HOURS-01 | P1 | accepted 拆分后活动/任务为 todo 且禁止登记；start、pause、resume 同步活动与底层任务；参与人仅在可执行阶段登记；cancel 后活动 cancelled、任务锁定且禁止新增；两计划跨日期工时新增/修改/作废及各层汇总同源 |
| HOURS-VIS-01 | P0 | 互不可见计划不在资源汇总泄露；建设参与人不能给他人负责的建设子任务代记工时 |
| UI-LAYOUT-01 | P2 | 375/768/1280 下活动卡无全局横向溢出，工时数值 nowrap，资源表使用可访问横向滚动容器 |
| RULE-PARITY-01 | P0 | 关键对象同时验证 UI 按钮、列表、深链、RPC/RLS 和最终落库五层一致 |

## 数据与结果判定

- 所有新建对象统一使用 `UAT-` 前缀和 `UAT_RUN_ID` 唯一命名。
- 不修改、删除非 UAT 数据；专项测试不自动执行破坏性清理，保留审计证据。
- 0012 未部署、RPC 缺失或关键账号关系不满足时，专项回归结果是阻塞/失败，不是通过。
- 发布门槛：P0/P1 `0 failed / 0 skipped`；随后 smoke 和 full 也必须通过。
