# Gather 自动化验收首轮报告

- 日期：2026-08-13（Asia/Shanghai，最终复验）
- 目标站点：由 `UAT_BASE_URL` 注入，报告不固化环境地址与账号
- 浏览器：Playwright Chromium CLI
- 数据变更：完整回归仅创建/流转 `UAT-` 前缀数据；未执行清理，未修改非 UAT 数据

## 结果

| 检查 | 结果 | 证据 |
|---|---|---|
| `npm.cmd run typecheck` | 通过 | TypeScript 无错误 |
| `npm.cmd run build` | 通过 | webpack production build 退出码 0 |
| lint | 不适用 | 项目未配置 lint 依赖或脚本；本任务未为此额外引入依赖 |
| unit | 不适用 | 项目未配置 unit 框架或脚本；验收逻辑由 Playwright 覆盖 |
| Playwright 用例枚举 | 通过 | 当前 10 个 spec、23 个用例 |
| 公开 smoke | 通过 | 3/3；最终复验 4.6 秒 |
| 无账号 full 安全降级 | 通过 | 3 passed、16 skipped，10.3 秒 |
| 真实账号 smoke（最终） | 通过 | 13 passed、0 failed、0 skipped，19.3 秒；无 flaky |
| 真实账号 full（最终） | 通过 | 23 passed、0 failed、0 skipped，34.0 秒 |
| UI 定向复测 | 通过 | 1/1，2.6 秒 |
| `UAT-DEFECT-002` 部署后定向复测 | 通过 | 1/1，9.6 秒；最终批准成功，cycle/plan 均为 `passed`，无 PostgreSQL `23514` |
| `UAT-DEFECT-003` 部署后定向复测 | 通过 | 1/1，3.2 秒；详情 RPC、列表、子任务与页面顶部四项汇总一致 |
| 测试建设早期定向复测 | 通过 | 1/1，6.0 秒；排期、拆分、进度、工时、成果确认完整通过 |
| RLS 跨负责人定向复测 | 通过 | 1/1，4.9 秒；自动创建明确的 `UAT-RLS-*` 目标并确认 user 更新被静默过滤 |
| HTML 报告 | 已生成 | `reports/uat/html/index.html`；对应最终 23/23 完整回归 |

## 首轮过程说明

1. 首次执行因 Playwright Chromium 尚未安装而基础设施阻塞；安装固定版本浏览器后解除。
2. 沙箱内 Chromium 公网访问被拒绝；经授权对指定 UAT 站点运行后解除。
3. 第一轮公网用例发现登录页 `<label>` 未通过 `for` 与 input 关联，导致辅助技术和语义定位无法建立标签关系。测试已改用稳定 input 类型定位并复跑通过；该问题记录为低优先级可访问性产品缺陷，不在本任务中改业务代码。
4. npm 安装报告依赖树存在 10 个安全告警（1 low、5 moderate、4 high）。本任务未运行可能引入破坏性升级的 `npm audit fix`；建议另开依赖治理任务逐项评估。
5. production build 通过，但 webpack 报告主 bundle 约 1.13 MiB，超过默认性能建议阈值；建议后续评估按路由拆包，不阻塞本次测试框架交付。
6. 第一轮真实 full 为 13 passed、1 skipped、5 failed；其中 4 条由测试组长账号当时无法登录引起。修正本地账号后，完整回归只剩 2 条失败。
7. 日期控件用例先后发现“误选弹窗关闭按钮”和“空项目列表仍断言项目卡片工时”两个脚手架问题，均已按真实页面语义做最小修复；定向复测 1/1 通过。
8. 测试组长业务关系修正后，测试建设状态机已完整通过。建设详情的用例失败源于测试断言期望 `1 小时`，页面按统一格式展示 `1.0 小时`；脚手架修复后定向复测通过。
9. 最新 full 的 1 条 skipped 原因为 RLS 安全用例未找到“其他负责人名下的 `UAT-*` 任务”。测试已改为由 admin 自动创建唯一的 `UAT-RLS-*` 审计任务，再由 user 越权更新并由 admin 复核未改变；定向复测通过，后续不再依赖偶然数据。
10. 外部测试可完成排期、活动拆分、开始、工时、执行批次、结构化结论提交、退回及再次提交；仅最终批准失败。安全诊断确认数据库错误为 `23514`，不是账号、网络或 Playwright 问题。
11. 正式 migration `0011_fix_test_conclusion_and_construction_summary.sql` 部署后，先执行两条增强定向用例：结论终态同时校验 `test_cycles.status` 与 `test_plans.status`；建设汇总同时校验详情 RPC、列表 RPC、子任务及页面顶部。两条均通过。
12. 部署后最终 smoke 与 full 均一次通过；完整回归覆盖 23 条用例，无失败、无跳过、无 flaky。

## 产品缺陷

- `UAT-DEFECT-001`（低）：登录页“邮箱”“密码”文字标签未通过 `htmlFor/for` 关联对应 input。视觉操作正常，但屏幕阅读器与语义定位体验受影响。建议为 input 增加稳定 `id` 并在 label 上设置 `htmlFor`。
- `UAT-DEFECT-002`（已修复并复验）：正式 migration 已实现 `pass -> passed`、`fail -> failed`；最终批准成功，cycle/plan 终态一致，未再出现 PostgreSQL `23514`。
- `UAT-DEFECT-003`（已修复并复验）：详情 RPC 已补齐 `task_count/done_count/planned_hours/actual_hours`；与列表、子任务和页面顶部汇总一致。

## 最终结论与建议

测试组长业务关系、RLS 安全数据策略、两项产品修复及部署后完整回归均已验证。最终 full 为 23 passed、0 failed、0 skipped。

当前上线建议：**自动化验收通过，建议进入上线流程**。低优先级 `UAT-DEFECT-001` 可作为后续可访问性改进，不阻塞本次上线。npm 依赖安全告警与 bundle 体积告警仍建议另开治理任务，不影响本轮功能验收结论。
