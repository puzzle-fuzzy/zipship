# Upload Processing Design

## 背景

ZipShip 当前已经具备项目、上传任务、`complete` 状态推进、release 列表，以及 `@zipship/deploy-core` 的 zip 解压、检测、manifest 和 release hash 生成能力。缺口在于 API 还没有接收真实 zip 文件，也没有把 `complete` 后的 `processing` release 推进到 `ready` 或 `failed`。

## 目标

本阶段实现一个可审核、可测试的本地处理闭环：

```txt
创建 upload_task
上传 raw zip 到本地 storage
complete upload_task
调用 deploy-core 解压、检测、生成 manifest
将 release 更新为 ready 或 failed
将 upload_task 更新为 completed 或 failed
项目 release 列表能看到处理结果
```

## 范围

本阶段包含：

- 新增 raw zip 上传入口：`PUT /_api/uploads/:uploadTaskId/raw`。
- 使用根目录 env 的 `ZIPSHIP_STORAGE_ROOT`，通过 `@zipship/storage` 生成 uploads/temp/sites 路径。
- 在 `complete` 后同步调用 `processRelease()`，写入 release 的 `manifest`、`detectResult`、`fileCount`、`totalSize`、`fullHash`、`releaseHash` 和最终 `storagePath`。
- 成功时 release 状态为 `ready`，upload task 状态为 `completed`。
- deploy-core 抛错或检测失败时 release 状态为 `failed`，upload task 状态为 `failed`，错误只存稳定 code，不存中英文展示文案。
- API 测试继续使用 `@elysia/eden` Treaty。

本阶段不包含：

- Nginx 测试地址服务。
- 发布、回滚、项目级发布锁。
- 后台队列或重试系统。
- 真实 PostgreSQL repository。
- 对象存储。
- 前端上传 UI。

## 设计决策

推荐方案是“同步处理，接口先稳定”。`complete` 请求会先把任务推进到 `processing`，然后立即调用 deploy-core。处理完成后再返回最新 upload task。这样测试简单，状态闭环完整；后续要改成后台 job 时，只需要把 `ReleaseProcessingService.processUploadTask()` 从同步调用移动到 job runner。

不推荐本阶段直接做异步队列。当前还没有 job 表、worker 生命周期、重试策略和进程间锁；提前引入会增加大量不可审核的状态面。

不推荐本阶段直接做 Nginx 测试地址。测试地址依赖 release 已经稳定落盘，本阶段先保证 release 内容可被处理、hash 可生成、状态可更新。

## 模块边界

`packages/storage` 只负责本地路径和文件写入，不理解用户、项目、release。

`apps/api/src/modules/uploads` 继续负责上传任务的 HTTP API、认证、权限和任务状态推进。

`apps/api/src/modules/release-processing` 负责把 repository、storage paths 和 `@zipship/deploy-core` 串起来。它不暴露 HTTP route，不做权限判断。

`apps/api/src/modules/auth/repository.ts` 继续作为当前阶段的 in-memory repository，新增处理 release 所需的读写方法。

## 数据模型

API 层的 `UploadTask.status` 需要与数据库枚举对齐：

```ts
"pending" | "uploading" | "processing" | "completed" | "failed"
```

Release 状态继续使用现有枚举：

```ts
"uploading" | "processing" | "ready" | "active" | "failed" | "archived" | "deleted"
```

release 成功结果：

- `status = "ready"`
- `releaseHash = manifest.releaseHash`
- `fullHash = manifest.hash`
- `manifest = ReleaseResult.manifest`
- `detectResult = ReleaseResult.detect`
- `fileCount = manifest.files.length`
- `totalSize = sum(manifest.files[].size)`
- `storagePath = sites/:projectId/releases/:releaseHash`

release 失败结果：

- `status = "failed"`
- `detectResult.items[]` 至少包含一个稳定 `code`
- `uploadTask.errorMessage` 存稳定 code，例如 `DEPLOY_CORE:ZIP_ENTRY_PATH_TRAVERSAL` 或 `DETECT_FAILED`

## 测试策略

所有 API route 测试使用 `@elysia/eden` Treaty。测试不能依赖 `/srv/zipship`，必须为每个测试创建临时 `storageRoot`，并在测试结束后清理。

核心测试：

- raw zip upload 保存文件并把 upload task 推进到 `uploading`。
- complete 一个有效 zip 后，upload task 变为 `completed`，release 变为 `ready`。
- release 列表返回真实 `releaseHash`、manifest 和 detect result。
- missing index 或 `.env` 等检测失败 zip 会得到 `failed` release。
- 未上传 raw zip 就 complete 返回稳定错误码。
- 无权限或未登录仍按现有 Elysia 错误结构返回。

## 审核重点

- 不要把中文或英文 UI 文案写入后端错误字段，只写稳定 code。
- 不要把 deploy-core 逻辑复制进 API。
- 不要让测试留下 `.tmp-*`、`.DS_Store` 或大 zip 临时产物。
- 不要把 release publish/Nginx 访问混入本阶段。
