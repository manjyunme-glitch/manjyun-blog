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
只复制 `manjyun.sqlite`。同时保留 `data/auth-secret`，如果环境变量中显式设置过
`AUTH_SECRET`，新版也必须继续使用相同值。

Windows Docker 主机可将 `STACK_BASE_DIR` 写成父目录的正斜杠路径，例如
`E:/manjyun-blog`，对应结构应为 `E:/manjyun-blog/data` 与
`E:/manjyun-blog/uploads`。Linux / NAS 部署必须改用 Docker 主机实际可访问的路径。

## NAS / Portainer 部署

本仓库可以直接作为 Portainer Git Stack 部署。运行数据放在 NAS 本地目录，不跟随 GitHub 更新覆盖。

1. 在 NAS 上创建持久化目录：

```bash
mkdir -p /share/DockerData/manjyun-blog/data
mkdir -p /share/DockerData/manjyun-blog/uploads
```

2. 准备环境变量。

从仓库里的 `stack.env.example` 复制一份到本地，按注释填入真实值。至少需要确认：

- `STACK_BASE_DIR=/share/DockerData/manjyun-blog`
- `BLOG_UID=0`、`BLOG_GID=0`：默认用 root 运行以适配 NAS bind mount，避免 SQLite 无法写入。若已手动 `chown -R 1001:1001 /share/DockerData/manjyun-blog/data /share/DockerData/manjyun-blog/uploads`，可改成 `1001`
- `BLOG_PORT=4482`
- `SITE_URL`：公开访问地址，生产环境建议填 HTTPS 域名
- `SESSION_COOKIE_SECURE`：HTTPS 访问可留空；如果只用 `http://NAS_IP:4482` 访问后台，设置为 `false`
- `GITHUB_REPOSITORY` / `GITHUB_BRANCH`：后台“检查 GitHub 更新”用于查询远端提交，默认是本仓库 `main`；构建期也会用它们在 `.git` 不可用时兜底写入 `.build-info.json`
- `GIT_COMMIT`：当前 Docker 构建对应的提交 SHA。留空时 Docker 构建会尝试从构建上下文的 `.git/HEAD` 写入 `.build-info.json`，并通过 `BUILDKIT_CONTEXT_KEEP_GIT_DIR=1` 尽量保留 Git 元数据
- `PORTAINER_URL` / `PORTAINER_STACK_ID` / `PORTAINER_API_KEY`：可选。若 Portainer CE 部署后仍无法从镜像内识别 commit，后台会读取该 stack 的 `GitConfig.ConfigHash` 作为当前部署版本；只读 API token 即可
- `STACK_HTTP_PROXY` / `STACK_HTTPS_PROXY`：Portainer 构建镜像或应用抓取外网站点图标需要代理时填写；代理地址必须能从容器内访问

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
