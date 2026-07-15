# Docker

`docker-compose.yml` 只负责 Rust 开发和测试所需的有状态依赖：

- PostgreSQL 17：业务元数据、任务、审计与活动版本指针。
- Mailpit：本地密码恢复邮件捕获。

```bash
bun run infra:up
bun run db:migrate
bun run infra:down
```

旧 Elysia API 镜像、Drizzle 迁移和基于软链接的 Nginx Access Plane 已删除。当前 Access Plane 由 `zipshipd` 的独立监听地址提供。最终生产镜像、Console 静态托管、TLS 与反向代理拓扑将在独立部署切片中交付，不能把本地依赖编排冒充生产栈。
