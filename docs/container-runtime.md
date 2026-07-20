# 容器运行身份与持久目录权限

## 默认行为

镜像声明的运行用户是 `nextjs`（数值 UID/GID `1001:1001`），Compose 在没有配置
`BLOG_UID` / `BLOG_GID` 时也使用 `1001:1001`。启动命令以该身份先执行只读配置校验和
受控写探针，成功后通过 `exec` 直接启动 Node；没有 root entrypoint、后台权限代理或
启动时递归 `chown`。Compose 同时启用 Docker init 负责转发信号和回收孤儿进程，并设置
`no-new-privileges`，阻止进程通过 setuid/setgid 文件获得新权限。

新部署应在第一次启动前创建空的持久目录：

```sh
mkdir -p /share/DockerData/manjyun-blog/data
mkdir -p /share/DockerData/manjyun-blog/uploads
chown 1001:1001 \
  /share/DockerData/manjyun-blog/data \
  /share/DockerData/manjyun-blog/uploads
chmod 0750 \
  /share/DockerData/manjyun-blog/data \
  /share/DockerData/manjyun-blog/uploads
```

这些命令只处理两个顶层空目录。NAS 使用 ACL 时，可以在管理界面授予相同的读写权限，
不必改变整个共享目录的所有者。

## 现有 root 部署升级

已经在环境文件中显式设置以下变量的部署会原样保留兼容行为：

```dotenv
BLOG_UID=0
BLOG_GID=0
```

本次升级无需修改这两个值，也不会自动改动现有卷。预检成功后会输出一条 root 兼容模式
警告，应用仍正常启动。

不要在未检查数据的情况下把旧部署直接改成 `1001:1001`。除了两个目录本身，还需要考虑：

- `data/manjyun.sqlite`、可能存在的 `-wal` 和 `-shm` 文件；
- `data/auth-secret`、初始化令牌及其消费标记；
- `uploads/` 下的所有历史媒体与受控临时文件；
- NAS 共享目录的 ACL、只读快照或继承权限。

如需迁移，先停止容器并完成可恢复备份，在离线窗口核对上述文件，再按 NAS 的权限模型
制定迁移步骤。保留 `0:0` 是兼容选择，不会阻止后续应用升级。

基础 Stack 没有强制 `cap_drop: [ALL]`。旧 NAS 卷中可能存在由其他宿主 UID 持有且模式
为 `0600` 的文件，显式 root 兼容模式需要 `DAC_OVERRIDE` 才能读取它们；丢弃全部
capability 会把原本可直接升级的部署变成启动失败。新部署的默认 `1001:1001` 不依赖
root capability；旧部署完成离线权限迁移后也应切换到该非 root 身份，而不是长期依赖
root 模式。

## 启动预检

`scripts/validate-deployment-config.mjs` 会在 Node 服务监听端口前验证：

- 数据目录和上传目录存在、是目录且可创建、同步和删除探针文件；
- 已存在的 SQLite、WAL、SHM 是普通文件且能以读写方式打开；
- 需要使用的 `auth-secret` 和生成式 `setup-token` 是非符号链接普通文件且可读；
- 容器内数据路径与宿主机基础路径配置合法；
- 认证、代理层数和公开 URL 等启动配置合法。

预检不会修改数据库内容，也不会遍历或更改卷所有权。权限失败信息包含实际运行
UID/GID、目标文件的 UID/GID 和模式、底层错误码，以及新部署和旧部署各自的处理边界。

常见失败的安全处理顺序：

1. 确认 Compose 挂载不是只读；
2. 确认环境文件中的 `BLOG_UID:BLOG_GID` 与预期一致；
3. 在 NAS 上检查报错所指文件或目录的所有者和 ACL；
4. 新空部署只修正两个顶层目录；
5. 旧部署保持原来的 `0:0`，或在停服备份后另行执行完整的离线迁移。

## 配置验证

新部署可以先确认 Compose 解析后的身份：

```sh
docker compose --env-file /secure/path/manjyun.env config
```

在输出的 `services.manjyun-blog.user` 中应看到 `"1001:1001"`。旧环境文件则应继续显示
`"0:0"`。随后启动并检查预检日志：

```sh
docker compose --env-file /secure/path/manjyun.env up -d
docker compose --env-file /secure/path/manjyun.env logs --tail 50 manjyun-blog
```

不要用真实数据验证失败场景。可在隔离目录或一次性 Docker volume 上挂载只读目录，
确认预检在应用启动前返回非零状态。

## 资源与日志

基础 Compose 不覆盖 NAS 的日志驱动，也不强制统一 CPU/内存上限。这样可避免 Portainer
现有日志采集失效，以及低配置 NAS 因不合适的通用限制发生 OOM 重启。

对长期运行的实例，仍应在 Docker daemon 或 Portainer 层启用日志轮转，并根据实际
监控到的常态与峰值设置资源上限。设置后应至少回归 50 MB 上传、媒体下载、数据库备份和
容器重启；如果没有监控数据，保持基础 Stack 的兼容配置比猜测一个过低上限更安全。
