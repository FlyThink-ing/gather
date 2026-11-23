# Gather 服务器更新与跨组项目合并

2026 年 11 月 20 日，`172.16.1.84` 的 Gather 前端更新到 `dev` 的 `e4d2293`，数据库从 `0016` 升级到 `0020`。随后，16 个旧项目中的 227 条任务迁入 11 个共享项目。服务恢复后，管理员登录、项目列表和任务抽查均通过。

- [项目更新操作指南](./gather-project-update.md)包含实际构建、跨电脑上传、暂停网关、备份、升级和发布步骤。
- [项目数据迁移操作指南](./gather-project-data-migration.md)包含项目与负责人盘点、批量预演、迁移、归档和删除步骤。

下文保留通用的部署和单目标项目合并流程。执行时按服务器当前版本和项目盘点结果调整参数。

## 一、先更新应用

### 1. 确认数据库基线

在服务器执行以下只读命令。手工运行过 `psql` 的服务器可能没有完整的 Supabase CLI 迁移历史。

```bash
docker exec -i supabase-db psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f - <<'SQL'
select to_regprocedure('public.get_task_creation_projects()') as project_picker,
       to_regprocedure('public.can_create_own_team_project_task(uuid,uuid)') as legacy_0016_helper,
       to_regprocedure('public.is_task_overdue(text,date)') as overdue_rule_0017,
       to_regprocedure('public.task_group_leaders(uuid)') as team_review_0018,
       to_regprocedure('public.change_project_owner(uuid,uuid,text)') as shared_project_0019;

select table_name, column_name from information_schema.columns
where table_schema = 'public' and (table_name, column_name) in
  (('projects','team_id'), ('projects','legacy_team_id'), ('tasks','planned_work_days'));

select tgname, tgenabled from pg_trigger
where tgrelid = 'public.tasks'::regclass and tgname = 'trg_tasks_schedule_on_resume';
SQL
```

| 迁移 | 变更与核对方式 |
| --- | --- |
| `0016` | 旧项目候选接口、`legacy_0016_helper` 和 `projects.team_id` 应存在。`0018` 会删除该 helper。 |
| `0017` | 待审核排除逾期。此步新增 `overdue_rule_0017`，后续 `0020` 会更新其定义。 |
| `0018` | 仅管理员能创建项目。由任务负责人所属小组的组长审批；有成员身份的多个组长均可能具备权限。核对 `team_review_0018`。 |
| `0019` | 项目解除小组归属，原值保留到 `legacy_team_id`。核对新列、原列消失以及 `shared_project_0019`。所有登录用户在新建任务时可选项目；项目详情和任务可见性仍由角色及人员关系决定。 |
| `0020` | 挂起任务排除逾期。核对 `planned_work_days` 和已启用的恢复触发器。有有效计划日期的开发任务恢复时，按已投入的自然日计算剩余时间，并按需要顺延截止日期。 |

标记与发布记录有出入时，先核对该迁移的函数定义、策略、授权与触发器。若确认已执行到 `0016`，本轮执行 `0017 → 0018 → 0019 → 0020`。若已执行其中一部分，从最后一次成功提交的下一条开始。

### 2. 在 Windows 准备前端和 SQL

工作区现有 `.env` 与目标环境不匹配。先从可信的服务器配置确认完整 `ANON_KEY`，并把目标配置保存到工作区外的 `C:\deploy\gather-172.16.1.84.env` 或自选路径。文件只需要以下变量，密钥值使用服务器实际值。

```dotenv
SUPABASE_URL=http://172.16.1.84:8000
SUPABASE_ANON_KEY=<服务器的完整 ANON_KEY>
ENABLE_TESTING_FEATURES=false
```

`ENABLE_TESTING_FEATURES=false` 隐藏前端测试入口。若该环境仍要使用测试中心，将其设为 `true` 后重建。构建只传入匿名密钥。根据本次已核对的 `0016` 对应提交到 `e4d2293` 的差异，`package.json` 和 `package-lock.json` 未变；本机依赖缺失或无法确认来自当前锁文件时，先执行 `npm ci`。

```powershell
# 在 D:\bucket\gather 执行，先用 git rev-parse HEAD 核对目标提交。
$env:DOTENV_CONFIG_PATH = 'C:\deploy\gather-172.16.1.84.env'
if (!(Test-Path -LiteralPath $env:DOTENV_CONFIG_PATH -PathType Leaf)) { throw '找不到服务器构建配置' }
Remove-Item Env:SUPABASE_URL,Env:SUPABASE_ANON_KEY,Env:ENABLE_TESTING_FEATURES -ErrorAction SilentlyContinue
npm run build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

@'
const fs = require('node:fs');
const { parse } = require('dotenv');
const settings = parse(fs.readFileSync(process.env.DOTENV_CONFIG_PATH));
const files = fs.readdirSync('dist').filter(name => /^main\..+\.js$/.test(name));
if (files.length !== 1) throw new Error('无法定位前端主包');
const bundle = fs.readFileSync(`dist/${files[0]}`, 'utf8');
if (settings.SUPABASE_URL !== 'http://172.16.1.84:8000' ||
    !settings.SUPABASE_ANON_KEY || settings.SUPABASE_ANON_KEY.startsWith('<') ||
    !bundle.includes(settings.SUPABASE_URL) || !bundle.includes(settings.SUPABASE_ANON_KEY)) {
  throw new Error('主包中的 Supabase URL 或匿名密钥与部署配置不符');
}
console.log('已确认服务器 URL 和配置中的完整匿名密钥被打入主包');
'@ | node
if ($LASTEXITCODE -ne 0) { throw '服务器产物校验失败' }

Compress-Archive -Path dist\* -DestinationPath "$env:TEMP\gather-dist-e4d2293.zip" -Force
```

将 ZIP、本次缺失的编号 SQL 和 `project-merge.sql` 上传至服务器 `/tmp/`。最小化前端代码会改写函数名，`createDemoClient` 字样能否搜到无法验证运行模式。以实际登录和请求发往目标 API 为准。

### 3. 备份、迁移、发布

约定维护窗口，暂停前端和 API 的业务写入。在动数据库前记录现有前端版本和备份路径。进入有 Docker 权限的 Bash shell 后执行以下备份命令。

```bash
sudo install -d -m 0700 /var/backups/gather
sudo bash -e -c '
  umask 077
  backup="/var/backups/gather/gather-before-upgrade-$(date +%Y%m%d-%H%M%S).dump"
  docker exec supabase-db pg_dump -U postgres -d postgres -Fc > "$backup"
  test -s "$backup"
  docker exec -i supabase-db pg_restore --list < "$backup" > "$backup.list"
  test -s "$backup.list"
  printf "%s\n" "$backup"
'
```

核对目录清单包含 `public` 与 `auth` 的关键数据。清单检查用于确认备份可读；关键环境应在独立数据库验证恢复。

以下执行块适用于**已核实完整停在 `0016`** 的服务器。若需从别的迁移开始，删去列表中已提交的文件。随附指南记录该服务器须用 `supabase_admin` 执行策略变更。

```bash
(
  set -euo pipefail
  migrations=(
    0017_exclude_pending_review_from_overdue.sql
    0018_project_creation_and_team_task_review.sql
    0019_shared_projects_and_team_task_visibility.sql
    0020_reschedule_paused_tasks.sql
  )
  for file in "${migrations[@]}"; do
    test -s "/tmp/$file"
  done
  for file in "${migrations[@]}"; do
    docker exec -i supabase-db psql -X -U supabase_admin -d postgres \
      -v ON_ERROR_STOP=1 -1 -f - < "/tmp/$file"
    printf 'Committed %s\n' "$file"
  done
)
```

每个文件单独提交。某个文件失败时，先记录报错及此前已提交的编号，再修复并从失败文件继续。迁移完成后复查上面的版本标记，再切换前端。

```bash
(
  set -euo pipefail
  archive=/tmp/gather-dist-e4d2293.zip
  stamp=$(date +%Y%m%d%H%M%S)
  stage=$(sudo mktemp -d /var/www/gather.next.XXXXXX)
  previous="/var/www/gather.bak-$stamp"
  unzip -tq "$archive"
  sudo unzip -q "$archive" -d "$stage"
  sudo test -s "$stage/index.html"
  sudo chmod -R a+rX "$stage"
  sudo chmod a+x "$stage"
  sudo chcon -R -t httpd_sys_content_t "$stage"
  sudo mv -T /var/www/gather "$previous"
  if ! sudo mv -T "$stage" /var/www/gather; then
    sudo mv -T "$previous" /var/www/gather
    exit 1
  fi
  printf 'Previous frontend: %s\n' "$previous"
)
```

前端发布命令沿用现网文档所述的 SELinux 和 `/var/www/gather` 设置。发布后检查以下各项，再开放业务写入。

- 首页返回 `200`。不带密钥访问 `/auth/v1/` 可返回 `401`。使用浏览器强刷并验证能登录、能访问目标 API、能查询现有项目任务。
- 管理员可建项目，普通成员可在共享项目下创建自己的任务，两个组的组长分别审批本组负责人的任务。项目负责人只有同时具备相关组长身份时才能走组长审批。管理员异常代办仍需填写原因。
- 用测试任务验证挂起、恢复后的截止日期及待审核任务的逾期显示。若关闭测试功能，确认旧测试中任务的处置仍有负责人。
- 记录发布提交、SQL 编号、前端备份目录、数据库备份与验证结果。`0019` 已改名 `projects.team_id`，旧前端可能与新库不兼容。若需整版回退，保留现场备份，先在隔离库验证升级前备份及旧前端，再按写入情况决定回退或修复。直接恢复旧备份会覆盖后来写入的数据。

## 二、合并旧项目

### 1. 建目标项目并核对数据

管理员用新版页面为每个类别创建一个进行中的共享项目，填写负责人及计划日期。按「旧项目 UUID → 新项目 UUID」逐组确认。多个旧项目可以汇入一个新项目，同名任务按原 ID 分别保留。参与人、组长审批、任务状态与工时跟随原任务。目标负责人可见汇入的项目任务，旧负责人仍需满足新版可见性规则。

数据库执行以下盘点。`legacy_team_id` 可协助识别旧小组，任务实际归组看任务负责人及组员关系。

```sql
select p.id, p.name, p.status, p.legacy_team_id, d.name as owner,
       p.test_state, p.no_test_status, p.requires_testing,
       (select count(*) from public.tasks t where t.project_id = p.id) as tasks,
       (select count(*) from public.tasks t where t.project_id = p.id and t.status = 'review') as in_review,
       (select count(*) from public.tasks t where t.project_id = p.id and t.work_source = 'legacy_single_test') as legacy_tests,
       (select count(*) from public.test_plans tp where tp.project_id = p.id) as test_plans,
       (select count(*) from public.project_status_events e where e.project_id = p.id) as status_events,
       (select count(*) from public.project_no_test_events e where e.project_id = p.id) as no_test_events,
       (select count(*) from public.task_approval_audits a where a.project_id = p.id) as approvals
from public.projects p join public.developers d on d.id = p.owner_id
order by p.name, p.id;
```

脚本支持开发任务和可一并归并的历史单任务测试记录。若旧项目或目标项目已有测试中心计划、已生效的测试/无需测试状态，或待迁任务出现在测试轮次的范围及整改关系中，先单独梳理。核对 `test_plans → test_cycles → test_cycle_scope_tasks / test_cycle_repair_tasks / test_activities`，为每个计划确认保留还是随项目迁移、活动任务应归何处、并行活动轮次如何处理，以及新项目的测试状态和完成门禁。保留计划、轮次、任务和报告的 ID。旧项目关联 `test_plans` 时，数据库会阻止删除。隐藏测试入口的部署仍可能有这些历史记录。

经确认要迁移整套测试计划时，需要在同一事务内对齐 `test_plans.project_id` 与相关 `tasks.project_id`，同时校验轮次范围和整改任务指向的任务都归于同一项目。测试轮次、活动和报告仍用原计划及轮次 ID。由测试负责人和项目负责人确认合并后的测试结论及是否仍满足免测条件，再处理新项目的 `test_state` 和完成门禁。需要留在原项目的计划应继续保留原项目，待计划处置明确后再清理。

### 2. 演练，提交，再验收

把 `project-merge.sql` 放在服务器 `/tmp/`。先在生产备份恢复出的隔离库试跑。如果隔离库使用不同容器或数据库名，替换命令中的相应参数。生产执行前再做一份**合并前备份**，维护窗口内暂停业务写入。下面函数和变量在同一个 Bash 会话定义，每个类别单独运行。预期数量取自刚确认的旧项目任务总数。UUID 示例必须换成真实值。

```bash
target_id='新项目的 UUID'
source_ids='旧项目1的UUID,旧项目2的UUID'
expected_tasks=12
umask 077
work_log=$(mktemp -d "$HOME/gather-merge.XXXXXX")

run_merge() {
  local operation=$1 apply=$2 expected=$3
  docker exec -i supabase-db psql -X -A -t -U supabase_admin -d postgres \
    -v "operation=$operation" -v "apply=$apply" -v "expected_tasks=$expected" \
    -v "target_id=$target_id" -v "source_ids=$source_ids" -f - \
    < /tmp/project-merge.sql
}

run_merge move false "$expected_tasks" > "$work_log/move-dry-run.log" 2>&1
```

确认退出码为零、日志结尾为 `ROLLBACK`，并核对任务 ID、原项目、目标、各状态的数量。检查列出的无有效组长待审任务，按实际人员关系补齐组长或安排管理员异常代办。确认后执行以下命令。

```bash
run_merge move true "$expected_tasks" > "$work_log/move-commit.log" 2>&1
```

确认退出码为零且日志结尾为 `COMMIT`。脚本只改任务 `project_id` 并由系统更新 `updated_at`，保留任务 UUID、组别、人员、计划、状态及任务级关联，按现有数据库逻辑重算新项目的实际开始时间。它在同一事务内暂时停用专门保护审批状态的触发器，仅用于原样迁移待审核任务，随后恢复并核验字段。迁移不会重新发送既有任务的提交通知。请以组长账号实际查看「待我审批」。旧项目仍可被选来新建任务，即使改为挂起也一样，因此保持写入暂停直到清理完成。

验收新项目的任务 ID 与映射日志一致，按状态和负责人核对条数，并抽查评论、工时、历史测试关联及新项目统计。若发现分组错误，保留旧项目和逐任务映射，先核对写入情况，再用该映射制订精确回迁。多个来源的任务不能按新项目 ID 整批回到某一个旧项目。

### 3. 归档并删除已经清空的旧项目

删除是独立事务。旧项目的状态事件和无需测试事件会随项目删除。任务审批记录仍挂在原任务上，其指向旧项目的外键会置空，旧项目审批历史也不会自动并入新项目的项目级时间线。脚本在删除前输出原项目和相关审计。迁移验收通过后，先把这些记录归档，再提交删除。

```bash
run_merge delete false 0 > "$work_log/delete-dry-run.log" 2>&1
```

确认退出码为零、日志结尾为 `ROLLBACK` 且 `DELETE` 数量吻合。执行以下命令保存归档，检查每个拟删除项目 UUID 均在 `projects` 记录里。归档、映射日志和备份保存在受限位置。

```bash
awk '/^\{/' "$work_log/delete-dry-run.log" > "$work_log/deleted-project-history.jsonl"
test -s "$work_log/deleted-project-history.jsonl"
```

归档核对无误后提交删除。脚本会再次检查旧项目没有任务、测试计划或待处理的无需测试请求，并在发现未识别的项目外键时停止。

```bash
run_merge delete true 0 > "$work_log/delete-commit.log" 2>&1
```

确认 `COMMIT` 与删除数量，从任务下拉框和项目列表确认旧项目已经移除，并再次核对新项目中的任务可访问，最后恢复业务写入。旧项目的详情链接会失效，原任务 ID 仍可用于查找任务。
