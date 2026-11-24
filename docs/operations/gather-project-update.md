# Gather 项目更新操作指南

在 Windows 构建一个发布包，从能连接服务器的电脑上传。在服务器上先预览待执行的数据库迁移，再在维护窗口备份、迁移并切换前端。每次发布前核对目标代码和服务器。

在构建电脑的 PowerShell 生成 ZIP，在能连通服务器的电脑上传 ZIP。登录服务器后，解包、备份和切换都在远程 Bash 中做。尽量在同一个服务器 Bash 会话里完成，后续命令会继续用到第 1 步的 `DB_CONTAINER`、`gateway`、`site`、`web_url` 和第 3 步生成的 `release`。如果重新连接，需要重新设置这些变量，并把 `release` 指向原来的解包目录。

## 1. 在服务器核对环境和迁移历史

在服务器 Bash 终端设置部署参数。下面是 Gather 现有服务器的配置。同一终端中继续执行后续步骤，目标环境变更时调整这一组值。

```bash
export DB_CONTAINER=supabase-db
gateway=supabase-envoy
site=/var/www/gather
web_url=http://172.16.1.84/
```

运行下面的只读命令，查看服务器的迁移历史。

```bash
docker exec "$DB_CONTAINER" psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -P pager=off \
  -c 'select count(*) as recorded, max(version) as latest_version
      from supabase_migrations.schema_migrations;'
```

`recorded` 是历史表里的记录条数，`latest_version` 是最新登记的迁移编号。这里只需记住最新编号。第 3 步还会核对完整记录，给出本次待执行的文件名。

如果历史表缺失、为空或与既有发布记录不符，先根据部署记录和对应迁移的实际结构核对基线。必要时检查该迁移涉及的函数、字段、授权、策略或触发器，再登记已确认执行的版本。

## 2. 在 Windows 构建发布包

### 首次配置目标环境

更新同一台服务器时，如果已有构建环境文件，且 API 地址、匿名密钥和测试入口设置均未变化，直接跳到[构建并检查前端](#构建并检查前端)，继续使用已有文件。首次配置、配置文件缺失或目标环境变化时，再核对下面的配置。

在服务器 Bash 终端查 Supabase 的 Compose 配置目录和匿名密钥。

```bash
compose_dir=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$DB_CONTAINER")
test -n "$compose_dir" && sudo grep -m 1 '^ANON_KEY=' "$compose_dir/.env"
```

在构建电脑上把以下配置保存到工作区外的环境文件。现有服务器使用 `C:\deploy\gather-172.16.1.84.env`。设置实际的 Supabase API 地址和上一步得到的 `ANON_KEY` 值。配置文件保留在构建电脑，前端使用匿名密钥。

```dotenv
SUPABASE_URL=http://172.16.1.84:8000
SUPABASE_ANON_KEY=<服务器的完整匿名密钥>
ENABLE_TESTING_FEATURES=false
```

### 构建并检查前端

在仓库根目录打开 PowerShell。检查提交和工作区状态，确保它们就是要发布的代码。首次构建或依赖有变化时先运行 `npm.cmd ci`。将 `DOTENV_CONFIG_PATH` 指向现有配置文件。多行粘贴有问题时，可以按段执行。

```powershell
git status --short --branch
$revision = git rev-parse --short HEAD
if ($LASTEXITCODE -ne 0) { throw '无法读取当前 Git 提交' }

$env:DOTENV_CONFIG_PATH = 'C:\deploy\gather-172.16.1.84.env'
if (-not (Test-Path -LiteralPath $env:DOTENV_CONFIG_PATH -PathType Leaf)) { throw '缺少构建配置文件' }
Remove-Item Env:SUPABASE_URL,Env:SUPABASE_ANON_KEY,Env:ENABLE_TESTING_FEATURES -ErrorAction SilentlyContinue
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
```

从本次构建输出读取主包名称，并核对页面引用、API 地址和匿名密钥。校验只输出主包名称。

先看 Webpack 输出的最后几行。上次构建显示 `compiled with 3 warnings`，三条都是包体积提示，构建成功后可以继续校验。若构建报 `ERROR`、退出码非零或主包校验失败，先解决报错，再打包。

```powershell
$config = Get-Content -LiteralPath $env:DOTENV_CONFIG_PATH -Raw | ConvertFrom-StringData
$api = ([string]$config['SUPABASE_URL']).Trim().Trim('"').Trim("'")
$key = ([string]$config['SUPABASE_ANON_KEY']).Trim().Trim('"').Trim("'")
$main = @(Get-ChildItem -LiteralPath '.\dist' -Filter 'main.*.js' -File)
if ($main.Count -ne 1 -or -not $api -or -not $key -or $key.StartsWith('<')) {
    throw '主包、API 地址或匿名密钥缺失'
}
$bundle = [IO.File]::ReadAllText($main[0].FullName)
$index = Get-Content -LiteralPath '.\dist\index.html' -Raw
if (-not ($bundle.Contains($api) -and $bundle.Contains($key) -and $index.Contains('/' + $main[0].Name))) {
    throw '主包校验失败'
}
Write-Output ('主包校验通过：' + $main[0].Name)
```

### 打包本次发布

发布包包含校验过的 `site/`、仓库完整的 `migrations/` 和迁移脚本。看到 `主包校验通过` 后再打包。ZIP 文件名使用当前 Git 提交和构建时间，实际打包内容来自本次构建和工作区。工作区有尚未提交的发布改动时，将这些改动一起记在发布记录中。打包完成后，记下输出 `FullName` 中的 ZIP 路径。

使用 Windows 的 `tar.exe` 生成 ZIP，使包内目录路径使用 `/`，避免 Linux 上的 `unzip` 报路径分隔符警告。

```powershell
$releaseId = 'gather-' + $revision + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$releaseDir = Join-Path 'C:\deploy' $releaseId
$package = $releaseDir + '.zip'
New-Item -ItemType Directory -Path $releaseDir -ErrorAction Stop | Out-Null

$siteDir = Join-Path $releaseDir 'site'
$migrationsDir = Join-Path $releaseDir 'migrations'
$migrateScript = Join-Path $releaseDir 'gather-migrate.sh'
Copy-Item -LiteralPath '.\dist' -Destination $siteDir -Recurse -ErrorAction Stop
Copy-Item -LiteralPath '.\supabase\migrations' -Destination $migrationsDir -Recurse -ErrorAction Stop
$script = Get-Content -LiteralPath '.\scripts\gather-migrate.sh' -Raw
[IO.File]::WriteAllText($migrateScript, $script.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $package) { throw '发布包已存在' }
tar.exe -a -cf $package -C $releaseDir site migrations gather-migrate.sh
if ($LASTEXITCODE -ne 0) { throw '发布包打包失败' }
Get-Item -LiteralPath $package | Select-Object FullName, Length
```

## 3. 上传并预览升级

将上一步生成的 ZIP 拷到能连接服务器的电脑。在该电脑用 SCP 上传 ZIP，也可以通过现有 SSH 客户端的 SFTP 面板上传到 `/tmp/`。用此次 ZIP 的实际路径设置 `$package`。

如果 PowerShell 已经进入 ZIP 所在目录，`$package` 可以写成 `'.\实际文件名.zip'`。ZIP 在其他目录时填它在这台电脑上的完整路径。等 SCP 显示 `100%`、返回提示符且没有报错，再去服务器解包。

```powershell
$package = 'C:\deploy\填写本次ZIP文件名.zip'
$sshTarget = 'rootet@172.16.1.84'
scp.exe $package ($sshTarget + ':/tmp/')
if ($LASTEXITCODE -ne 0) { throw '发布包上传失败' }
```

在服务器 Bash 终端用实际文件名设置 `archive`，再解包到本次发布的专用目录并执行只读预览。

如果 ZIP 按上面命令上传，服务器路径就是 `/tmp/` 加 ZIP 的原文件名。保留 `mktemp` 模板里的六个 `X`，命令会自动替换成随机字符并创建目录，实际路径保存在 `$release`。这一段可以一起执行。任何一步失败，`&&` 后面的步骤都会停止。解包后可用 `echo "$release"` 查看并记下目录。

```bash
archive='/tmp/填写本次ZIP文件名.zip'
release=$(mktemp -d /tmp/gather-release.XXXXXX) &&
  unzip -tq "$archive" &&
  unzip -q "$archive" -d "$release" &&
  bash "$release/gather-migrate.sh" plan "$release/migrations"
```

预览时看两处输出。`Latest recorded version` 应与第 1 步查到的服务器版本一致，`Pending migrations` 应列出本次预期的迁移文件。例如从 `0020` 升到 `0023` 时，应依次列出 `0021`、`0022` 和 `0023`。预览只读取历史表并对照发布包。若本次只有前端变更，预期看到 `No pending migrations.`。如果报错或清单和预期不同，先核对 ZIP 和历史记录，再进入维护窗口。

## 4. 暂停 API 网关并备份

先执行下面两条只读命令，核对网关与数据库属于目标部署。如果该网关也服务其他应用，先协调停机时间。

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
docker inspect -f '{{.Name}} {{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$gateway" "$DB_CONTAINER"
```

在现有服务器上，`docker ps` 应显示 `supabase-envoy` 映射了主机的 `8000` 端口，并且 `supabase-db` 正在运行。`docker inspect` 应显示两个容器的 Compose 工作目录都是 `/opt/gather/supabase`。核对无误、迁移预览通过后，等到维护窗口再暂停直接连接数据库的写入任务，并执行下面两行停止网关。

```bash
docker stop "$gateway" &&
  docker inspect -f '{{.Name}} {{.State.Status}}' "$gateway" "$DB_CONTAINER"
```

现有服务器预期显示 `/supabase-envoy exited` 和 `/supabase-db running`。确认后整段执行备份命令，从 `sudo bash` 复制到末尾单独一行的 `BASH`。

```bash
sudo bash -e -s -- "$DB_CONTAINER" <<'BASH'
db_container=$1
umask 077
install -d -m 0700 /var/backups/gather
backup="/var/backups/gather/gather-before-upgrade-$(date +%Y%m%d-%H%M%S).dump"
test ! -e "$backup"
docker exec "$db_container" pg_dump -U postgres -d postgres -Fc > "$backup"
test -s "$backup"
docker exec -i "$db_container" pg_restore --list < "$backup" > "$backup.list"
test -s "$backup.list"
for item in 'auth users' 'public projects' 'public tasks' 'supabase_migrations schema_migrations'; do
  grep -F "TABLE DATA $item " "$backup.list"
done
ls -lh "$backup" "$backup.list"
BASH
```

备份成功时，应看到账号、项目、任务和迁移历史共四条 `TABLE DATA` 记录，最后列出非空的 `.dump` 和 `.dump.list` 文件。记下 `.dump` 的完整路径。缺少记录或命令报错时，先处理备份问题，再执行迁移。

## 5. 执行待处理的数据库迁移

备份通过后，保持网关暂停，在服务器执行以下命令。脚本重新读取迁移历史，每个文件的 SQL 和版本记录在同一事务中提交。迁移文件应能在事务中执行。

```bash
bash "$release/gather-migrate.sh" apply "$release/migrations"
```

迁移期间出现的 `CREATE FUNCTION`、`GRANT` 等是 SQL 执行输出。重点看 `Committed <文件名>`，它表示该文件及对应版本记录都已提交。如果失败，保留报错和最后一条 `Committed`。修正后用正确的发布包重新执行，脚本会重新计算待执行项。

```bash
bash "$release/gather-migrate.sh" plan "$release/migrations"
```

复查时，`Latest recorded version` 应等于本次目标版本，并且显示 `No pending migrations.`。把最终版本和备份路径记到发布记录，再切换前端。

## 6. 切换前端并核对 Nginx

保持网关暂停。下面命令从本次发布包识别主包并核对页面引用，再将新版复制到站点旁的临时目录。旧站点保留在输出指定的目录。若切换失败，命令会尝试移回旧站点。

从 `sudo bash` 到最后单独一行的 `BASH` 整段复制。保留原样的 `main.*.js`，星号由 Bash 展开为这次构建的主包文件名。

```bash
sudo bash -e -s -- "$release/site" "$site" <<'BASH'
source_site=$1
site=$2
shopt -s nullglob
main=("$source_site"/main.*.js)
test -s "$site/index.html"
test -s "$source_site/index.html"
test "${#main[@]}" -eq 1
test -s "${main[0]}"
grep -Fq "/$(basename -- "${main[0]}")" "$source_site/index.html"

previous="$site.bak-$(date +%Y%m%d%H%M%S)"
test ! -e "$previous"
stage=$(mktemp -d "$site.next.XXXXXX")
cp -a "$source_site/." "$stage/"
chmod -R a+rX "$stage"
if test -e /sys/fs/selinux/enforce; then
  chcon -R --reference="$site" "$stage"
fi
mv -T "$site" "$previous"
if ! mv -T "$stage" "$site"; then
  mv -T "$previous" "$site"
  exit 1
fi
printf 'Frontend switched. Previous directory: %s\n' "$previous"
BASH
```

看到 `Frontend switched. Previous directory: ...` 表示目录切换成功。`Previous directory` 后面是完整旧前端的备份目录，记下这个路径以便回退。如果想确认旧主包的名字，到这个目录的 `index.html` 找它引用的 `main.*.js`。接着检查 Nginx 正在提供的首页。

```bash
main=$(basename -- "$release"/site/main.*.js)
if page=$(curl -fsS --get --data-urlencode "release=$(basename -- "$release")" "$web_url") &&
  printf '%s\n' "$page" | grep -F -- "/$main"; then
  printf 'Verified bundle: %s\n' "$main"
else
  printf 'Could not verify the current frontend bundle: %s\n' "$main" >&2
fi
```

核对时可能会打印整行 HTML，重点看最后的 `Verified bundle: main.…js`。这一行显示当前首页引用的**新版主包**，文件位于 `$site` 指定的站点目录，现有服务器上是 `/var/www/gather`。若看到 `403`，检查站点目录的读取权限与 SELinux 上下文。若返回旧主包，检查 Nginx 的站点目录和缓存。

## 7. 恢复网关并验收

如果同一维护窗口还要迁移项目，保持网关暂停，先完成[项目数据迁移](./gather-project-data-migration.md)。静态页面核对通过后，恢复 API 网关。

```bash
docker start "$gateway"
```

网关启动后，从能访问服务器的电脑打开 Gather，按 `Ctrl+F5` 强制刷新。用管理员账号检查登录、项目和任务列表，再按本次变更检查普通成员的任务创建和组长审批等受影响流程。浏览器验收通过后，本次发布完成。

遇到故障时保留数据库备份、旧前端目录和报错信息。回退前端前核对旧前端与当前数据库的兼容性。恢复数据库备份前，先核对快照之后是否已有业务写入，并在隔离数据库验证恢复。

## 既有服务器的部署记录

2026 年 11 月 20 日，`172.16.1.84` 的 Gather 前端更新到 `dev` 的 `e4d2293`，数据库从 `0016` 升级到 `0020`。当次使用归档 `gather-dist-e4d2293.zip`，主包为 `main.4c5eb6fe9917fc2cabc2.js`，旧站点保存于 `/var/www/gather.bak-20261120100649`。同一维护窗口完成项目数据迁移，恢复网关后确认管理员可登录，并抽查项目和任务。 [当次发布与项目合并记录](./gather-update-and-project-merge.md)

服务器随后初始化了 Supabase 迁移历史表，登记 `0001` 至 `0020` 共 20 条。登记前的结构核对显示 `0021` 至 `0023` 的检查项均未出现。
