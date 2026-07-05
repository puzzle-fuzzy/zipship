# Nginx 访问面设计

## 目标

补齐 ZipShip 的 Phase 4 访问面，让发布后的静态产物可以通过 Nginx 真实访问，而不是只停留在 API 控制面状态。

本阶段目标：

- 上传处理后的 artifact 存到 `storageRoot/sites/:projectSlug/releases/:releaseHash/`。
- 发布 release 时切换 `storageRoot/sites/:projectSlug/current` 软链接。
- 回滚 release 时切换同一个 `current` 软链接。
- Nginx 支持正式地址 `/:slug/`。
- Nginx 支持测试地址 `/:slug/:releaseHash/`。
- Nginx 支持无尾斜杠跳转、静态 asset、SPA fallback。
- 增加 Nginx routing tests。
- 保留内部预览地址 `/_sites/:projectSlug/:releaseHash/`。

本阶段不做 HTTPS、自定义域名、Docker Compose、真实 DB repository、项目级发布锁、project slug rename、Web UI 或 Desktop UI。

## 推荐方案

采用 slug-based 文件系统访问面：

```txt
storageRoot/sites/:projectSlug/releases/:releaseHash/
storageRoot/sites/:projectSlug/current -> releases/:releaseHash
```

Nginx 只读文件系统，不查询 Elysia API：

```txt
/:slug/       -> sites/:slug/current/
/:slug/:hash/ -> sites/:slug/releases/:hash/
```

选择这个方案的原因：

- 与当前中文架构文档中的访问面设计一致。
- `project.slug` 已经是全局唯一，可以作为公开访问目录。
- Nginx 能纯静态服务用户产物，不依赖 Elysia 控制面。
- 发布和回滚只切换软链接，不复制文件，不 reload Nginx。
- 后续支持缓存、限速、HTTPS、自定义域名更自然。

不采用的方案：

- 不让 Nginx 通过 projectId 或 API 查询 slug，因为访问面会依赖控制面。
- 不让正式地址 proxy 到 `/_sites`，因为生产静态访问应该交给 Nginx。
- 不只做 Nginx fixture 测试，因为那不会打通真实发布/回滚链路。

## 存储路径

当前实现中 release artifact 存储路径是：

```txt
storageRoot/sites/:projectId/releases/:releaseHash/
```

本阶段改为：

```txt
storageRoot/sites/:projectSlug/releases/:releaseHash/
```

示例：

```txt
/srv/zipship/sites/admin/releases/a8f32c91abcd/
  index.html
  assets/index.js

/srv/zipship/sites/admin/current -> releases/a8f32c91abcd
```

`release.storagePath` 仍然保存实际 artifact 绝对路径。内部预览 `/_sites/:projectSlug/:releaseHash/` 继续通过 `release.storagePath` 读取文件，因此内部预览不会因为 Nginx 访问面改变而消失。

新增或调整 storage helper：

```ts
createProjectSitePath(paths, projectSlug): string;

createReleaseStoragePath(paths, {
  projectSlug: string;
  releaseHash: string;
}): string;

createCurrentReleaseLinkPath(paths, projectSlug): string;
```

`createReleaseStoragePath()` 不再接收 `projectId`。上传 complete 流程必须先拿到 project，再把 `project.slug` 传给 storage helper。

兼容边界：

- 不做历史迁移脚本，因为项目仍处在开发早期。
- 现有测试中对 projectId path 的断言要同步更新为 slug path。
- 第一版不支持 project slug rename。
- 如果未来支持改 slug，需要单独设计目录迁移。
- 全局 project slug 唯一约束必须保留。

## 发布与回滚软链接

发布和回滚都维护：

```txt
storageRoot/sites/:projectSlug/current -> releases/:releaseHash
```

发布流程：

```txt
校验登录、权限、project、release
确认目标 artifact 存在且包含 index.html
切换 current 软链接
更新 project.currentReleaseId / release active 状态 / deployment / audit
返回成功
```

回滚流程同理，只是 action 为 `rollback`。

### Nginx 配置方案

采用 `root` + `try_files` 显式路径方案，避免 `alias` 在 regex location 下的路径组合陷阱。核心原则：

- 所有 regex location 使用 `root {sitesRoot}`，不单独设置 `alias`
- `try_files` 中写完整的 root 相对路径（如 `/$1/releases/$2/$3`）
- 根路径（`/$`）、真实文件命中、SPA fallback 分开处理，以便设置正确的 Cache-Control
- 文件路径用 `(.+)$` 匹配（至少一个字符），避免误配到目录路径
- 文件路径 location 只负责真实文件命中并设置 immutable；fallback 到 named location 后返回 `index.html` 并设置 no-cache

**Nginx 模板位置**：`infra/nginx/zipship.conf`

模板变量：

| 变量 | 含义 |
|---|---|
| `__ZIPSHIP_LISTEN_PORT__` | 监听端口 |
| `__ZIPSHIP_SITES_ROOT__` | 站点根目录 |
| `__ZIPSHIP_CONSOLE_ROOT__` | Console App 构建产物目录 |
| `__ZIPSHIP_API_UPSTREAM__` | Elysia API 上游地址（测试用 `http://127.0.0.1:9`） |
| `__ZIPSHIP_NGINX_PID__` | PID 文件路径 |

**路由优先级与实现**：

按 Nginx 匹配优先级排列：

```
1. ^~ /_api/         proxy_pass → Elysia       控制面
2. ^~ /_sites/       proxy_pass → Elysia       内部预览
3. ^~ /_console/     alias + try_files         管理后台
4. ~ /slug/(hash)$   308 → /slug/hash/         尾斜杠跳转（hash）
5. ~ /slug$          308 → /slug/              尾斜杠跳转（slug）
6. ~ /slug/hash/$    root + try_files index    指定版本首页，no-cache
7. ~ /slug/hash/(.+) root + try_files file     指定版本真实文件，immutable；缺失时 @release_spa
8. ~ /slug/$         root + try_files index    当前版本首页，no-cache
9. ~ /slug/(.+)      root + try_files file     当前版本真实文件，immutable；缺失时 @current_spa
10. @release_spa     root + try_files index    指定版本 SPA fallback，no-cache
11. @current_spa     root + try_files index    当前版本 SPA fallback，no-cache
```

示例（正式版本）：

```nginx
location ~ ^/([a-z0-9][a-z0-9_-]*)/$ {
    root __ZIPSHIP_SITES_ROOT__;
    try_files /$1/current/index.html =404;
    add_header Cache-Control "no-cache";
}

location ~ ^/([a-z0-9][a-z0-9_-]*)/(.+)$ {
    set $zipship_slug $1;
    root __ZIPSHIP_SITES_ROOT__;
    try_files /$1/current/$2 @zipship_current_spa;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location @zipship_current_spa {
    root __ZIPSHIP_SITES_ROOT__;
    try_files /$zipship_slug/current/index.html =404;
    add_header Cache-Control "no-cache";
}
```

说明：
- 用 `(.+)$` 而非 `(.*)$`：`.+` 要求至少一个字符，确保目录路径（如 `/:slug/`）不会被文件路径 location 误配
- named location 不能直接依赖 regex 捕获组，所以进入 fallback 前先用 `set` 保存 `$zipship_slug` / `$zipship_release_hash`
- 文件命中和 SPA fallback 必须分开设置缓存头，避免 `/admin/settings` 这类 HTML fallback 继承 asset 的 `immutable`
- 根路径（`/$`）与文件路径（`/(.+)`）分离为不同 location，分别适合设置 `no-cache` 和 `immutable`

### 一致性取舍

数据库状态和文件系统软链接不是同一个事务。

本阶段采用文件系统优先：

```txt
1. 先确认 release.storagePath 存在。
2. 先确认 release.storagePath/index.html 存在。
3. 先切换 current 软链接到目标 release。
4. symlink 成功后再执行 repository publish/rollback mutation。
5. 如果 symlink 失败，数据库不变，API 返回 FILESYSTEM_UPDATE_FAILED。
```

这样可以避免更危险的状态：数据库显示发布成功，但正式访问仍然指向旧版本。

如果未来真实数据库 mutation 失败，会存在 symlink 已切但 DB 未切的风险。真实 DB repository 阶段需要引入 transaction 与补偿策略，或扩展 deployment 状态为 `pending / success / failed`。本阶段不扩大到该问题。

新增 storage helper：

```ts
ensureReleaseArtifactReady(storagePath): Promise<void>;

switchCurrentReleaseLink(input: {
  projectSitePath: string;
  releaseHash: string;
}): Promise<void>;
```

`ensureReleaseArtifactReady()` 要求：

- `storagePath` 存在。
- `storagePath` 是目录。
- `storagePath/index.html` 存在且是文件。

`switchCurrentReleaseLink()` 要求：

- 目标 symlink 使用相对路径：`releases/:releaseHash`。
- 先创建临时链接 `current.tmp`。
- 再替换 `current`。
- 重复切换不能留下 `current.tmp`。
- 如果 `current` 已存在，允许替换。

错误码：

```txt
RELEASE_ARTIFACT_NOT_FOUND
FILESYSTEM_UPDATE_FAILED
```

这些错误只返回稳定 code，不返回面向用户的中英文文案。

## API 模块调整

`DeploymentsService` 需要接收 storage 依赖，但 repository 仍只负责元数据原子 mutation。

建议增加：

```ts
export interface DeploymentStorage {
  createProjectSitePath(projectSlug: string): string;
  ensureReleaseArtifactReady(storagePath: string): Promise<void>;
  switchCurrentReleaseLink(input: {
    projectSitePath: string;
    releaseHash: string;
  }): Promise<void>;
}
```

`deploymentsModule()` 从 `createApp()` 注入 storage dependency。

发布和回滚时：

```txt
service 校验业务规则
service 调用 storage.ensureReleaseArtifactReady(release.storagePath)
service 调用 storage.switchCurrentReleaseLink(...)
service 调用 repository.publishRelease / rollbackRelease
service 写 audit_log
```

repository 不直接操作文件系统，避免数据层混入访问面细节。

## Nginx Routing

采用 `root` + `try_files` 方案，所有 regex location 使用 `root __ZIPSHIP_SITES_ROOT__` 并在 `try_files` 中写完整的 root 相对路径。真实文件命中和 SPA fallback 分离，避免 HTML fallback 被错误地打上长期 immutable 缓存。

**平台保留前缀**（`^~` 前缀优先于所有 regex）：

| 前缀 | 处理方式 | 说明 |
|---|---|---|
| `/_api/` | `proxy_pass` ← Elysia | 控制面 API |
| `/_sites/` | `proxy_pass` ← Elysia | 内部预览（保留现有功能） |
| `/_console/` | `alias` + `try_files` SPA fallback | 管理后台 |

**尾斜杠跳转**：

| 匹配 | 响应 |
|---|---|
| `/:slug/:hash`（hash 匹配 `[a-f0-9]{12}`） | `308 → /:slug/:hash/` |
| `/:slug` | `308 → /:slug/` |

**指定版本（hash 路径）**：

| Location | Cache-Control | try_files |
|---|---|---|
| `~ ^/:slug/:hash/$` | `no-cache` | `/$slug/releases/$hash/index.html =404` |
| `~ ^/:slug/:hash/(.+)$` | `immutable, 1y` | `/$slug/releases/$hash/$path @zipship_release_spa` |
| `@zipship_release_spa` | `no-cache` | `/$slug/releases/$hash/index.html =404` |

hash 必须匹配 `[a-f0-9]{12}`（releaseHash 当前固定 12 位 lowercase hex）。不匹配此模式的第二段不会命中 hash 路由，会回退到当前版本。

**当前版本（非 hash 路径）**：

| Location | Cache-Control | try_files |
|---|---|---|
| `~ ^/:slug/$` | `no-cache` | `/$slug/current/index.html =404` |
| `~ ^/:slug/(.+)$` | `immutable, 1y` | `/$slug/current/$path @zipship_current_spa` |
| `@zipship_current_spa` | `no-cache` | `/$slug/current/index.html =404` |

**文件路径匹配细节**：

- 文件路径使用 `(.+)$`（至少一个字符），避免匹配到目录路径（如 `/:slug/`）
- `try_files` 中第一个参数优先查文件，不匹配时跳到 named location 返回 `index.html` 实现 SPA
- named location 使用 `set` 保存的 `$zipship_slug` / `$zipship_release_hash`，不直接依赖 regex 捕获组
- 真实文件返回 `immutable`；SPA fallback 返回 `no-cache`
- 内部预览 `/_sites/` 继续保留，通过 proxy_pass 到 Elysia 的 site-preview 模块

**完整路由示例**：

| 请求 | 命中 location | 文件映射 | 结果 |
|---|---|---|---|
| `/admin/` | `~ ^/:slug/$` | `sites/admin/current/index.html` | 当前版本首页 |
| `/admin/settings` | `~ ^/:slug/(.+)$` | 先查文件，无 → fallback `index.html` | SPA fallback |
| `/admin/a8f32c91abcd/` | `~ ^/:slug/:hash/$` | `sites/admin/releases/a8f32c91abcd/index.html` | 指定版本首页 |
| `/admin/a8f32c91abcd/settings` | `~ ^/:slug/:hash/(.+)$` | 先查文件，无 → fallback `index.html` | 指定版本 SPA |
| `/admin/a8f32c91abcd/assets/app.js` | `~ ^/:slug/:hash/(.+)$` | `sites/admin/releases/a8f32c91abcd/assets/app.js` | 直接文件 |
| `/admin/not-a-hash/settings` | `~ ^/:slug/(.+)$` | `not-a-hash` 不匹配 `[a-f0-9]{12}` → 使用 current | current SPA |
| `/admin` | `~ ^/:slug$` | 308 redirect | `→ /admin/` |
| `/unknown/` | `~ ^/:slug/$` | `current/index.html` 不存在 → 404 | 404 |
| `/admin/deadbeef0000/` | `~ ^/:slug/:hash/$` | `index.html` 不存在 → 404 | 404 |

**实现方式**：`infra/nginx/zipship.conf` 以模板形式保存，测试运行时生成临时 Nginx config 并替换以下变量：

```txt
__ZIPSHIP_LISTEN_PORT__
__ZIPSHIP_SITES_ROOT__
__ZIPSHIP_API_UPSTREAM__
__ZIPSHIP_CONSOLE_ROOT__
__ZIPSHIP_NGINX_PID__
```

不引入新模板依赖；使用 Bun 原生 `Bun.file().text()` + `String.replaceAll()` 替换。

## 测试策略

deepseek-flash 必须测试先行。每个任务都要：

```txt
先写失败测试
运行并确认失败
再改实现
再运行并确认通过
再提交
```

### Storage 单元测试

覆盖：

- `createReleaseStoragePath()` 使用 `projectSlug`。
- `createProjectSitePath()` 返回 `sites/:projectSlug`。
- `createCurrentReleaseLinkPath()` 返回 `sites/:projectSlug/current`。
- `ensureReleaseArtifactReady()` 接受包含 `index.html` 的目录。
- `ensureReleaseArtifactReady()` 拒绝缺失目录。
- `ensureReleaseArtifactReady()` 拒绝缺失 `index.html`。
- `switchCurrentReleaseLink()` 创建相对 symlink `releases/:hash`。
- `switchCurrentReleaseLink()` 重复切换后 `current` 指向新 hash。
- `switchCurrentReleaseLink()` 不留下 `current.tmp`。

### API 测试

在 deployments tests 上补充：

- 上传完成后 `release.storagePath` 包含 `project.slug`，不再包含 `project.id`。
- publish 成功后 `current` symlink 指向 `releases/:hash`。
- rollback 成功后 `current` symlink 指向旧 release hash。
- artifact 缺 `index.html` 时 publish 返回 `RELEASE_ARTIFACT_NOT_FOUND`。
- symlink 替换失败时 publish 返回 `FILESYSTEM_UPDATE_FAILED`。
- symlink 替换失败时 `project.currentReleaseId` 不改变。

这些测试应使用临时 storage root，不依赖真实 `/srv/zipship`。

### Nginx Routing Tests

新增：

```txt
tests/nginx/nginx-routing.test.ts
tests/nginx/fixtures/
```

测试启动前检测：

```bash
nginx -v
```

如果本机没有 nginx，测试应清晰 skip，并输出 skip 原因；不能因为找不到 nginx 失败成不可读错误。CI 安装 nginx 后自然会执行。

必须覆盖：

- `/_api/` 代理到 Elysia 或至少匹配 upstream 配置。
- `/_console/` 返回 console placeholder。
- `/admin` 返回 308，Location 为 `/admin/`。
- `/admin/` 返回 current `index.html`。
- `/admin/assets/index.js` 返回 current asset。
- `/admin/settings` fallback current `index.html`。
- `/admin/settings` 返回 `Cache-Control: no-cache`，不能继承 asset 的 immutable 缓存。
- `/admin/a8f32c91abcd` 返回 308，Location 为 `/admin/a8f32c91abcd/`。
- `/admin/a8f32c91abcd/` 返回 release `index.html`。
- `/admin/a8f32c91abcd/assets/index.js` 返回 release asset。
- `/admin/a8f32c91abcd/settings` fallback release `index.html`。
- `/admin/a8f32c91abcd/settings` 返回 `Cache-Control: no-cache`。
- `/admin/assets/index.js` 和 `/admin/a8f32c91abcd/assets/index.js` 返回长期 immutable 缓存。
- `/admin/not-a-hash/settings` fallback current `index.html`。
- 未知 slug 返回 404。
- 未知 hash 返回 404。

## 文档更新

实现时需要同步更新：

```txt
docs/02-技术架构.md
docs/03-测试规范与实施路线.md
infra/nginx/README.md
tests/README.md
```

文档要明确：

- Phase 4 访问面使用 Nginx + 文件系统。
- release artifact 存储路径为 `sites/:projectSlug/releases/:releaseHash`。
- 发布/回滚通过 `current` 相对 symlink 切换正式版本。
- 内部预览 `/_sites/:projectSlug/:releaseHash/` 继续保留。
- Nginx tests 在无 nginx 时 skip，在有 nginx 的环境中必须通过。

## 非目标

本阶段不做：

- HTTPS。
- 自定义域名。
- Docker Compose。
- 真实 PostgreSQL repository。
- 项目级发布锁。
- project slug rename。
- 历史 storage path 迁移。
- Web Console UI。
- Desktop UI。
- 复杂缓存策略。
- 灰度发布。
- 对象存储。
- 删除 `/_sites` 内部预览。
- 新 npm 依赖。

## 成功标准

- 新上传的 ready release artifact 存在于 `sites/:projectSlug/releases/:releaseHash/`。
- publish 成功后 `sites/:projectSlug/current` 指向目标 release。
- rollback 成功后 `current` 指向回滚目标 release。
- symlink 失败时 API 返回 `FILESYSTEM_UPDATE_FAILED`，且数据库 current 不改变。
- artifact 缺失时 API 返回 `RELEASE_ARTIFACT_NOT_FOUND`。
- Nginx 能访问正式地址 `/:slug/`。
- Nginx 能访问测试地址 `/:slug/:releaseHash/`。
- Nginx 支持 SPA fallback。
- `/_api/`、`/_console/`、`/_sites/` 前缀不被项目 slug 路由误伤。
- 内部预览继续可用。
- 全量验证通过：

```bash
bun test
bun test --coverage
bun run typecheck
bun run db:generate
codegraph sync .
```

如果本机有 nginx，还必须通过：

```bash
bun test tests/nginx
```

如果本机没有 nginx，`tests/nginx` 必须清晰 skip。
