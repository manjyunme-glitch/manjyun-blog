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
- `STACK_HTTP_PROXY` / `STACK_HTTPS_PROXY`：Portainer 构建镜像需要代理时再填写

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

默认主题是 `ManJyun Console`，位于 `src/themes/manjyun-console`。主题通过 `theme.meta`、`theme.tokens` 和 `theme.slots` 注册，后续可以新增主题目录并加入 `src/themes/index.ts`。
