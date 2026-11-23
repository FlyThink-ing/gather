# Gather 项目数据迁移操作指南

2026 年 11 月 20 日，Gather 升级到 `0020` 后，在同一个维护窗口把 16 个旧项目中的 227 条任务迁入 11 个新建共享项目。迁移提交后，16 个旧项目经归档和删除预演再正式删除。恢复服务后，管理员登录、11 个项目的列表和任务抽查均已通过。

项目迁移复用 [项目更新](./gather-project-update.md) 中的网关暂停、数据库备份和恢复操作。单独安排迁移窗口时，先重新暂停写入并按最新数据盘点。

## 1. 盘点旧项目和负责人

保持 `supabase-envoy` 暂停、`supabase-db` 运行。通过连接池或数据库直接写入 Gather 的任务也需要暂停。在**服务器 Bash 终端**用下列只读查询盘点项目。

```bash
docker exec supabase-db psql -X -U supabase_admin -d postgres -P pager=off -c "select p.id, p.name, g.name as old_team, p.status, (select count(*) from public.tasks t where t.project_id=p.id) as tasks, (select count(*) from public.tasks t where t.project_id=p.id and t.status='review') as in_review, (select count(*) from public.test_plans tp where tp.project_id=p.id) as test_plans, p.test_state, p.no_test_status from public.projects p left join public.teams g on g.id=p.legacy_team_id order by p.name,g.name,p.id;"
```

用**旧项目 UUID**确认归属。同名旧项目可能来自不同组，`legacy_team_id` 可以帮助识别历史来源。按「目标项目名、负责人账号、源项目 UUID、源项目任务数」确认映射。新项目负责人可以查看汇入该项目的任务；任务审批仍由任务负责人所属小组的组长处理。

查询账号和 Gather 角色时，`admin` 是管理员，`manager` 是组长，`user` 是普通成员。选择 `active` 为 `t` 且有 `developer_id` 的人员作为项目负责人。通过邮箱匹配可以区分同名账号。账号查询结果适合留在受限的运维记录里。

```bash
docker exec supabase-db psql -X -U supabase_admin -d postgres -P pager=off -c "select coalesce(d.name, u.raw_user_meta_data->>'name', u.email) as name, u.email, coalesce(r.role, 'user') as role, d.is_active as active, d.id as developer_id from auth.users u left join public.user_roles r on r.user_id=u.id left join public.developers d on d.user_id=u.id order by role,name,u.email;"
```

本次 16 个旧项目均为进行中，没有待审核任务。业务确认此前没有关联测试任务或项目，预演也通过了测试计划和测试关联检查。若后续批次有测试计划、轮次、测试范围或整改任务，先确认 `test_plans.project_id` 与关联任务的项目归属、测试结论和完成门禁，再设计对应迁移。处置完仍引用旧项目的测试计划后，才能删除旧项目。

### 本次验收基准

| 新项目 | 旧项目数 | 迁入任务数 |
| --- | ---: | ---: |
| EHC 5.0 后端 | 3 | 133 |
| EHC 5.0 前端 | 1 | 5 |
| EHC 4.0 | 2 | 5 |
| U9C | 1 | 1 |
| EHC-APP | 2 | 14 |
| HMES-APP | 1 | 25 |
| Agent应用 | 1 | 2 |
| PLM | 1 | 8 |
| 海昌立库后端 | 1 | 15 |
| 海昌立库前端 | 1 | 1 |
| 日常任务 | 2 | 18 |
| **合计** | **16** | **227** |

11 个目标项目按指定邮箱匹配负责人，统一设为进行中。本次新项目的描述和计划日期留空，原项目的这些字段随旧项目归档。迁移保留原任务 UUID、负责人、小组、状态、任务计划日期以及通过任务 ID 关联的评论和工时。新项目的实际开始时间按现有工时规则计算。同名任务仍各自保留。

## 2. 上传当次批量 SQL

本次使用 `gather-merge-20261120.sql`，本地交付路径是 `C:\deploy\gather-merge-20261120.sql`，服务器执行路径是 `/tmp/gather-merge-20261120.sql`。该文件绑定本次旧项目 UUID、新项目 UUID、负责人邮箱和逐个项目的任务数。后续批次应以最新盘点生成自己的映射和脚本。已有目标项目、逐个合并时，可以使用仓库中的通用 [project-merge.sql](./project-merge.sql)。

把本次 SQL 拷贝到能连服务器的电脑，在**文件所在目录的 Windows PowerShell** 用 `scp` 上传。

```powershell
scp.exe '.\gather-merge-20261120.sql' 'rootet@172.16.1.84:/tmp/'
```

在**服务器 Bash 终端**用 `ls` 确认文件存在且大小大于零。

```bash
ls -lh /tmp/gather-merge-20261120.sql
```

接下来四个阶段均使用同一个文件，区别在 `operation` 和 `apply` 两个参数。每个阶段是一个数据库事务，错误会中止该阶段。

| 阶段 | `operation` | `apply` | 预期事务结果 |
| --- | --- | --- | --- |
| 创建与迁移预演 | `move` | `false` | `ROLLBACK` |
| 正式创建与迁移 | `move` | `true` | `COMMIT` |
| 删除预演及归档 | `delete` | `false` | `ROLLBACK` |
| 正式删除旧项目 | `delete` | `true` | `COMMIT` |

## 3. 在服务器预演创建与迁移

在**服务器 Bash 终端**粘贴整行。预演会尝试创建目标项目、迁移任务、逐项校验后回滚。完整的逐任务映射写入权限受限的日志，终端展示末尾摘要。

```bash
bash -c 'log=$(mktemp "$HOME/gather-merge-preview.XXXXXX") || exit 1; docker exec -i supabase-db psql -X -A -t -U supabase_admin -d postgres -v operation=move -v apply=false -f - < /tmp/gather-merge-20261120.sql > "$log" 2>&1; result=$?; tail -n 15 "$log"; printf "Log: %s\n" "$log"; exit "$result"'
```

核对 11 行项目名称、负责人和任务数。汇总行依次为「目标项目数、旧项目数、目标项目任务数、无项目任务数」。本次预演得到 `11|16|227|0`，最后显示 `ROLLBACK`。16 个原项目及其任务仍处于预演前的状态。

如果提示负责人找不到或未启用，回到人员查询确认邮箱及人员状态。如果提示任务数或项目集合变化，重新盘点并更新映射。如果脚本识别到测试关联，先处置关联。核对通过后再进入正式迁移。

## 4. 备份升级后的数据库

预演通过后、正式迁移前，生成一份**合并前备份**。这份备份包含已经升级到 `0020` 的结构和 16 个旧项目的迁移前数据。保持网关暂停。

```bash
sudo bash -e -c 'umask 077; install -d -m 0700 /var/backups/gather; backup="/var/backups/gather/gather-before-merge-$(date +%Y%m%d-%H%M%S).dump"; docker exec supabase-db pg_dump -U postgres -d postgres -Fc > "$backup"; test -s "$backup"; docker exec -i supabase-db pg_restore --list < "$backup" > "$backup.list"; test -s "$backup.list"; ls -lh "$backup" "$backup.list"; grep -E "TABLE DATA (public (projects|tasks)|auth users) " "$backup.list"'
```

确认 `.dump` 和 `.dump.list` 均非空，且清单包含 `auth.users`、`public.projects`、`public.tasks`。本次文件是 `/var/backups/gather/gather-before-merge-20261120-115947.dump`，约 995 KB。

## 5. 正式创建项目并迁移任务

在**服务器 Bash 终端**执行。命令先确认网关已停止，再一次性创建目标项目和迁移任务。

```bash
bash -c 'test "$(docker inspect -f "{{.State.Status}}" supabase-envoy)" = exited || { echo "Gateway is not stopped"; exit 1; }; log=$(mktemp "$HOME/gather-merge-commit.XXXXXX") || exit 1; docker exec -i supabase-db psql -X -A -t -U supabase_admin -d postgres -v operation=move -v apply=true -f - < /tmp/gather-merge-20261120.sql > "$log" 2>&1; result=$?; tail -n 15 "$log"; printf "Log: %s\n" "$log"; exit "$result"'
```

看到 `Moved 227 tasks`、`11|16|227|0` 和 `COMMIT`，并核对每个项目的任务数。本次 16 个旧项目已清空，仍保留在库里供归档。保存命令输出的 `gather-merge-commit.*` 日志路径，该日志包含原任务到新项目的逐条映射。

`operation=move`、`apply=true` 成功后只能提交一次。聊天中先后给出的两版正式命令执行同一项迁移，后来一版增加了网关状态检查。已有 `COMMIT` 时直接进入归档。终端断开或结果不明时，先查看日志和数据库现状，再决定是否需要执行后续操作。

## 6. 预演删除并保存历史归档

在**服务器 Bash 终端**执行。该命令先模拟删除，确认事务回滚后，再提取 JSON 归档。

```bash
bash -e -c 'umask 077; work=$(mktemp -d "$HOME/gather-archive.XXXXXX"); log="$work/delete-preview.log"; archive="$work/old-projects.jsonl"; docker exec -i supabase-db psql -X -A -t -U supabase_admin -d postgres -v operation=delete -v apply=false -f - < /tmp/gather-merge-20261120.sql > "$log" 2>&1 || { tail -n 25 "$log"; exit 1; }; tail -n 14 "$log"; grep -Fxq ROLLBACK "$log"; grep "^{" "$log" > "$archive"; printf "Archive: %s\nArchived projects: " "$archive"; grep -c "\"table\": \"projects\"" "$archive"'
```

本次看到 `11|0|227|0`、`ROLLBACK`、`Archived projects: 16`。汇总里的旧项目数 `0` 是预演结果，实际库里仍有 16 个旧项目。保存终端输出的归档路径，确认 `old-projects.jsonl` 已生成，项目数量与预期一致。

归档包括旧项目本身、项目状态事件、无需测试事件和相关审计。正式删除时，旧项目状态事件与无需测试事件会随旧项目删除。任务审批记录仍关联原任务，其旧项目外键会置空。查阅原项目的历史时使用归档和备份。

## 7. 正式删除旧项目并核对

确认归档存在并覆盖 16 个项目后，在**服务器 Bash 终端**执行。脚本会再次检查旧项目已清空，以及目标项目负责人和任务数量符合映射。

```bash
bash -c 'test "$(docker inspect -f "{{.State.Status}}" supabase-envoy)" = exited || { echo "Gateway is not stopped"; exit 1; }; log=$(mktemp "$HOME/gather-merge-delete-commit.XXXXXX") || exit 1; docker exec -i supabase-db psql -X -A -t -U supabase_admin -d postgres -v operation=delete -v apply=true -f - < /tmp/gather-merge-20261120.sql > "$log" 2>&1; result=$?; tail -n 15 "$log"; printf "Log: %s\n" "$log"; exit "$result"'
```

本次结果为 `11|0|227|0` 和 `COMMIT`，表示保留 11 个新项目、旧项目剩余 0 个、227 条任务全部保留。记录 `gather-merge-delete-commit.*` 日志路径。旧项目的详情链接会随着删除失效，任务继续用原 UUID 查询。

## 8. 恢复服务并验收

在**服务器 Bash 终端**用下列命令启动网关。

```bash
docker start supabase-envoy
```

在能访问服务器的电脑打开 Gather，按 `Ctrl+F5` 后用管理员账号登录。核对项目列表有 11 个项目，打开 **EHC 5.0 后端**和**日常任务**，确认分别有 **133 条**和 **18 条**任务。此次实际反馈为验收通过，维护结束。

在受限位置保留合并前备份、逐任务映射日志、旧项目 JSON 归档和删除日志。如果需要回迁，依据逐任务映射还原各自的来源项目，并先确认旧项目是否已经删除。如果需要恢复合并前数据库，先确认网关恢复后是否已有新写入，再在隔离库验证备份及回退方案。
