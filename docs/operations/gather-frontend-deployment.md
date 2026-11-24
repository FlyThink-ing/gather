# Gather 前端部署指南

本文适用于更新已有 Nginx 站点的 Gather 前端。发布包只包含 Webpack 生成的静态文件。发布前确认本次前端和回退版本均能使用目标环境现有的 API。

## 1. 核对发布目标

以下参数来自 Gather 的现网更新记录。发布到其他环境时，对照修改配置文件、SSH 目标、站点目录和访问地址。 [项目更新操作指南](./gather-project-update.md)

| 项目 | 现有环境 |
| --- | --- |
| 前端访问地址 | `http://172.16.1.84/` |
| 前端使用的 API 地址 | `http://172.16.1.84:8000` |
| SSH 目标 | `rootet@172.16.1.84` |
| Nginx 站点目录 | `/var/www/gather` |
| Windows 构建配置 | `C:\deploy\gather-172.16.1.84.env` |

在有 Git、Node.js、npm 和 `tar.exe` 的 Windows 电脑构建。在能连通服务器的电脑上传。服务器端使用 Bash，并通过 `sudo` 切换站点目录。执行前核对 Nginx 的实际站点根目录，以及磁盘是否能同时容纳解包文件、新版和旧版站点。

## 2. 在 Windows 构建并打包

### 配置前端连接

首次构建或目标环境配置有变化时，在仓库外创建或更新 `C:\deploy\gather-172.16.1.84.env`。从目标环境的交接配置取得浏览器可访问的 API 地址和公开匿名密钥，按示例填入真实值。三项配置均未变化时可以复用已有文件。

```dotenv
SUPABASE_URL=http://172.16.1.84:8000
SUPABASE_ANON_KEY=<目标环境的完整公开匿名密钥>
ENABLE_TESTING_FEATURES=false
```

`ENABLE_TESTING_FEATURES=false` 隐藏测试入口。需要显示时改为 `true`。这三项在构建时写入前端，变更后需要重新构建。构建配置留在构建电脑，前端凭据使用公开匿名密钥。

### 构建并检查产物

在仓库根目录打开 PowerShell。先执行 `git status --short --branch`，确认当前提交和工作区就是本次发布内容。工作区如果含有本次要发布的未提交变更，将这些变更一并记入发布记录。

首次构建、锁文件有变化或无法确认现有依赖来自当前锁文件时，执行以下命令。

```powershell
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '安装构建依赖失败' }
```

在同一 PowerShell 会话中继续构建。构建失败时先处理报错，看到 `主包校验通过` 后再打包。

```powershell
$revision = git rev-parse --short HEAD
if ($LASTEXITCODE -ne 0) { throw '无法读取当前 Git 提交' }

$env:DOTENV_CONFIG_PATH = 'C:\deploy\gather-172.16.1.84.env'
if (-not (Test-Path -LiteralPath $env:DOTENV_CONFIG_PATH -PathType Leaf)) {
    throw '缺少构建配置文件'
}
Remove-Item Env:SUPABASE_URL,Env:SUPABASE_ANON_KEY,Env:ENABLE_TESTING_FEATURES -ErrorAction SilentlyContinue
$config = Get-Content -LiteralPath $env:DOTENV_CONFIG_PATH -Raw -ErrorAction Stop | ConvertFrom-StringData -ErrorAction Stop
$api = [string]$config['SUPABASE_URL']
$key = [string]$config['SUPABASE_ANON_KEY']
$testing = [string]$config['ENABLE_TESTING_FEATURES']
if ($api -notmatch '^https?://\S+$' -or $api -match 'your-project-ref' -or
    -not $key -or $key -match '^<|your-anon' -or $testing -cnotmatch '^(true|false)$') {
    throw '请检查 API 地址、公开匿名密钥和测试入口开关'
}

npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }

$main = @(Get-ChildItem -LiteralPath '.\dist' -Filter 'main.*.js' -File -ErrorAction Stop)
if ($main.Count -ne 1) { throw '预期 dist 中只有一个 main.*.js' }
$bundle = [IO.File]::ReadAllText($main[0].FullName)
$index = Get-Content -LiteralPath '.\dist\index.html' -Raw -ErrorAction Stop
if (-not ($bundle.Contains($api) -and $bundle.Contains($key) -and $index.Contains('/' + $main[0].Name))) {
    throw '主包校验失败'
}
Write-Output ('主包校验通过：' + $main[0].Name)
```

### 生成 ZIP

在同一 PowerShell 会话中把 `dist` 打包为 ZIP 内的 `site/`。文件名包含提交和构建时间。记下命令输出的 ZIP 路径和上一步的主包文件名。

```powershell
$releaseId = 'gather-frontend-' + $revision + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$releaseDir = Join-Path 'C:\deploy' $releaseId
$package = $releaseDir + '.zip'
if (Test-Path -LiteralPath $package) { throw '发布包已存在' }
New-Item -ItemType Directory -Path $releaseDir -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath '.\dist' -Destination (Join-Path $releaseDir 'site') -Recurse -ErrorAction Stop
tar.exe -a -cf $package -C $releaseDir site
if ($LASTEXITCODE -ne 0) { throw '前端打包失败' }
Get-Item -LiteralPath $package | Select-Object FullName, Length
```

## 3. 上传并解包

在能连接服务器的电脑打开 PowerShell，将 `$package` 设为该电脑上的实际 ZIP 路径。也可以通过 SSH 客户端的 SFTP 功能上传到 `/tmp/`。

```powershell
$package = 'C:\deploy\填写本次ZIP文件名.zip'
$sshTarget = 'rootet@172.16.1.84'
scp.exe $package ($sshTarget + ':/tmp/')
if ($LASTEXITCODE -ne 0) { throw '前端发布包上传失败' }
```

登录服务器，在 Bash 中设置以下变量。`archive` 填实际上传的文件名。解包通过后记下 `release` 输出的目录。后续步骤沿用同一 Bash 会话。重新登录时，重新设置 `site`、`web_url` 和之前记录的 `release`。

```bash
site=/var/www/gather
web_url=http://172.16.1.84/
archive='/tmp/填写本次ZIP文件名.zip'

release=$(mktemp -d /tmp/gather-frontend.XXXXXX) &&
  unzip -tq "$archive" &&
  unzip -q "$archive" -d "$release" &&
  test -s "$release/site/index.html" &&
  printf '解包目录 %s\n' "$release"
```

## 4. 切换 Nginx 静态目录

确认当前首页可访问，并一次只进行一轮发布。下面的命令适用于 `/var/www/gather` 为实际目录的现有站点。它先检查新版首页及主包，再准备完整的新版目录，最后把旧站点移到同级备份目录。两次移动之间存在短暂的静态目录切换间隔。整段复制执行，记下输出中的旧站点备份路径。

```bash
sudo bash -e -s -- "$release/site" "$site" <<'BASH'
source_site=$1
site=$2
shopt -s nullglob
main=("$source_site"/main.*.js)
test -d "$site" && test ! -L "$site" || exit 1
test -s "$site/index.html"
test -s "$source_site/index.html"
test "${#main[@]}" -eq 1
test -s "${main[0]}"
grep -Fq -- "/$(basename -- "${main[0]}")" "$source_site/index.html"

previous="$site.bak-$(date +%Y%m%d%H%M%S)"
test ! -e "$previous"
stage=$(mktemp -d "$site.next.XXXXXX")
cp -R -- "$source_site/." "$stage/"
chmod -R a+rX,go-w "$stage"
if test -e /sys/fs/selinux/enforce; then
  chcon -R --reference="$site" "$stage"
fi
mv -T -- "$site" "$previous"
if ! mv -T -- "$stage" "$site"; then
  mv -T -- "$previous" "$site"
  exit 1
fi
printf '旧站点备份 %s\n' "$previous"
BASH
```

看到旧站点备份路径后，继续验证。命令中途报错时，先确认 `$site` 是否仍可用，并保留命令输出和新旧目录供排查。

## 5. 验证发布

在服务器检查 Nginx 返回的首页是否引用本次主包，并比对 HTTP 下载的主包与发布包中的内容。看到 `主包验证通过` 后再进行浏览器验收。

```bash
expected_dir="$release/site"
bash -e -o pipefail -s -- "$expected_dir" "$web_url" <<'BASH'
expected_dir=$1
web_url=$2
shopt -s nullglob
bundles=("$expected_dir"/main.*.js)
test "${#bundles[@]}" -eq 1
main=$(basename -- "${bundles[0]}")
page=$(curl -fsS --get --data-urlencode "bundle=$main" "$web_url")
if ! grep -Fq -- "/$main" <<< "$page"; then
  printf '首页未引用预期主包 %s\n' "$main" >&2
  exit 1
fi
if ! curl -fsS "${web_url%/}/$main" | cmp -s -- "${bundles[0]}" -; then
  printf '线上主包无法下载或内容不一致 %s\n' "$main" >&2
  exit 1
fi
printf '主包验证通过 %s\n' "$main"
BASH
```

从能访问站点的电脑打开 Gather，按 `Ctrl+F5` 强制刷新。用管理员账号确认登录、项目列表和任务列表可用，再用对应角色检查本次改动涉及的页面和操作。按构建配置确认测试入口是否显示。记录发布的 Git 提交、ZIP 文件名、新主包名、旧站点备份路径和验收结果。

首页返回 `403` 时检查站点目录的读取权限和 SELinux 上下文。首页仍引用旧主包时检查 Nginx 站点根目录和缓存。页面打开但接口请求异常时，在浏览器开发者工具中确认请求地址与构建配置一致，并检查浏览器端的网络错误。

## 6. 回退前端

切换后验收失败且需要回退时，先确认当前站点仍是本次发布版本。将 `previous` 换成第 4 步记录的实际目录。命令会保留被撤下的版本，便于排查。

```bash
site=/var/www/gather
previous='/var/www/gather.bak-填写本次切换输出的时间戳'
sudo bash -e -s -- "$site" "$previous" <<'BASH'
site=$1
previous=$2
test -s "$site/index.html"
test -s "$previous/index.html"
withdrawn="$site.withdrawn-$(date +%Y%m%d%H%M%S)"
test ! -e "$withdrawn"
mv -T -- "$site" "$withdrawn"
if ! mv -T -- "$previous" "$site"; then
  mv -T -- "$withdrawn" "$site"
  exit 1
fi
printf '已回退前端，撤下版本保存在 %s\n' "$withdrawn"
BASH
```

回退后重新执行第 5 步的校验，将首行改为 `expected_dir="$site"`。确认首页引用并提供恢复后的主包，再强制刷新并复验登录、项目列表和任务列表。
