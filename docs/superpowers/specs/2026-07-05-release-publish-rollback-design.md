# 发布与回滚控制面设计

## 目标

补齐 ZipShip 的发布与回滚控制面，让已经通过上传处理并处于 `ready` 状态的 release 可以被发布为项目当前版本，也可以回滚到历史可用版本。

本阶段只做后端控制面：

- 发布 release。
- 回滚 release。
- 维护 `projects.currentReleaseId`。
- 维护 release 的 `ready` / `active` 状态。
- 写入 `deployments` 记录。
- 写入 `audit_log`。
- 暴露 deployment 列表。
- 保持内部预览地址对 `ready` 与 `active` release 都可访问。

本阶段不做 Nginx 正式访问、`current` 软链接、自定义域名、Web UI、Desktop UI、审批流或真实并发锁。

## 推荐方案

采用“最小可靠闭环”方案：新增独立 `deployments` feature module，不把发布和回滚逻辑塞进现有 `releases` 列表模块。

```txt
apps/api/src/modules/deployments/
  model.ts
  service.ts
  index.ts
```

原因：

- 发布/回滚是 deployment 行为，不只是 release 查询。
- 模块边界清楚，便于 deepseek-flash 测试先行和后续审核。
- 当前数据库 schema 已经有 `deployments`、`projects.currentReleaseId`、`releases.activatedAt`、`releases.archivedAt`，不需要先扩表。
- Nginx `current` 软链接和访问面可以留到下一轮 Phase 4 单独设计。

## API 契约

新增路由：

```txt
POST /_api/projects/:projectId/releases/:releaseId/publish
POST /_api/projects/:projectId/releases/:releaseId/rollback
GET  /_api/projects/:projectId/deployments
```

`publish` 与 `rollback` 请求体：

```ts
{
  message?: string | null;
}
```

`message` 是可选发布备注。第一版只保存原文，不做富文本、审批流或中英文渲染。

成功响应：

```ts
{
  deployment: Deployment;
  project: Project;
  release: Release;
  previousRelease: Release | null;
}
```

deployment 列表响应：

```ts
{
  deployments: Deployment[];
}
```

错误响应只返回稳定错误码，不返回用户展示文案：

```txt
UNAUTHORIZED
FORBIDDEN
PROJECT_NOT_FOUND
RELEASE_NOT_FOUND
RELEASE_NOT_READY
RELEASE_NOT_ROLLBACKABLE
RELEASE_ALREADY_ACTIVE
VALIDATION_ERROR
```

前端后续通过 i18n 字典把错误码映射成中文或英文。

## 权限规则

所有路由都需要登录。登录方式沿用现有 refresh token bearer header。

权限判断：

```txt
publish  -> publish_release
rollback -> rollback_release
list     -> view_project
```

允许发布和回滚的角色：

```txt
owner
admin
deployer
```

不允许发布和回滚的角色：

```txt
developer
viewer
非组织成员
未登录用户
```

权限服务继续使用 `apps/api/src/modules/permissions/service.ts`，不要在 route 里散落角色判断。

## 发布规则

发布目标必须满足：

- release 存在。
- release 属于当前 project。
- release.status 是 `ready`。
- release.archivedAt 是 `null`。

发布成功后：

```txt
project.currentReleaseId = targetRelease.id
targetRelease.status = active
targetRelease.activatedAt = now
oldActiveRelease.status = ready
deployment.action = publish
deployment.status = success
deployment.previousReleaseId = 切换前的 project.currentReleaseId
deployment.releaseId = targetRelease.id
audit_log.action = release.published
```

如果当前项目还没有 active release，`previousReleaseId` 为 `null`。

发布后 release 从 `ready` 变成 `active`。为了避免用户发布后反而失去内部测试地址，现有 `/_sites/:projectSlug/:releaseHash/` 预览路由和 release 列表的 `previewUrl` 必须同步支持 `ready` 与 `active` 两种状态。`failed`、`processing`、`uploading`、`archived`、`deleted` 仍然不可预览。

## 回滚规则

回滚目标必须满足：

- release 存在。
- release 属于当前 project。
- release.archivedAt 是 `null`。
- release.status 是 `ready`。
- release.id 不等于 `project.currentReleaseId`。

回滚成功后：

```txt
project.currentReleaseId = targetRelease.id
targetRelease.status = active
targetRelease.activatedAt = now
oldActiveRelease.status = ready
deployment.action = rollback
deployment.status = success
deployment.previousReleaseId = 切换前的 project.currentReleaseId
deployment.releaseId = targetRelease.id
audit_log.action = release.rolled_back
```

这里刻意选择：历史 active release 在被新版本替换后回到 `ready`，所以回滚目标只需要是 `ready`。第一版不新增 `previously_active` 状态。

不能回滚到当前 active release，应返回：

```txt
RELEASE_ALREADY_ACTIVE
```

不能回滚 failed、uploading、processing、archived、deleted release，应返回：

```txt
RELEASE_NOT_ROLLBACKABLE
```

## 数据一致性

`projects.currentReleaseId` 是控制面的唯一当前版本来源。

发布和回滚必须作为一个原子操作边界：

```txt
读取切换前 currentReleaseId
旧 active -> ready
目标 release -> active
project.currentReleaseId -> target
创建 deployment success 记录
返回 project、targetRelease、previousRelease、deployment
```

当前 in-memory repository 可以同步完成。未来真实 PostgreSQL repository 必须使用 transaction，保证 project、release、deployment 同成同败。

审计日志由 service 层调用已有 `AuditService.record()`，不藏进 repository：

```txt
release.published
release.rolled_back
```

审计记录必须包含：

```txt
organizationId
projectId
actorId
targetType = release
targetId = targetRelease.id
metadata.previousReleaseId
metadata.releaseId
metadata.deploymentId
metadata.message
```

## Repository 边界

新增 deployment repository 接口，service 不直接依赖数据库实现：

```ts
findSessionByRefreshTokenHash(
  refreshTokenHash: string,
  now: Date,
): Promise<CurrentSession | null>;

findProjectById(projectId: string): Promise<Project | null>;

findMembership(input: {
  organizationId: string;
  userId: string;
}): Promise<{ role: MemberRole } | null>;

findReleaseById(releaseId: string): Promise<Release | null>;

listDeploymentsForProject(projectId: string): Promise<Deployment[]>;

publishRelease(input: {
  projectId: string;
  releaseId: string;
  operatorId: string;
  message: string | null;
  now: Date;
}): Promise<DeploymentMutationResult>;

rollbackRelease(input: {
  projectId: string;
  releaseId: string;
  operatorId: string;
  message: string | null;
  now: Date;
}): Promise<DeploymentMutationResult>;
```

`DeploymentMutationResult`：

```ts
{
  deployment: Deployment;
  project: Project;
  release: Release;
  previousRelease: Release | null;
}
```

repository 方法只处理数据一致性，不做权限判断。权限、错误码映射和审计由 service 负责。

## DTO

`Deployment`：

```txt
id
projectId
releaseId
previousReleaseId
action
status
operatorId
message
createdAt
finishedAt
```

`action` 先使用已有 schema 枚举：

```txt
publish
rollback
```

`status` 第一版只在成功路径写入：

```txt
success
```

失败 deployment 记录留到异步发布或外部访问面阶段再引入。本阶段失败直接返回错误响应，不写 failed deployment。

## Elysia 编码规范

deepseek-flash 实现时必须遵循已有后端规范：

- feature-based 目录：`model.ts`、`service.ts`、`index.ts`。
- `index.ts` 是 Elysia controller/plugin。
- `model.ts` 定义 TypeBox validation model、DTO 类型和模块错误。
- `service.ts` 是不依赖 HTTP 的业务逻辑 class。
- controller 使用 `.model()` 注册命名模型，并在路由中引用模型名称。
- controller 使用 method chaining，不拆成会丢失类型的多次赋值。
- service 返回成功结果或模块错误对象，controller 负责转换成 `status(code, payload)`。
- API 错误 payload 只返回稳定 code，不返回中英文展示文案。
- API 测试优先使用 `@elysia/eden` 的 `treaty(createApp())`。

## 测试策略

deepseek-flash 必须测试先行。每个任务都要：

```txt
先写失败测试
运行并确认失败
再改实现
再运行并确认通过
再提交
```

新增测试文件：

```txt
tests/unit/deployments-routes.test.ts
```

如果 service 分支过多，可以再新增：

```txt
tests/unit/deployments-service.test.ts
```

必须覆盖发布：

- Owner 可以发布 ready release。
- Admin 可以发布 ready release。
- Deployer 可以发布 ready release。
- Developer 不能发布。
- Viewer 不能发布。
- 未登录不能发布。
- 未知 project 返回 `PROJECT_NOT_FOUND`。
- 未知 release 返回 `RELEASE_NOT_FOUND`。
- release 不属于 project 返回 `RELEASE_NOT_FOUND`。
- failed / processing / uploading / archived / deleted release 不能发布。
- archivedAt 非空的 release 不能发布。
- 发布成功后 `project.currentReleaseId` 指向目标 release。
- 发布成功后目标 release.status 是 `active`。
- 发布成功后旧 active release.status 回到 `ready`。
- 发布成功后 deployment.action 是 `publish`。
- 发布成功后 deployment.previousReleaseId 正确。
- 发布成功后 audit_log 写入 `release.published`。
- 发布成功后 active release 的 `previewUrl` 仍然存在。
- 发布成功后 `/_sites/:projectSlug/:releaseHash/` 仍能访问 active release。

必须覆盖回滚：

- Owner 可以回滚。
- Admin 可以回滚。
- Deployer 可以回滚。
- Developer 不能回滚。
- Viewer 不能回滚。
- 未登录不能回滚。
- 不能回滚到当前 active release。
- 不能回滚 failed / processing / uploading / archived / deleted release。
- archivedAt 非空的 release 不能回滚。
- 回滚成功后 `project.currentReleaseId` 指向目标 release。
- 回滚成功后目标 release.status 是 `active`。
- 回滚成功后旧 active release.status 回到 `ready`。
- 回滚成功后 deployment.action 是 `rollback`。
- 回滚成功后 deployment.previousReleaseId 正确。
- 回滚成功后 audit_log 写入 `release.rolled_back`。

必须覆盖 deployment 列表：

- 有 `view_project` 权限可以查看。
- 未登录不能查看。
- 非组织成员不能查看。
- 返回结果按创建时间倒序。

本阶段不做真实并发锁测试，但计划中必须写明：repository 方法是原子操作边界，真实 DB 实现必须 transaction。项目级发布锁属于下一阶段增强。

## 文档更新

实现计划需要同步更新：

```txt
docs/02-技术架构.md
docs/03-测试规范与实施路线.md
```

`docs/02-技术架构.md` 应说明：

- 当前阶段发布/回滚控制面已经以 `projects.currentReleaseId` 为唯一当前版本来源。
- Nginx `current` 软链接与 `/:slug/` 正式访问仍在后续访问面计划中。
- 发布/回滚会写入 deployment 和 audit_log。
- 内部预览地址 `/_sites/:projectSlug/:releaseHash/` 同时支持 `ready` 和 `active` release。

`docs/03-测试规范与实施路线.md` 应说明：

- Phase 5 本计划目标是 publish/rollback API、deployment 记录、audit_log、release 状态流转。
- Nginx current 软链接、routing tests 和真实正式地址访问继续留在 Phase 4 / 访问面计划。

## 非目标

本阶段不做：

- Nginx 配置。
- `/:slug/` 正式地址。
- `/:slug/:hash/` Nginx 测试地址。
- `current` 软链接。
- 自定义域名。
- 项目级并发发布锁。
- 异步发布任务。
- failed deployment 记录。
- 审批流。
- Web Console UI。
- Desktop UI。
- 多语言后端文案。

## 成功标准

- ready release 可以被有权限用户发布。
- 发布后项目 current 指向目标 release。
- 发布后目标 release 是 active，旧 active 回到 ready。
- ready 历史 release 可以被有权限用户回滚。
- 回滚后项目 current 指向目标 release。
- 发布和回滚都写入 deployment 记录。
- 发布和回滚都写入 audit_log。
- 发布后的 active release 仍可通过内部预览地址访问。
- Developer、Viewer、未登录用户不能发布或回滚。
- failed、processing、uploading、archived、deleted release 不能发布或回滚。
- API 错误只返回稳定 code。
- 测试使用 Eden Treaty，且 deepseek-flash 严格测试先行。
- 全量验证通过：

```bash
bun test tests/unit/deployments-routes.test.ts
bun test
bun test --coverage
bun run typecheck
bun run db:generate
codegraph sync .
```
