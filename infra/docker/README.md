# Docker

## 本地依赖

`docker-compose.yml` 只负责 Rust 开发和测试所需的有状态依赖：

- PostgreSQL 17：业务元数据、任务、审计与活动版本指针。
- Mailpit：本地密码恢复邮件捕获。

```bash
bun run infra:up
bun run db:migrate
bun run infra:down
```

旧 Elysia API 镜像、Drizzle 迁移和基于软链接的 Nginx Access Plane 已删除。当前 Access Plane 由 `zipshipd` 的独立监听地址提供。

## 生产栈

`compose.production.yml` 是最终单机生产拓扑：

1. PostgreSQL 健康后运行一次 `zipshipd migrate`。
2. 迁移成功后启动同一镜像中的 `zipshipd serve` 和 `zipship-worker`。
3. Server/Worker 健康后启动非 root Caddy Edge，只对外暴露 HTTP/HTTPS。
4. Caddy 为 `console`、`api`、`sites` 三个主机名签发证书；Rust 仍是项目路由、发布指针和静态 Artifact 策略的唯一事实源。

所有应用容器均为只读根文件系统、drop all capabilities、`no-new-privileges`，只把 `/tmp` 和必要持久卷设为可写。`backend` 网络为 internal；只有 Worker 与 Edge 接入出网网络。Rust 镜像中的进程固定使用 UID/GID 10001，Caddy 使用官方 `caddy` 用户并通过容器高端口 8080/8443 工作，不需要绑定端口 capability。

复制 `production.env.example` 到仓库外并替换占位符：

```bash
docker compose \
  --env-file /secure/path/zipship-production.env \
  -f infra/docker/compose.production.yml \
  config --quiet

docker compose \
  --env-file /secure/path/zipship-production.env \
  -f infra/docker/compose.production.yml \
  up -d --build --wait
```

关键运维约束：

- `ZIPSHIP_DATABASE_URL` 中的密码必须 URL 编码，并与 PostgreSQL 初始化变量一致。
- 三个公共 Origin 必须是 HTTPS 且无结尾 `/`；Host 与 Origin 必须成对一致。推荐同一主域的三个子域，以满足 Strict Cookie 的 same-site 边界。
- 修改 API/Access Origin 后必须重建 Edge，因为 Vite 在构建时写入公共地址。
- `ZIPSHIP_PASSWORD_RECOVERY_KEYS` 必须使用 32 字节随机值的无填充 base64url；轮换时先追加新 key，再切 active id，旧 Outbox 排空后才能移除旧 key。
- Artifact、PostgreSQL 和 Caddy 数据卷必须纳入独立备份/恢复方案；Compose 本身不是备份。
- 生产不包含 Mailpit，也不暴露 PostgreSQL、5006 或 5007 宿主端口。

## 发行冒烟

```bash
bun run smoke:production
```

脚本使用 `compose.smoke.yml` 仅把 Caddy ACME 切换为隔离内部 CA，其余镜像、生产模式、安全 Cookie、迁移顺序、健康检查和网络边界均与生产 Compose 相同。它会验证 Console、Control Plane、Worker、PostgreSQL 和 Access Plane 的真实发布链路，并始终删除自己的临时卷。
