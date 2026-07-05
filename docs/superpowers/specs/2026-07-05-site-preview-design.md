# Site Preview Design

## 目标

补齐 Phase 3 的“返回测试地址”：当上传 zip 通过 `@zipship/deploy-core` 处理并生成 `ready` release 后，后端提供一个稳定的内部测试地址，让用户和测试都能真实访问该 release 的静态文件。

本阶段只做内部预览地址，不实现正式生产域名、Nginx 配置、发布 current 指针、回滚或 deployment 记录。

## 推荐路由

```txt
/_sites/:projectSlug/:releaseHash/
/_sites/:projectSlug/:releaseHash/*path
```

选择 `/_sites` 前缀的原因：

- 不占用未来正式站点路由 `/:slug/`。
- 明确这是 API/开发阶段的内部预览地址。
- 可以在后续 Nginx 阶段映射为正式测试地址 `/:slug/:hash/`，但本阶段不要求 Nginx。

## 后端模块

新增 Elysia feature module：

```txt
apps/api/src/modules/site-preview/
  model.ts
  service.ts
  index.ts
```

职责划分：

- `model.ts`：定义 params 类型和内部错误码。静态响应本身不是 JSON DTO。
- `service.ts`：查找 project/release，校验 release 状态，解析静态文件路径，返回可读取文件路径或 not found。
- `index.ts`：注册 `GET /_sites/:projectSlug/:releaseHash/*` 路由，把 service 结果转换成 `Response`。

服务层不直接拼接任意磁盘路径，只能基于数据库中的 `release.storagePath` 访问文件。

## Repository 能力

在现有 in-memory repository 中增加最小查询接口：

```ts
findProjectBySlug(slug: string): Promise<Project | null>;

findReadyReleaseByProjectIdAndHash(input: {
  projectId: string;
  releaseHash: string;
}): Promise<Release | null>;
```

`findReadyReleaseByProjectIdAndHash` 必须同时校验：

- `release.projectId === input.projectId`
- `release.releaseHash === input.releaseHash`
- `release.status === "ready"`

失败、processing、已归档或不存在的 release 都表现为 not found。当前代码还没有 `archived` 状态，判断已归档应以 `archivedAt !== null` 为准。

## 静态文件解析

输入路径来自 `*path`，规则如下：

- 空路径、`/`、目录路径都返回 `index.html`。
- 普通文件路径返回对应文件。
- 文件不存在时，如果 `index.html` 存在，则执行 SPA fallback 返回 `index.html`。
- 路径穿越、绝对路径、Windows drive path、NUL 字符、反斜杠穿越、URL 编码后的危险路径都返回 404。
- 任何解析后的路径必须仍位于 `release.storagePath` 内。

建议在 `packages/storage` 增加可复用 helper，而不是在 route 中手写路径安全逻辑：

```ts
resolveStaticAssetPath(input: {
  rootDir: string;
  requestPath: string;
}): Promise<
  | { kind: "file"; absolutePath: string }
  | { kind: "not-found" }
>;
```

这个 helper 应该使用标准 path API 做 normalize/resolve，并检查结果路径仍在 `rootDir` 下。不要通过简单字符串替换实现安全判断。

## 响应行为

静态访问是网页请求语义，不返回业务 JSON 错误：

```txt
project 不存在 -> 404
release 不存在 -> 404
release 非 ready -> 404
release.storagePath 不存在 -> 404
危险路径 -> 404
普通文件存在 -> 200 + 文件内容
目录或 SPA fallback -> 200 + index.html
```

Content-Type 应按文件扩展名设置，至少覆盖：

```txt
.html -> text/html; charset=utf-8
.js -> text/javascript; charset=utf-8
.css -> text/css; charset=utf-8
.json -> application/json; charset=utf-8
.svg -> image/svg+xml
.png -> image/png
.jpg/.jpeg -> image/jpeg
.webp -> image/webp
.ico -> image/x-icon
unknown -> application/octet-stream
```

HEAD 可以暂不实现；本阶段只要求 GET。

## Release DTO

项目 release 列表应返回可展示的测试地址，新增：

```ts
previewUrl: string | null;
```

规则：

- `ready` release 返回 `/_sites/{project.slug}/{release.releaseHash}/`。
- 非 ready release 返回 `null`。

这会让 Web Console 后续直接展示“测试地址”，也让 API 测试不用在测试内重复拼接规则。

由于当前 release repository 只按 projectId 返回 release，生成 `previewUrl` 时可以在 `ReleasesService.list` 拿到 project 后补充，避免 release record 直接依赖 slug。

## 权限与公开性

本阶段预览地址不做登录鉴权，理由：

- 目标是验证部署产物是否可访问。
- 后续正式访问会交给 Nginx 和发布流程。
- 最小闭环更适合测试先行。

安全边界放在：

- 只允许访问 `ready` release。
- 只允许访问 `release.storagePath` 内文件。
- 不暴露 raw upload、temp、任意系统路径。

如果未来要做私有预览，可以在此模块外层增加签名 token 或鉴权中间件；本阶段不预留复杂 token 机制。

## 测试策略

必须测试先行。deepseek-flash 执行计划时，每个任务都要先写失败测试、确认失败，再改实现。

建议测试文件：

```txt
tests/unit/site-preview-routes.test.ts
tests/unit/releases-routes.test.ts
packages/storage/tests 或现有 API 测试中的 storage helper 覆盖
```

最小覆盖：

- ready release 的 `/_sites/:slug/:hash/` 返回 `index.html`。
- ready release 的 asset 路径返回真实 JS/CSS 文件。
- 深路径如 `/_sites/:slug/:hash/dashboard/settings` fallback 到 `index.html`。
- 未知 slug 返回 404。
- 未知 hash 返回 404。
- failed release 不可访问。
- processing、failed、已归档 release 不可访问。
- 路径穿越不可访问，包括 `../`、URL encoded traversal、绝对路径、反斜杠。
- release 列表中 ready release 返回 `previewUrl`，failed release 返回 `previewUrl: null`。

## 文档更新

更新中文文档：

- `docs/02-技术架构.md`：说明当前内部测试地址是 `/_sites/:projectSlug/:releaseHash/`，正式 Nginx 地址仍属于后续 Phase 4。
- `docs/03-测试规范与实施路线.md`：Phase 3 勾选“返回测试地址”，Phase 4 保留 Nginx routing tests。

## 非目标

本阶段不做：

- Nginx 配置生成。
- `/:slug/` 正式地址。
- `/:slug/:hash/` Nginx 测试地址。
- 发布 release。
- current 软链接切换。
- rollback。
- deployment 记录。
- 自定义域名。
- 预览 token 或权限系统。

## 成功标准

- 一个 ready release 可以通过 `previewUrl` 打开并返回真实 `index.html`。
- 同一 ready release 的 asset 文件可以通过预览地址访问。
- SPA 深路径能 fallback 到 `index.html`。
- failed、processing、已归档 release 不能通过预览地址访问。
- 路径安全测试覆盖危险输入。
- 全量验证通过：`bun test`、`bun test --coverage`、`bun run typecheck`、`bun run db:generate`、桌面 lint/package、`codegraph sync .`。
