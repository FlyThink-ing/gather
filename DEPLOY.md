# Gather 生产环境部署与运维手册

> 适用对象：负责上线的后端/运维同事，默认读者会使用 Linux、SSH 和 Nginx，但**没有接触过 Supabase**。  
> 适用项目：当前仓库的 React 静态前端 + 自托管 Supabase。  
> 文档校对日期：2026-07-13。Supabase 自托管配置会持续更新，实际安装时应同时查看文末官方文档。

---

## 1. 先看结论：这个项目要部署什么

本项目没有传统的 Java/Go/Node 业务后端。浏览器中的 React 前端通过 `@supabase/supabase-js` 调用 Supabase，业务数据、账号、权限、数据库函数和实时通知都在 Supabase 中。

Supabase 不是单个进程，而是一组 Docker 容器：

| 组件 | 作用 | 本项目是否直接使用 |
| --- | --- | --- |
| PostgreSQL | 保存用户、项目、任务、审批、通知等数据 | 是 |
| Auth / GoTrue | 邮箱注册、登录、Session、密码 | 是 |
| PostgREST | 把 PostgreSQL 表和函数变成 REST API | 是 |
| Realtime | 把新通知实时推送给浏览器 | 是 |
| Kong/API Gateway | Supabase 对外统一入口 | 是 |
| Studio | Supabase 管理界面，相当于数据库/账号控制台 | 仅管理员使用 |
| Storage、Functions 等 | 文件和边缘函数 | 当前代码未直接使用，但官方默认栈可能仍会启动 |

推荐的生产拓扑是两个域名、一个入口 Nginx：

```text
用户浏览器
  ├─ https://gather.example.com  ──> Nginx ──> /var/www/gather/current（前端静态文件）
  └─ https://api-gather.example.com ─> Nginx ──> 127.0.0.1:8000 ─> Supabase 容器 ─> PostgreSQL
```

本文后续统一使用：

- `APP_DOMAIN=gather.example.com`：前端域名；
- `API_DOMAIN=api-gather.example.com`：Supabase API/Studio 域名；
- `/opt/gather/app`：本项目源码；
- `/opt/gather/supabase`：Supabase Docker 运行目录；
- `/var/www/gather`：前端发布目录；
- `/var/backups/gather`：本机备份目录。

执行前请把示例域名替换成真实值。不要直接复制 `example.com` 上线。

---

## 2. Supabase 新手必须知道的安全边界

本节非常重要，先理解再操作。

### 2.1 三类凭据不是一回事

| 配置 | 能否放进前端 | 说明 |
| --- | --- | --- |
| `ANON_KEY` / publishable key | **可以** | 浏览器调用 Supabase 的公开项目标识；真正的数据权限由登录身份和 RLS 控制 |
| `SERVICE_ROLE_KEY` / secret key | **绝对不可以** | 可绕过 RLS，泄露后等同数据库管理权限 |
| `POSTGRES_PASSWORD` | **绝对不可以** | 数据库超级用户密码，只能保存在服务器和密码管理器中 |

项目代码读取的前端变量名固定为：

```env
SUPABASE_URL=https://api-gather.example.com
SUPABASE_ANON_KEY=服务器Supabase配置里的ANON_KEY
```

注意：`SUPABASE_ANON_KEY` 虽然名字里有 `ANON`，但用户登录后 Supabase 客户端会自动携带用户 Session；数据库中的 RLS（Row Level Security，行级权限）决定每个用户能读写什么。

### 2.2 Studio 不是业务系统

- `https://gather.example.com` 是员工使用的业务系统。
- `https://api-gather.example.com` 同时承载 API 和 Studio；打开根路径会看到 Supabase 管理界面。
- Studio 可以执行任意 SQL、管理用户和查看数据，只允许运维/后端人员使用，必须设置强密码；条件允许时应在外层再加 VPN、零信任访问或 IP 白名单。

### 2.3 自托管意味着运维责任在我们

自托管 Supabase 不提供云平台托管版的自动备份、PITR、高可用和自动升级。服务器补丁、容器升级、监控、数据库备份、异地备份和恢复演练都由部署方负责。

---

## 3. 上线前交接清单

开始前把下面信息填写完整，密钥类信息应放密码管理器，不要发到群聊或提交 Git。

| 项目 | 值/负责人 | 必须 |
| --- | --- | --- |
| 服务器公网 IP | `________________` | 是 |
| SSH 用户与端口 | `________________` | 是 |
| 操作系统 | 推荐 Ubuntu 22.04/24.04 LTS 64 位 | 是 |
| CPU / 内存 / 磁盘 | 最低 2C/4GB/40GB SSD，推荐 4C/8GB+/80GB+ | 是 |
| 前端域名 `APP_DOMAIN` | `________________` | 是 |
| API 域名 `API_DOMAIN` | `________________` | 是 |
| 代码仓库地址 | `________________` | 是 |
| 确认部署的 Git commit/tag | `________________` | 是 |
| SMTP 服务商、账号、授权码 | `________________` | 正式开放注册时是 |
| 第一个管理员邮箱 | `________________` | 是 |
| 备份的异地存储位置 | `________________` | 是 |
| 告警接收人 | `________________` | 建议 |

云安全组/防火墙只开放：

| 端口 | 来源 | 用途 |
| --- | --- | --- |
| 22（或自定义 SSH 端口） | 仅公司出口 IP / 堡垒机 | 运维登录 |
| 80 | 公网 | Let's Encrypt 验证和跳转 HTTPS |
| 443 | 公网 | 前端和 Supabase HTTPS |

不要向公网开放 `8000`、`8443`、`5432`、`6543`。其中 `8000` 是 Supabase 网关原始 HTTP 端口，`5432/6543` 是数据库连接端口。

---

## 4. 服务器初始化

以下命令默认使用具有 `sudo` 权限的普通用户执行。不要长期直接使用 root 登录。

### 4.1 登录并检查资源

```bash
ssh <SSH_USER>@<SERVER_IP>

cat /etc/os-release
uname -m
free -h
df -h /
date
timedatectl
```

期望：64 位系统、至少 4GB 内存、根盘至少 40GB；生产建议 8GB 以上内存。确保时间同步正常，否则登录 Token 和证书校验会异常。

### 4.2 安装基础软件和 Docker

Docker 官方不建议生产环境使用 convenience script，因此 Ubuntu 按官方 apt 仓库安装：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq openssl nginx certbot python3-certbot-nginx

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker nginx
```

检查：

```bash
sudo docker version
sudo docker compose version
sudo nginx -v
```

可选：把当前部署用户加入 `docker` 组。注意该组近似 root 权限；如果公司安全规范不允许，就继续在 Docker 命令前使用 `sudo`。

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker version
```

后文为便于阅读默认当前用户已加入 `docker` 组；如果没有，请为所有 `docker` 命令添加 `sudo`。

### 4.3 创建目录

```bash
sudo mkdir -p /opt/gather /var/www/gather/releases /var/backups/gather
sudo chown -R "$USER":"$USER" /opt/gather
sudo chmod 700 /var/backups/gather
```

---

## 5. 获取并固定项目源码

有 Git 仓库权限时：

```bash
git clone <GATHER_GIT_URL> /opt/gather/app
cd /opt/gather/app
git fetch --all --tags
git checkout <已确认的commit或tag>
git rev-parse HEAD
```

记录最后一行 commit，交付验收时必须能说明线上运行的是哪个版本。

如果服务器没有 Git 仓库权限，由交付人在本地项目目录把**已提交的目标版本**打包。`git archive` 不会带上未跟踪的 `.env`、`node_modules` 和本地日志：

```powershell
git archive --format=tar.gz -o gather-deploy.tar.gz <已确认的commit或tag>
scp .\gather-deploy.tar.gz <SSH_USER>@<SERVER_IP>:/tmp/
```

然后在服务器解压：

```bash
mkdir -p /opt/gather/app
tar -xzf /tmp/gather-deploy.tar.gz -C /opt/gather/app
rm /tmp/gather-deploy.tar.gz
```

推荐仍通过受控 Git 仓库交付，避免文件缺失和版本不可追踪。使用压缩包交付时，前端发布目录名会标记为 `manual`，应在上线记录中单独写明源 commit。

检查本项目关键文件：

```bash
cd /opt/gather/app
test -f package-lock.json
test -f webpack.config.js
ls -1 supabase/migrations/*.sql
```

迁移文件必须完整显示 `0001_init.sql` 到 `0011_fix_test_conclusion_and_construction_summary.sql`。

---

## 6. 安装 Supabase（首次安装）

### 6.1 获取官方 Docker 配置

不要使用本项目 `scripts/generate-keys.js` 作为新生产环境的首选安装方式。它只生成旧式 `JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY`；当前官方自托管栈还会生成其他服务密钥和新版 Auth 签名材料。新安装统一使用 Supabase 官方脚本。

```bash
cd /opt/gather
git clone --depth 1 https://github.com/supabase/supabase.git supabase-upstream
mkdir supabase
cp -a supabase-upstream/docker/. supabase/
cd supabase
cp .env.example .env

sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
```

记录这次使用的 Supabase 上游 commit，后续升级和回滚会用到：

```bash
git -C /opt/gather/supabase-upstream rev-parse HEAD
```

官方脚本会更新 `.env`，第二个脚本还可能更新 Compose 配置。不要把 `/opt/gather/supabase/.env` 提交到 Git。

### 6.2 配置 `.env`

先限制权限，再编辑：

```bash
cd /opt/gather/supabase
chmod 600 .env
nano .env
```

至少逐项检查并修改以下配置。变量在不同 Supabase 版本中的排列可能不同，以当前 `.env.example` 为准，不要删除不认识的变量。

```env
# 数据库和 Studio：官方脚本已生成随机值，确认不是示例值即可
POSTGRES_PASSWORD=<强随机密码；建议只用字母数字以避免连接串转义问题>
DASHBOARD_USERNAME=<不要继续用默认admin，改成内部专用用户名>
DASHBOARD_PASSWORD=<强随机密码；按当前官方要求至少包含字母>

# 对外地址：API_EXTERNAL_URL 必须包含 /auth/v1
SUPABASE_PUBLIC_URL=https://api-gather.example.com
API_EXTERNAL_URL=https://api-gather.example.com/auth/v1
SITE_URL=https://gather.example.com
ADDITIONAL_REDIRECT_URLS=https://gather.example.com

# 邮箱账号登录
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
DISABLE_SIGNUP=false

# 正式环境 SMTP；变量值按邮件服务商提供的信息填写
SMTP_ADMIN_EMAIL=noreply@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=noreply@example.com
SMTP_PASS=<SMTP授权码，不是邮箱网页登录密码>
SMTP_SENDER_NAME=Gather
```

说明：

- `SITE_URL` 是业务前端地址，不是 Supabase 地址；邮箱确认完成后会回到这里。
- `API_EXTERNAL_URL` 是 Auth 生成确认链接时使用的公开地址，漏掉 `/auth/v1` 会导致确认链接错误。
- 生产环境建议 `ENABLE_EMAIL_AUTOCONFIRM=false`，必须通过邮件确认。若 SMTP 暂时不可用，可在仅限内部验收的短时间内设为 `true`，创建完管理员后立即改回并重启 Auth；不允许把这个临时状态当作正式配置。
- 如果只允许管理员创建账号，可以在所有账号创建完后设置 `DISABLE_SIGNUP=true`；此时前端“注册”会返回禁止注册，这是预期行为。

检查所有示例值是否已清理：

```bash
grep -nE 'your-super-secret|your_password|example\.com|localhost' .env
```

这条命令正常情况下不应输出仍在生效的关键配置。不要把 `.env` 全文贴到工单、聊天或 CI 日志。

### 6.3 把内部端口限制在本机

前端只通过 Nginx 的 443 访问 Supabase，不需要公网访问原始端口。编辑：

```bash
nano /opt/gather/supabase/docker-compose.yml
```

找到 API Gateway（当前默认通常是 `kong`）的 `ports`，将宿主机监听地址限制为 `127.0.0.1`，形式如下：

```yaml
ports:
  - 127.0.0.1:${KONG_HTTP_PORT}:8000/tcp
  - 127.0.0.1:${KONG_HTTPS_PORT}:8443/tcp
```

再找到 Supavisor/数据库连接池对外的 `5432` 和 `6543` 映射，同样绑定 `127.0.0.1`，或在确定不需要宿主机数据库连接时移除其 `ports`。示例：

```yaml
ports:
  - 127.0.0.1:${POSTGRES_PORT}:5432
  - 127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543
```

不同版本的 service 名和变量名可能变化，不要机械粘贴整段；原则是最终 `8000/8443/5432/6543` 只能监听 `127.0.0.1`。

先验证 Compose 文件：

```bash
cd /opt/gather/supabase
docker compose config --quiet
```

没有输出且退出码为 0 才继续。

### 6.4 启动并检查 Supabase

```bash
cd /opt/gather/supabase
docker compose pull
docker compose up -d --wait
docker compose ps
```

所有核心服务应为 `Up`，带健康检查的服务应显示 `healthy`。再检查端口：

```bash
sudo ss -lntp | grep -E ':(8000|8443|5432|6543)\b'
curl -i http://127.0.0.1:8000/auth/v1/
```

期望：端口监听地址是 `127.0.0.1`，Auth 请求返回 `401`（说明路由可达，只是没有携带 API key）。如果显示 `0.0.0.0` 或 `[::]`，先修正 Compose 端口再继续。

常用日志：

```bash
cd /opt/gather/supabase
docker compose logs --tail 100 db
docker compose logs --tail 100 auth
docker compose logs --tail 100 kong
docker compose logs --tail 100 realtime
```

---

## 7. 初始化 Gather 数据库

### 7.1 为什么必须按顺序执行

`supabase/migrations` 中的 SQL 不只是建表，还包含 RLS、业务触发器、RPC、审批规则和项目驾驶舱。后一个文件依赖前一个文件，必须严格执行：

```text
0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010 → 0011
```

这些脚本不是为反复执行设计的。新数据库只执行一次；已存在数据库升级时只执行尚未执行的新编号。不要看到报错后从 `0001` 全部重跑。

### 7.2 执行迁移

先确认这是空的新业务库：

```bash
docker exec supabase-db psql -U postgres -d postgres -Atc "select to_regclass('public.projects');"
```

新库应输出空行。如果输出 `projects`，说明业务表已经存在，停止操作，先确认当前迁移版本和备份。

对全新数据库执行：

```bash
cd /opt/gather/app

for file in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  echo "Applying $file"
  docker exec -i supabase-db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 < "$file" || exit 1
done
```

关键参数：

- `ON_ERROR_STOP=1`：任何 SQL 报错立即停止；
- `-1`：每个文件放在单独事务里，该文件失败就整体回滚；
- 任何一个文件失败，都不要继续后面的文件，先保存完整错误日志并排查。

### 7.3 启用通知实时推送

前端 `NotificationBell` 使用 `postgres_changes` 监听 `public.notifications` 的新增记录，因此必须把该表加入 `supabase_realtime` publication。下面 SQL 可安全检查后再添加：

```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;
SQL
```

### 7.4 验证数据库结构

```bash
docker exec supabase-db psql -U postgres -d postgres -P pager=off -c "
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;"

docker exec supabase-db psql -U postgres -d postgres -P pager=off -c "
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'projects'
  and column_name in ('actual_started_at','completed_at')
order by column_name;"

docker exec supabase-db psql -U postgres -d postgres -Atc "
select count(*)
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename='notifications';"
```

期望：

- 表清单包含 `projects`、`tasks`、`test_plans`、`test_cycles`、`test_activities`、`test_execution_batches`、`test_construction_works`、`task_approval_audits`、`project_status_events` 等；
- 第二条输出 `actual_started_at` 和 `completed_at`，证明 `0008` 已执行；另应确认 `0010_internal_test_project_candidates.sql` 和 `0011_fix_test_conclusion_and_construction_summary.sql` 已执行，`get_eligible_internal_test_projects(text)` 可被 `authenticated` 调用，且测试结论终态与测试建设详情聚合已更新；
- 第三条输出 `1`，证明实时通知已启用。

---

## 8. 构建和发布前端

### 8.1 写入生产构建变量

本项目通过 Webpack 在**构建时**把 `.env` 写入 JS；修改 `.env` 后必须重新 `npm run build`，只重启 Nginx没有作用。

从 Supabase 配置中取出客户端需要的 `ANON_KEY`：

```bash
cd /opt/gather/supabase
grep '^ANON_KEY=' .env
```

该值可以进入前端，但仍不要在群聊中传播整份 `.env`。然后编辑项目变量：

```bash
cd /opt/gather/app
touch .env
chmod 600 .env
nano .env
```

内容只能是：

```env
SUPABASE_URL=https://api-gather.example.com
SUPABASE_ANON_KEY=<上一步ANON_KEY等号后面的完整值>
```

严禁写入 `SERVICE_ROLE_KEY`、`SUPABASE_SECRET_KEY` 或 `POSTGRES_PASSWORD`。

### 8.2 用 Node 容器构建

服务器不必全局安装 Node。使用固定主版本的官方 Node 容器，并根据 `package-lock.json` 执行可复现安装：

```bash
cd /opt/gather/app

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_cache=/tmp/.npm \
  -v "$PWD:/app" \
  -w /app \
  node:22-bookworm-slim \
  sh -lc 'npm ci && npm run typecheck && npm run build'
```

检查产物：

```bash
test -f dist/index.html
find dist -maxdepth 2 -type f -printf '%P\n' | sort
grep -R "your-project-ref\|your-anon-public-key" dist && echo "ERROR: 仍包含占位配置" || true
```

如果 `typecheck` 或 `build` 失败，不得继续上线旧的 `dist`。

### 8.3 原子发布静态文件

```bash
cd /opt/gather/app
RELEASE="$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo manual)"

sudo mkdir -p "/var/www/gather/releases/$RELEASE"
sudo cp -a dist/. "/var/www/gather/releases/$RELEASE/"
sudo chmod -R a+rX "/var/www/gather/releases/$RELEASE"
sudo ln -s "/var/www/gather/releases/$RELEASE" /var/www/gather/current.new
sudo mv -Tf /var/www/gather/current.new /var/www/gather/current
readlink -f /var/www/gather/current
```

使用版本目录和原子切换，可以在更新时避免先删线上目录造成的空窗，也便于秒级回滚。

---

## 9. 配置 Nginx 和 HTTPS

### 9.1 DNS

在域名服务商处添加两条 A 记录：

```text
gather.example.com      -> <SERVER_IP>
api-gather.example.com  -> <SERVER_IP>
```

等待解析生效后检查：

```bash
getent hosts gather.example.com
getent hosts api-gather.example.com
```

两者都应返回当前服务器 IP。

### 9.2 Nginx 配置

创建配置：

```bash
sudo nano /etc/nginx/sites-available/gather.conf
```

写入以下内容并替换两个域名：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name gather.example.com;

    root /var/www/gather/current;
    index index.html;

    location = /index.html {
        add_header Cache-Control "no-store" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}

server {
    listen 80;
    listen [::]:80;
    server_name api-gather.example.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

`Upgrade/Connection` 和较长超时用于 Realtime WebSocket，不要删除。

启用并检查：

```bash
sudo ln -s /etc/nginx/sites-available/gather.conf /etc/nginx/sites-enabled/gather.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 9.3 申请证书

确认云安全组已开放 80/443 且 DNS 生效，然后：

```bash
sudo certbot --nginx \
  -d gather.example.com \
  -d api-gather.example.com \
  --redirect \
  --agree-tos \
  -m <运维邮箱>
```

验证证书自动续期：

```bash
sudo certbot renew --dry-run
```

验证公网入口：

```bash
curl -I https://gather.example.com
curl -i https://api-gather.example.com/auth/v1/
```

期望：前端返回 `200`；Auth 返回 `401`，这表示 API 已通过 HTTPS 到达，不是故障。

---

## 10. 创建第一个管理员

### 10.1 先注册普通账号

1. 打开 `https://gather.example.com`。
2. 使用“上线前交接清单”中的管理员邮箱注册。
3. 当 `ENABLE_EMAIL_AUTOCONFIRM=false` 时，必须在邮箱中点击确认链接。
4. 先正常登录一次，确认注册触发器已经创建 `profiles`、`user_roles`、`developers` 三类记录。

如果收不到邮件，不要直接反复注册。先查看 Auth 日志：

```bash
cd /opt/gather/supabase
docker compose logs --tail 200 auth
```

### 10.2 在数据库中提升为 admin

将邮箱替换为实际管理员邮箱：

```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
update public.user_roles
set role = 'admin', updated_at = now()
where user_id = (
  select id
  from auth.users
  where lower(email) = lower('admin@example.com')
);

select u.email, r.role, d.name
from auth.users u
join public.user_roles r on r.user_id = u.id
left join public.developers d on d.user_id = u.id
where lower(u.email) = lower('admin@example.com');
SQL
```

期望第二条查询返回一行且 `role=admin`。然后退出业务系统并重新登录，检查侧边栏是否出现管理员功能。

不要通过前端构建变量、关闭 RLS 或使用 `service_role` 冒充管理员。

---

## 11. 上线验收清单

只有全部通过才能宣布上线。

### 11.1 基础设施

- [ ] `docker compose ps` 核心容器均为 `Up/healthy`。
- [ ] `nginx -t` 通过，Nginx 正常运行。
- [ ] 前端和 API 域名 HTTPS 证书有效，HTTP 自动跳转 HTTPS。
- [ ] 公网只能访问 22（受限）、80、443。
- [ ] `8000/8443/5432/6543` 只监听 `127.0.0.1`。
- [ ] Supabase `.env` 权限为 `600`，没有提交到 Git。
- [ ] 已记录 Gather commit 和 Supabase upstream commit。

### 11.2 业务功能

- [ ] 注册、邮件确认、登录、退出正常。
- [ ] 管理员登录后能看到“小组管理”“权限管理”等管理员入口。
- [ ] 创建开发人员、小组、项目、任务正常。
- [ ] 任务状态流转、提交测试、测试结论、项目负责人审批正常。
- [ ] 项目驾驶舱能打开，项目列表/任务列表无 RPC 错误。
- [ ] 新通知无需手动刷新即可出现；浏览器 WebSocket 连接无持续报错。
- [ ] 普通用户不能执行管理员操作，证明 RLS/触发器生效。

### 11.3 数据和恢复能力

- [ ] 已成功生成一次数据库备份。
- [ ] 备份已经复制到服务器之外的位置。
- [ ] 已记录恢复负责人、恢复命令和最近一次恢复演练日期。
- [ ] SMTP、证书续期、磁盘空间和容器健康有告警接收人。

---

## 12. 日常发布、回滚和配置变更

### 12.1 更新前端

```bash
cd /opt/gather/app
git fetch --all --tags
git checkout <新commit或tag>

# 确认 .env 仍然是生产 API 地址后，重复第 8.2 和 8.3 节
```

前端发布不需要重启 Supabase。发布后执行第 11.2 节的核心冒烟测试。

### 12.2 回滚前端

查看发布目录和当前版本：

```bash
ls -1dt /var/www/gather/releases/* | head
readlink -f /var/www/gather/current
```

切换到上一个已验证版本：

```bash
OLD_RELEASE=/var/www/gather/releases/<上一个版本目录>
sudo ln -s "$OLD_RELEASE" /var/www/gather/current.rollback
sudo mv -Tf /var/www/gather/current.rollback /var/www/gather/current
curl -I https://gather.example.com
```

### 12.3 修改 Supabase `.env`

修改前备份配置：

```bash
cd /opt/gather/supabase
cp -a .env ".env.backup.$(date +%Y%m%d%H%M%S)"
nano .env
docker compose config --quiet
docker compose up -d --wait
```

Auth/SMTP 配置未生效时可只重建相关服务：

```bash
docker compose up -d --force-recreate auth
docker compose logs --tail 100 auth
```

### 12.4 执行新的业务迁移

上线新迁移前：

1. 备份数据库；
2. 阅读 SQL，确认它依赖的上一编号已执行；
3. 在预发布/恢复演练环境执行；
4. 使用 `psql -v ON_ERROR_STOP=1 -1` 单文件执行；
5. 验证后再发布依赖新结构的前端。

数据库变更通常应先于前端发布，并保持向后兼容。不要在高峰期直接用 Studio 手工改生产表结构。

---

## 13. 备份与恢复

### 13.1 每日逻辑备份

创建脚本：

```bash
sudo nano /usr/local/sbin/backup-gather.sh
```

内容：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR=/var/backups/gather
STAMP=$(date +%Y%m%d-%H%M%S)
TMP="$BACKUP_DIR/gather-$STAMP.dump.tmp"
FINAL="$BACKUP_DIR/gather-$STAMP.dump"

install -d -m 700 "$BACKUP_DIR"
docker exec supabase-db pg_dump \
  -U postgres \
  -d postgres \
  -Fc > "$TMP"

test -s "$TMP"
mv "$TMP" "$FINAL"
sha256sum "$FINAL" > "$FINAL.sha256"

# 本机保留 14 天；异地备份应有更长保留策略
find "$BACKUP_DIR" -type f -name 'gather-*.dump' -mtime +14 -delete
find "$BACKUP_DIR" -type f -name 'gather-*.dump.sha256' -mtime +14 -delete
```

授权并试跑：

```bash
sudo chmod 700 /usr/local/sbin/backup-gather.sh
sudo /usr/local/sbin/backup-gather.sh
sudo ls -lh /var/backups/gather
sudo pg_restore --list /var/backups/gather/<刚生成的文件>.dump | head
```

如果宿主机没有 `pg_restore`，安装与容器 PostgreSQL 主版本兼容的客户端，或在同版本 PostgreSQL 容器中检查。备份文件必须同步到对象存储/NAS/另一台服务器；只放在同一块系统盘不算备份。

可用 root crontab 每天 02:30 执行：

```bash
sudo crontab -e
```

```cron
30 2 * * * /usr/local/sbin/backup-gather.sh >> /var/log/backup-gather.log 2>&1
```

### 13.2 Storage 备份

当前 Gather 代码未直接使用 Supabase Storage。如果未来增加附件功能，数据库 dump 只包含 Storage 元数据，不包含实际文件；必须额外备份 `/opt/gather/supabase/volumes/storage` 或配置的 S3 bucket。

### 13.3 恢复原则

恢复是高风险操作，正式库执行前必须：

1. 停止业务写入并公告维护窗口；
2. 再做一份故障现场备份；
3. 在隔离环境验证 dump 完整性；
4. 使用与备份兼容的 PostgreSQL/Supabase 版本；
5. 明确是恢复到新库还是覆盖原库；
6. 恢复后检查 Auth 用户、RLS、RPC、Realtime publication 和管理员角色。

不要把下面命令直接对生产库执行。推荐先在一套新 Supabase 环境中演练：

```bash
docker exec -i supabase-db \
  pg_restore -U postgres -d postgres --clean --if-exists \
  < <备份文件>.dump
```

恢复中遇到 Supabase 系统 schema、扩展或角色冲突时应停止，依据完整错误和对应版本制定恢复方案，不能通过删除系统 schema 强行继续。

---

## 14. Supabase 升级原则

Supabase Docker Compose 是一组经过配套测试的镜像和配置。不要只把某个容器改成 `latest`，也不要无备份执行“拉最新镜像并重启”。

升级流程：

1. 阅读官方 Self-hosted changelog 和目标版本说明；
2. 记录当前 `/opt/gather/supabase-upstream` commit、Compose 配置和镜像版本；
3. 完成数据库和 Storage（如使用）备份；
4. 在预发布/恢复演练环境复制生产数据并升级；
5. 拉取新的上游 Docker 配置，与当前 `/opt/gather/supabase` 做 diff；
6. 手工合并新变量和 Compose 变更，保留本项目的域名、密钥及本机端口绑定；
7. `docker compose config --quiet`、`docker compose pull`、维护窗口内重建；
8. 执行完整验收；失败则回退配置/镜像，并按既定数据库恢复方案处理。

```bash
cd /opt/gather/supabase-upstream
git pull --ff-only
git rev-parse HEAD

diff -ru \
  --exclude=.env \
  /opt/gather/supabase \
  /opt/gather/supabase-upstream/docker | less
```

这里的 `diff` 只用于评估，不要直接用上游目录覆盖生产目录。

---

## 15. 常见故障排查

### 15.1 页面显示演示数据，任意账号都能登录

原因：生产构建没有读到真实 `.env`，代码自动进入了 demo mode。

处理：

```bash
cd /opt/gather/app
grep '^SUPABASE_' .env
```

确认不是 `your-project-ref` / `your-anon-public-key`，然后重新执行构建和原子发布。只修改服务器 `.env` 不会改变已经生成的 JS。

### 15.2 页面能打开，但登录报 `Failed to fetch` / CORS / 网络错误

按顺序检查：

```bash
curl -i https://api-gather.example.com/auth/v1/
curl -i http://127.0.0.1:8000/auth/v1/
cd /opt/gather/supabase && docker compose ps
docker compose logs --tail 100 kong auth
```

再在浏览器开发者工具 Network 中确认请求确实发往生产 `API_DOMAIN`，证书有效且没有 Mixed Content。

### 15.3 注册成功但收不到确认邮件

```bash
cd /opt/gather/supabase
docker compose logs --tail 200 auth
grep -E '^(SITE_URL|API_EXTERNAL_URL|SMTP_|ENABLE_EMAIL_AUTOCONFIRM)' .env
```

常见原因：SMTP 授权码错误、465/587 与 TLS 模式不匹配、发件域名未验证、云厂商封禁出站 25 端口、`API_EXTERNAL_URL` 写错。不要把 SMTP 密码贴到公开日志。

### 15.4 登录成功，但表查询是 401/403 或空数据

- 确认 `0002_functions_rls.sql` 及后续迁移成功；
- 确认注册触发器为该用户创建了 `user_roles` 和 `developers`；
- 不要通过禁用 RLS 解决；
- 用 Studio/psql 检查用户角色和相关 RLS policy。

### 15.5 通知列表能刷新，但没有实时弹出

```bash
docker exec supabase-db psql -U postgres -d postgres -c "
select * from pg_publication_tables
where pubname='supabase_realtime' and tablename='notifications';"

cd /opt/gather/supabase
docker compose logs --tail 200 realtime
```

确认 Nginx 保留 WebSocket `Upgrade` 头，浏览器中 Realtime WebSocket 没有被公司代理拦截。

### 15.6 `docker compose ps` 有容器 restarting/unhealthy

```bash
cd /opt/gather/supabase
docker compose ps
docker compose logs --tail 200 <service-name>
df -h
free -h
```

常见原因是 `.env` 仍有占位值、密钥被截断、数据库密码包含未正确转义字符、内存/磁盘不足、端口占用。修正后用 `docker compose up -d --force-recreate <service-name>`，不要先删除 volume。

### 15.7 SQL 迁移执行失败

- 当前文件因 `-1` 已整体回滚，可以修正根因后只重试该文件；
- 保存完整的第一个错误，不要只截最后一行；
- 确认前一个编号已成功；
- 如果曾经不用 `-1` 手工执行过，数据库可能处于半迁移状态，应从备份恢复或由熟悉 PostgreSQL 的同事检查，不能盲目重跑全部文件。

### 15.8 磁盘突然增长

```bash
df -h
docker system df
sudo du -xh /opt/gather/supabase /var/backups/gather /var/lib/docker 2>/dev/null | sort -h | tail -30
```

先判断是数据库、容器日志、镜像还是备份增长。不要执行 `docker compose down -v`；`-v` 会删除卷和数据。

---

## 16. 仅 IP / 内网临时验收方案

没有域名和可信 HTTPS 时，只适合短期内网验收，不建议公网正式上线。可以临时使用：

```env
SUPABASE_PUBLIC_URL=http://<SERVER_IP>:8000
API_EXTERNAL_URL=http://<SERVER_IP>:8000/auth/v1
SITE_URL=http://<SERVER_IP>
```

前端：

```env
SUPABASE_URL=http://<SERVER_IP>:8000
SUPABASE_ANON_KEY=<ANON_KEY>
```

这种方案需要开放 80/8000，Studio 与 API 也暴露在 8000 上；必须用安全组将 8000 限制到测试人员出口 IP，并设置 Studio 强密码。完成域名和证书后要立即切换到第 9 节拓扑、重新构建前端并关闭公网 8000。

---

## 17. 严禁执行的操作

- 禁止把 `.env`、数据库 dump、SMTP 授权码提交到 Git 或发到群聊。
- 禁止把 `SERVICE_ROLE_KEY`、secret key 或 `POSTGRES_PASSWORD` 写进前端。
- 禁止关闭 RLS 来“解决权限问题”。
- 禁止公网开放数据库端口。
- 禁止无备份升级 Supabase 或执行新迁移。
- 禁止在不理解影响时执行 `docker compose down -v`、`sh reset.sh`、删除 `volumes/db/data`。
- 禁止用 `latest` 漂移升级单个 Supabase 镜像。
- 禁止在生产库盲目重复执行 `0001` 到 `0010`。

---

## 18. 官方参考资料

- [Supabase：使用 Docker 自托管](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase：自托管与托管版差异、运维责任](https://supabase.com/docs/guides/self-hosting)
- [Supabase：自托管反向代理与 HTTPS](https://supabase.com/docs/guides/self-hosting/self-hosted-proxy-https)
- [Supabase：Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase：新版自托管 API/Auth 密钥](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)
- [Docker：Ubuntu 安装 Docker Engine](https://docs.docker.com/engine/install/ubuntu/)

当官方文档与本文在 Supabase 容器名、环境变量或 Compose 文件结构上不一致时，以**本次下载的官方 `.env.example`、Compose 文件和官方文档**为准，同时保持本项目不可变的要求：前端变量名、`0001→0010` 迁移顺序、通知 Realtime publication、RLS、安全端口和备份策略。
