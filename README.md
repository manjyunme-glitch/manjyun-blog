# ManJyun Blog

轻量自托管个人博客系统，用来替代当前目录中的旧 Ghost 部署。旧的 `manjyun-theme/` 被保留为视觉参考，新系统不依赖 Ghost。

## 本地开发

```powershell
npm install
npm run dev
```

访问：

- 公共站点：`http://localhost:3000`
- 首次设置：`http://localhost:3000/admin/setup`

## Docker 部署

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少确认 STACK_BASE_DIR 与 SITE_URL
docker compose config
docker compose up --build
```

访问：`http://localhost:4482`

持久化目录：

- `data/`：SQLite 数据库和本地认证 secret
- `uploads/`：上传的图片、音频和附件

## 升级现有部署

现有 `data/` 与 `uploads/` 可以直接用于新版。内容类型的数据库 ID 仍是
`post`、`project`、`page`；“随笔”只是 `post` 的新显示名称，旧链接和数据不需要转换。
启动时会自动执行向后兼容的 schema 迁移，并且只会把仍等于旧默认值的
`All Posts / 按时间倒序浏览博客文章。` 更新为“随笔”文案，不会覆盖自定义设置。

升级前请先停止应用容器，再完整备份 `data/` 和 `uploads/` 两个目录。SQLite 使用
WAL 模式时，尚未 checkpoint 的内容可能仍在 `manjyun.sqlite-wal` 中；不要在容器运行时
只复制 `manjyun.sqlite`。同时保留 `data/auth-secret`、一次性初始化令牌及其消费标记；
如果环境变量中显式设置过 `AUTH_SECRET`，新版也必须继续使用相同值。仓库提供默认拒绝
覆盖、带 dry-run 和恢复前备份的离线脚本，完整步骤见
[`docs/backup-and-restore.md`](docs/backup-and-restore.md)。

Windows Docker 主机可将 `STACK_BASE_DIR` 写成父目录的正斜杠路径，例如
`E:/manjyun-blog`，对应结构应为 `E:/manjyun-blog/data` 与
`E:/manjyun-blog/uploads`。Linux / NAS 部署必须改用 Docker 主机实际可访问的路径。

## NAS / Portainer 部署

本仓库可以直接作为 Portainer Git Stack 部署。运行数据放在 NAS 本地目录，不跟随 GitHub 更新覆盖。

1. 在 NAS 上创建持久化目录：

```bash
mkdir -p /share/DockerData/manjyun-blog/data
mkdir -p /share/DockerData/manjyun-blog/uploads
chown 1001:1001 \
  /share/DockerData/manjyun-blog/data \
  /share/DockerData/manjyun-blog/uploads
chmod 0750 \
  /share/DockerData/manjyun-blog/data \
  /share/DockerData/manjyun-blog/uploads
```

以上命令只调整两个新建的空目录，不会递归扫描数据。若 NAS 通过管理界面或 ACL 管理
权限，请用等价方式把这两个目录的读写权限授予数值 UID/GID `1001:1001`。

2. 准备环境变量。

从仓库里的 `stack.env.example` 复制一份到本地，按注释填入真实值。至少需要确认：

- `STACK_BASE_DIR=/share/DockerData/manjyun-blog`
- `BLOG_UID=1001`、`BLOG_GID=1001`：新部署默认使用镜像内非 root 用户；目录权限必须与之匹配
- `BLOG_PORT=4482`
- `SITE_URL`：公开访问地址，生产环境建议填 HTTPS 域名
- `SESSION_COOKIE_SECURE`：HTTPS 访问可留空；如果只用 `http://NAS_IP:4482` 访问后台，设置为 `false`
- `GITHUB_REPOSITORY` / `GITHUB_BRANCH`：后台“检查 GitHub 更新”用于查询远端提交，默认是本仓库 `main`；构建期也会用它们在 `.git` 不可用时兜底写入 `.build-info.json`
- `GIT_COMMIT`：当前 Docker 构建对应的提交 SHA。留空时 Docker 构建会尝试从构建上下文的 `.git/HEAD` 写入 `.build-info.json`，并通过 `BUILDKIT_CONTEXT_KEEP_GIT_DIR=1` 尽量保留 Git 元数据
- `PORTAINER_URL` / `PORTAINER_STACK_ID` / `PORTAINER_API_KEY`：可选。若 Portainer CE 部署后仍无法从镜像内识别 commit，后台会读取该 stack 的 `GitConfig.ConfigHash` 作为当前部署版本；只读 API token 即可
- `STACK_HTTP_PROXY` / `STACK_HTTPS_PROXY`：Portainer 构建镜像或应用抓取外网站点图标需要代理时填写；代理地址必须能从容器内访问

`STACK_BASE_DIR` 与 `SITE_URL` 是必填项。Compose 在变量缺失时会直接拒绝生成部署配置，
不会再静默把数据库挂载到 Git 工作目录；容器启动前还会检查宿主路径格式、公开 URL、
认证相关配置、两个持久目录以及现有 SQLite/WAL/SHM 文件的实际可写性。权限错误会显示
容器实际 UID/GID、目标所有者和模式，并在启动应用前退出。导入变量后可先运行：

```sh
docker compose --env-file /secure/path/manjyun.env config --quiet
```

旧部署如果环境文件已经显式设置 `BLOG_UID=0`、`BLOG_GID=0`，升级后仍会保持 root
兼容模式，无需为了本次升级立即修改环境文件或卷权限；启动日志会给出迁移提示，但不会
拒绝运行。不要只把旧环境文件改成 `1001:1001`：旧数据库、WAL/SHM、认证文件和历史
上传仍可能属于 root。若要迁移，应先停服、备份并在 NAS 上核对这些文件的所有权，再
安排一次独立的离线权限迁移。基础镜像和启动脚本不会对挂载卷执行自动或递归 `chown`。
完整边界和验证方法见 [`docs/container-runtime.md`](docs/container-runtime.md)。

首次初始化默认会生成一次性令牌到 `${STACK_BASE_DIR}/data/setup-token`，并在尚未初始化
期间写入容器日志。管理员创建成功后令牌文件会删除，同时保留不可逆的
`.setup-token-consumed-*` 标记，避免同一个显式令牌在数据库被重建后再次使用。也可以
预先配置 24–512 UTF-8 字节的 `SETUP_TOKEN`；若以后确实要初始化一套全新数据库，必须
换用新令牌，不能删除消费标记来复用旧令牌。

如果忘记管理员密码，先停止主容器并完成一次离线备份，再使用同一 Compose 配置启动
一次性命令容器。脚本会更新密码并递增会话版本，因此所有已签发的后台会话都会立即失效：

```sh
docker compose --env-file /secure/path/manjyun.env stop manjyun-blog

# 由脚本生成强随机密码并只输出到当前终端
docker compose --env-file /secure/path/manjyun.env run --rm --no-deps \
  manjyun-blog node scripts/reset-admin-password.mjs --generate

docker compose --env-file /secure/path/manjyun.env up -d manjyun-blog
```

也可以通过标准输入设置自选密码，避免把密码放进命令行参数、环境文件或 shell 历史：

```sh
read -r -s RESET_PASSWORD
printf '%s\n' "$RESET_PASSWORD" |
  docker compose --env-file /secure/path/manjyun.env run --rm -T --no-deps \
    manjyun-blog node scripts/reset-admin-password.mjs --password-stdin
unset RESET_PASSWORD
```

若数据库中存在多个管理员，追加 `--username NAME` 明确目标。不要在主容器仍写入 SQLite
时执行重置，也不要把新密码写入普通日志或 Git 管理的文件。

`AUTH_TRUST_PROXY_HOPS` 默认是 `0`，表示登录限流不信任客户端提交的
`X-Forwarded-For`。只有当应用端口不能被客户端绕过、请求必然经过固定数量的受信任
反向代理时，才把它设为实际代理层数（1–8）。层数配错或应用仍可被直接访问，会让攻击者
伪造来源地址并削弱登录限流。它不是“是否使用反向代理”的开关。

3. 在 Portainer 创建 Git Stack：

- Stacks -> Add stack
- Build method 选择 Repository
- Repository URL: `https://github.com/manjyunme-glitch/manjyun-blog.git`
- Branch: `main`
- Compose path: `docker-compose.yml`
- Environment variables: 导入或手动填写本地 `stack.env`
- 不要启用 `Pull latest image` / `Re-pull image`。`BLOG_IMAGE` 是 NAS 本地构建 tag，不是远程 registry 镜像。
- 容器使用 Docker 内置 `bridge` 网络，不会创建 Compose 的 `项目_default` 自定义网络。
- Deploy the stack

4. 后续更新。

在 Portainer 的 GitOps / Automatic updates 中选择 Polling 或 Webhook，并保持 `Re-pull image` 关闭。GitHub 更新只会重建应用镜像；`${STACK_BASE_DIR}/data` 和 `${STACK_BASE_DIR}/uploads` 不会被覆盖。

## 运维日志

应用把审计事件作为单行 JSON 写到容器标准输出，`kind` 为 `audit`，可按
`action`、`outcome`、`requestId`、资源标识等字段检索认证、内容、设置、主题、媒体和
外部图标操作。敏感 detail 键会防御性脱敏；调用方和运维采集规则仍不应记录或转储
密码、初始化令牌、会话 Cookie、Authorization、正文或完整请求体。

Docker 默认的 `json-file` 日志可能持续占用磁盘。请在 Docker daemon 或 Portainer
环境中设置与 NAS 容量匹配的 `max-size` / `max-file` 轮转策略，并先确认现有容器的日志
驱动；修改 daemon 级默认值通常只对重新创建的容器生效。排障时优先按 `requestId`
关联事件，不要通过扩大敏感请求日志来定位问题。

基础 Stack 不强制 CPU 或内存上限：个人 NAS 的可用资源差异较大，过低上限还可能在
大文件上传时触发无意义的 OOM 重启。先在 Portainer 观察实际峰值，再为该 Stack 设置
留有余量的限制。日志轮转同样不在 Compose 中强制覆盖，以免破坏 NAS 已配置的日志驱动；
建议优先使用 Docker daemon 的统一轮转策略。

## 写作语法

正文唯一源格式是 Markdown。除 GFM 基础语法外，支持：

```md
[audio:标题](/uploads/audio.mp3 "可选说明")
[bookmark:标题](https://example.com "可选说明")

::callout 标题
内容
::
```

## 主题接口

内置主题包括终端风格的 `ManJyun Console`（`src/themes/manjyun-console`）、明亮编辑设计的 `Paper Atlas`（`src/themes/paper-atlas`），以及赛博朋克记忆广播站风格的 `Neon Rift`（`src/themes/neon-rift`）。公开路由先由 `src/lib/themes/presenter.ts` 将数据库记录转换为稳定 ViewModel，再由 `ThemeHost` 分发到主题；主题不能直接读取数据库类型、格式化业务数据或拼接内容 URL。

主题定义必须声明 `apiVersion`、`coreCompatibility`、`capabilities`、`tokens`，并实现 `Home`、`Collection`、`Entry`、`Page`、`NotFound` 五个槽位。类型契约与当前核心版本位于 `src/themes/types.ts`；新增受信任代码主题后，将其加入 `src/themes/index.ts` 并通过主题契约测试。后台主题页只能激活这些已编译且兼容的主题，并提供真实首页预览与单步回退；JSON 上传仅执行 manifest 兼容性审查，不会安装或执行上传的代码。

后台使用独立的展示契约 `AdminThemeDefinition`，注册表位于 `src/admin/themes`。后台主题 ID 与前台主题 ID 对齐，并自动跟随 `activeTheme`；业务路由、表单和 API 始终共享，后台主题只能提供令牌、品牌标记、装饰和缩略预览。未来前台主题没有后台配套时，管理界面会安全回退到 `ManJyun Console`，不会阻止公开主题运行或锁死后台。
