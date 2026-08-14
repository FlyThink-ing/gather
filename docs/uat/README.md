# Gather 自动化验收测试

本目录说明 Gather 的 Playwright UAT。测试分为 `smoke`（几分钟内完成的发布前检查）与 `full`（完整回归）。测试默认只使用 Chromium CLI，不依赖浏览器扩展。

自动化验收完成后，业务人员按[手工验收测试指南](./MANUAL-TEST-GUIDE.md)准备环境和角色，并使用[手工验收测试清单](./MANUAL-TEST-CHECKLIST.md)逐项记录实际结果、证据与签字结论。

## 1. 首次准备

```powershell
npm.cmd install
npx.cmd playwright install chromium
Copy-Item .env.uat.example .env.uat
```

只在本机 `.env.uat` 中填写站点与现有测试账号。不要把真实密码、Token、Cookie、JWT 或 anon key 发到聊天、提交到 Git，或复制进测试代码与文档。`.env.uat` 已被 `.gitignore` 忽略。

账号变量允许复用同一个登录账号，但该账号在系统中必须确实具有相应角色或业务身份：

- `ADMIN / MANAGER / USER`：系统权限角色。
- `PROJECT_OWNER`：某个 UAT 项目的当前负责人。
- `TEST_LEAD`：`is_test_team=true` 小组的组长。
- `TEST_ENGINEER`：职位为“测试工程师”。
- `AUTOMATION_TESTER`：职位为“自动化测试工程师”。

缺少某类账号时，相关用例会显示为 `skipped` 并说明缺哪个业务身份，不会伪装成通过。真实凭据缺失时，只需填写本地文件，不要再次在聊天里提供密码。

## 2. 一条命令运行

```powershell
npm.cmd run test:uat:smoke
npm.cmd run test:uat:full
npm.cmd run test:uat:hardening
```

权限与流程加固专项的账号关系、用例和门禁见[权限与流程加固自动化回归](./HARDENING-REGRESSION.md)。`npm.cmd run test:uat:hardening:static` 可在不读取 `.env.uat`、不访问网络的情况下检查 0012、UI 与 demo 实现合同。

也可临时用进程环境变量运行公开检查，不落盘账号：

```powershell
$env:UAT_BASE_URL='http://YOUR_UAT_HOST:PORT'
npm.cmd run test:uat:smoke -- --project=public-smoke
```

报告位于 `reports/uat/html/index.html`；失败截图、失败录像和上下文位于 `artifacts/uat/test-results/`。公开 smoke 失败时保留 trace。认证用例故意关闭原始 trace，因为 trace 可能记录 Authorization 或 Cookie；认证用例仍保留失败截图、失败录像和脱敏断言。

## 3. 分层与稳定性

- `smoke`：公开入口、登录/退出、三角色菜单和路由、基础创建入口、测试中心关键视图与必填校验。
- `full`：smoke 加数据范围、任务完整流转、测试中心全流程、关键 UI 与 Supabase/RLS 越权。
- `hardening`：0012 权限、深链、待我审批、测试计划可见性、工时修正/隔离及响应式布局专项；关键账号缺失直接失败，不跳过。
- 单用例超时 45 秒，操作 15 秒，导航 30 秒；本地失败重试 1 次，CI 失败重试 2 次。没有无限等待。
- 默认单 worker 串行执行，避免多个角色同时修改同一条 UAT 数据。

## 4. 测试数据规则

所有会创建或修改的数据必须使用 `UAT-` 前缀：

- 可复用的基础数据先查询后复用，例如 `UAT-质量保障组`、`UAT-研发组`。
- 流转型数据使用 `UAT_RUN_ID`；未指定时按本轮时间生成，避免并行/重复运行碰撞。
- 任何查询、修改、清理都必须带 `UAT-` 范围；禁止删除或修改非 UAT 数据。
- 当前自动化不执行破坏性清理。需要清理时应先导出候选清单人工确认，再运行独立的显式清理步骤。
- RLS 更新测试只寻找其他负责人名下的 `UAT-*` 任务；没有安全目标时跳过，不拿真实业务数据凑数。

## 5. 发布前建议

至少要求：`typecheck`、`build`、`test:uat:smoke` 全通过；完整发布窗口再执行 `test:uat:full`。若 full 因业务身份或测试数据缺失而跳过关键用例，应视为验收未完成，而不是可上线。产品缺陷记录在首轮报告中，测试脚手架问题修复后需单独复跑确认。
