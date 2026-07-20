# 备份与恢复

ManJyun Blog 的运行状态由两个宿主机目录组成：

- `data/`：`manjyun.sqlite` 以及可能存在的 `manjyun.sqlite-wal`、
  `manjyun.sqlite-shm`，持久化的 `auth-secret`、一次性 `setup-token` 和
  `.setup-token-consumed-*` 消费标记，以及后续版本加入的数据文件；
- `uploads/`：媒体文件及媒体操作产生的受控临时文件。

备份脚本会归档整个 `data/` 和 `uploads/`，而不是维护一份容易漏项的文件白名单。
Portainer / Compose 环境变量不在这两个目录中，应另外通过 NAS 的秘密管理或加密备份
保存。特别是显式配置的 `AUTH_SECRET` 必须在恢复后保持原值；不要把包含密钥的环境
文件放进普通备份或提交到 Git。

## 一致性前提

备份和恢复都必须在应用容器停止后进行。SQLite 使用 WAL 模式；只复制
`manjyun.sqlite`，或在应用仍写入时依次复制三个数据库文件，都不能保证得到同一个
时间点的一致状态。脚本默认检查预期容器的运行状态，不能验证时会拒绝继续。

以下示例假设环境文件中的 `CONTAINER_NAME_PREFIX=mblog`，所以容器名是
`mblog-app`。如果使用了其他前缀，请把实际容器名传给 `--container`。

```sh
docker compose --env-file /secure/path/manjyun.env stop manjyun-blog

mkdir -p /share/Backups/manjyun-blog
sh scripts/backup-data.sh \
  --base-dir /share/DockerData/manjyun-blog \
  --container mblog-app \
  --output /share/Backups/manjyun-blog/manjyun-blog-before-upgrade.tar.gz
```

脚本具有以下默认保护：

- 基础目录必须是已存在的绝对路径，且不能是文件系统根目录；
- `data/`、`uploads/` 必须是真实目录而不是符号链接；
- 容器仍运行、容器状态无法确认、目标文件已存在时均拒绝备份；
- 先写入同目录临时文件并验证 tar，再以“不覆盖”方式发布；优先使用原子硬链接，
  不支持硬链接的 NAS 文件系统会使用 shell noclobber 独占创建，并再次校验归档；
- 新备份默认权限为 `0600`（文件系统支持时）。

如果容器已经被删除，Docker 无法验证其状态，请人工确认没有其他实例正在使用该目录，
再用 `--confirm-stopped`。该选项是明确的人工确认，不会主动停止服务。

先用 `--dry-run` 可以验证路径、停服状态和计划，不写入任何文件：

```sh
sh scripts/backup-data.sh \
  --base-dir /share/DockerData/manjyun-blog \
  --container mblog-app \
  --output /share/Backups/manjyun-blog/test.tar.gz \
  --dry-run
```

## 恢复

恢复脚本默认只检查，不会覆盖现有数据。建议先把备份恢复到独立测试目录进行演练：

```sh
mkdir -p /share/RestoreTests/manjyun-blog
sh scripts/restore-data.sh \
  --archive /share/Backups/manjyun-blog/manjyun-blog-before-upgrade.tar.gz \
  --base-dir /share/RestoreTests/manjyun-blog \
  --confirm-stopped \
  --dry-run
```

正式恢复时先停止应用，再执行一次 dry-run；确认输出的源和目标无误后才增加 `--yes`：

```sh
docker compose --env-file /secure/path/manjyun.env stop manjyun-blog

sh scripts/restore-data.sh \
  --archive /share/Backups/manjyun-blog/manjyun-blog-before-upgrade.tar.gz \
  --base-dir /share/DockerData/manjyun-blog \
  --container mblog-app \
  --dry-run

sh scripts/restore-data.sh \
  --archive /share/Backups/manjyun-blog/manjyun-blog-before-upgrade.tar.gz \
  --base-dir /share/DockerData/manjyun-blog \
  --container mblog-app \
  --yes
```

实际替换前，脚本会：

1. 校验 gzip/tar 可读性、目录边界和成员类型，拒绝路径穿越、符号链接和特殊文件；
2. 在目标目录的同一文件系统中完整解包到暂存目录；
3. 把当前 `data/`、`uploads/` 自动归档到默认的
   `<STACK_BASE_DIR>-restore-backups/`，已存在的归档不会被覆盖；
4. 通过同一文件系统的目录移动替换两个目录；中途失败时尝试恢复原目录。

可通过 `--rollback-dir /secure/backup/path` 指定恢复前备份的位置。恢复完成后，使用原来的
环境变量启动应用，检查健康状态、管理员登录、最近内容及上传文件：

```sh
docker compose --env-file /secure/path/manjyun.env up -d
docker compose --env-file /secure/path/manjyun.env ps
docker compose --env-file /secure/path/manjyun.env logs --tail 100 manjyun-blog
```

在确认新数据可用之前不要删除原始归档和自动生成的恢复前备份。定期在隔离目录执行一次
恢复演练，才能验证备份不仅“存在”，而且确实可恢复。
