# ZipShip

ZipShip 是一个面向静态产物的私有化部署工具。第一阶段聚焦上传产物、检测、生成测试地址、发布正式版本和回滚。

## 文档

- [产品设计](docs/01-产品设计.md)
- [技术架构](docs/02-技术架构.md)
- [测试规范与实施路线](docs/03-测试规范与实施路线.md)

## Workspace

```txt
apps/api              Bun + Elysia API
apps/web-shell        Web 控制台外壳
apps/desktop-shell    Tauri 桌面外壳
packages/console-app  Web / Desktop 共用 React 页面
packages/db           Drizzle schema / migrations
packages/deploy-core  产物检测、hash、发布、回滚核心逻辑
packages/storage      文件系统与未来对象存储抽象
```

## 开发端口

- API：`http://localhost:3001`
- Web Shell：`http://127.0.0.1:5173`
- Desktop Shell renderer：`http://localhost:1420`（Tauri 约定端口；完整桌面开发用 `bun --filter @zipship/desktop-shell tauri dev`，需 Rust 工具链）

`dev:api`、`dev:web`、`dev:desktop` 都会在启动前清理对应端口；Web 与 Desktop 的 Vite 配置使用 `strictPort`，端口被占用时不会自动漂移。

## 配置

环境变量统一从仓库根目录 `.env` 读取，模板见 `.env.example`。前端只使用 `VITE_` 前缀变量；数据库、存储路径和服务端密钥只给后端与脚本读取。

Drizzle 配置位于 `packages/db/drizzle.config.ts`，根目录的 `db:generate`、`db:migrate` 脚本会显式指向这个配置文件。
