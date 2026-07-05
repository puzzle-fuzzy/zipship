# deploy-core Step 1：静态产物解压、检测、Manifest 与 Hash 设计

## 1. 背景

ZipShip 是一个用于快速部署 Vite 打包产物、静态 HTML 和前端静态资源包的部署工具。

当前项目中，API 模块已经具备基础雏形，但 `packages/deploy-core` 还没有实现真正的产物处理能力。`deploy-core` 是整个部署链路的核心底层模块，它负责把用户上传的 zip 产物转换成一个可检测、可预览、可发布的 Release。

本阶段目标是实现 `packages/deploy-core` 的第一版能力：

```txt
上传 zip
↓
安全读取 zip entries
↓
解压到工作目录
↓
识别产物根目录
↓
执行安全检测和产物检测
↓
生成 manifest
↓
计算 release hash
↓
返回可供 API 层入库和发布的结构化结果
```

## 2. 模块定位

`deploy-core` 不是纯函数库，也不是完整部署服务。

它的准确定位是：

> 一个无 API 依赖、无数据库依赖、无业务账号依赖的静态产物处理核心库。

它可以操作调用方传入的临时工作目录，但不负责：

```txt
1. 用户认证
2. 权限判断
3. 数据库写入
4. 最终 storage 持久化
5. current 软链接发布
6. 回滚
7. temp 目录定时清理
8. HTTP 路由
```

它只负责：

```txt
1. 安全读取 zip
2. 安全解压
3. 识别产物根目录
4. 检测产物风险
5. 生成 manifest
6. 计算 release hash
7. 返回结构化处理结果
```

## 3. 目标

本阶段实现以下能力：

```txt
1. 安全解压 zip
2. 防止路径逃逸
3. 防止绝对路径写入
4. 防止 Windows drive path
5. 防止软链接和非普通文件
6. 限制文件数量
7. 限制单文件大小
8. 限制解压后总体积
9. 识别 dist/ 这类单一顶层目录
10. 检测 index.html
11. 检测 Vite base 根路径风险
12. 检测 service worker 风险
13. 检测 sourcemap 风险
14. 检测敏感文件风险
15. 生成 manifest
16. 生成稳定 release hash
```

## 4. 非目标

本阶段不实现：

```txt
1. API controller
2. repository
3. 数据库模型
4. 上传接口
5. 发布 current 软链接
6. 回滚流程
7. Nginx 配置
8. 对象存储
9. 产物自动修复
10. 自动重写 index.html
11. 自动删除 sourcemap
```

## 5. 推荐目录结构

```txt
packages/deploy-core/
├── package.json
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── errors.ts
│   ├── limits.ts
│   ├── path.ts
│   ├── unzip.ts
│   ├── root.ts
│   ├── detect.ts
│   ├── manifest.ts
│   └── hash.ts
└── tests/
    ├── unit/
    │   ├── path.test.ts
    │   ├── unzip.test.ts
    │   ├── root.test.ts
    │   ├── detect.test.ts
    │   └── manifest.test.ts
    └── fixtures/
        ├── scripts/
        │   └── generate-fixtures.ts
        ├── valid-vite-relative-base.zip
        ├── valid-vite-root-base-warning.zip
        ├── nested-dist-folder.zip
        ├── missing-index.zip
        ├── zip-slip.zip
        ├── backslash-zip-slip.zip
        ├── windows-drive-path.zip
        ├── absolute-path.zip
        ├── symlink.zip
        ├── duplicate-path.zip
        ├── service-worker.zip
        ├── sourcemap.zip
        ├── dot-env.zip
        ├── secret-file.zip
        └── css-root-url.zip
```

## 6. 第三方依赖

推荐使用：

```txt
yauzl
```

用途：

```txt
1. 读取 zip entries
2. lazyEntries 模式逐个处理 entry
3. 避免一次性读取整个 zip
4. 便于在解压过程中做安全检测和大小限制
```

安装：

```bash
bun add yauzl
bun add -d @types/yauzl
```

## 7. 核心类型设计

### 7.1 ProcessReleaseOptions

```ts
export interface ProcessReleaseOptions {
  zipPath: string
  workDir: string
  limits?: Partial<ReleaseLimits>
  detectMode?: 'auto' | 'vite' | 'static'
}
```

说明：

```txt
zipPath：上传后的原始 zip 文件路径
workDir：调用方提供的临时工作目录
limits：本次处理限制
detectMode：检测模式，默认 auto
```

### 7.2 ReleaseLimits

```ts
export interface ReleaseLimits {
  maxFiles: number
  maxSingleFileSize: number
  maxTotalUncompressedSize: number
  maxIndexHtmlAnalyzeSize: number
  maxCssAnalyzeSize: number
}
```

默认值建议：

```ts
export const DEFAULT_RELEASE_LIMITS: ReleaseLimits = {
  maxFiles: 10_000,
  maxSingleFileSize: 100 * 1024 * 1024,
  maxTotalUncompressedSize: 512 * 1024 * 1024,
  maxIndexHtmlAnalyzeSize: 512 * 1024,
  maxCssAnalyzeSize: 1 * 1024 * 1024,
}
```

### 7.3 FileEntry

不要把完整文件内容放进内存。

错误设计：

```ts
export interface FileEntry {
  path: string
  content: Uint8Array
  size: number
}
```

正确设计：

```ts
export interface FileEntry {
  path: string
  absPath: string
  size: number
  hash?: string
}
```

说明：

```txt
path：归一化后的相对路径，使用 forward slash
absPath：解压后的磁盘绝对路径
size：文件大小
hash：文件内容 SHA-256，manifest 阶段生成
```

### 7.4 DetectItem

```ts
export interface DetectItem {
  level: 'info' | 'warning' | 'failed'
  code: string
  details?: Record<string, unknown>
}
```

说明：

```txt
level：检测级别
code：稳定错误码，不直接作为展示文案
details：结构化详情，供 API 和前端展示
```

### 7.5 DetectResult

```ts
export interface DetectResult {
  level: 'pass' | 'warning' | 'failed'
  items: DetectItem[]
}
```

结果组合规则：

```txt
存在 failed → DetectResult.level = failed
无 failed 但存在 warning → DetectResult.level = warning
否则 → DetectResult.level = pass
```

### 7.6 ManifestEntry

```ts
export interface ManifestEntry {
  path: string
  hash: string
  size: number
}
```

### 7.7 Manifest

```ts
export interface Manifest {
  version: number
  hashAlgorithm: string
  files: ManifestEntry[]
  hash: string
  releaseHash: string
}
```

说明：

```txt
version：manifest 格式版本号，第一版为 1
hashAlgorithm：使用的哈希算法，固定 "sha256"
hash：完整 manifest hash（对 JSON 序列化的内容做 hash）
releaseHash：默认取完整 hash 前 12 位
```

### 7.8 ReleaseResult

```ts
export interface ReleaseResult {
  rootDir: string
  files: FileEntry[]
  detect: DetectResult
  manifest: Manifest
}
```

说明：

```txt
rootDir：最终识别出的产物根目录
files：相对 rootDir 的文件清单
detect：检测结果
manifest：manifest 和 hash 信息
```

## 8. 错误类型

新增统一错误类：

```ts
export class DeployCoreError extends Error {
  constructor(
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'DeployCoreError'
  }
}
```

常见错误码：

```txt
ZIP_OPEN_FAILED
ZIP_ENTRY_PATH_TRAVERSAL
ZIP_ENTRY_ABSOLUTE_PATH
ZIP_ENTRY_WINDOWS_DRIVE_PATH
ZIP_ENTRY_NUL_BYTE
ZIP_ENTRY_UNSUPPORTED_TYPE
ZIP_ENTRY_SYMLINK
ZIP_ENTRY_DUPLICATE_PATH
ZIP_TOO_MANY_FILES
ZIP_SINGLE_FILE_TOO_LARGE
ZIP_TOTAL_SIZE_TOO_LARGE
ZIP_EXTRACT_FAILED
MANIFEST_HASH_FAILED
```

## 9. 路径安全规则

路径安全是本模块最重要的能力之一。

必须实现：

```ts
export function normalizeZipEntryPath(entryName: string): string
```

处理规则：

```txt
1. 将反斜杠 \ 替换为 /
2. 拒绝空路径
3. 拒绝 NUL 字符
4. 拒绝以 / 开头的绝对路径
5. 拒绝 //server/share 这类路径
6. 拒绝 Windows drive path，例如 C:/xxx、C:\xxx
7. 拒绝任何 .. 片段
8. 去掉开头的 ./
9. 合并重复 /
10. 统一 Unicode normalization（NFC）
11. 不转换大小写（Unix 文件系统大小写敏感，保留原样）
12. 最终只返回安全的相对路径
```

必须拒绝：

```txt
`../evil.txt`
`..\evil.txt`
`assets/../../evil.txt`
`/etc/passwd`
`C:\Windows\system.ini`
`C:/Windows/system.ini`
`//server/share/file.txt`
`abc\..\evil.txt`
`file\0name.txt`
```

允许：

```txt
`index.html`
`assets/index.js`
`assets/css/style.css`
`./assets/index.js`
```

## 10. 解压设计

函数：

```ts
export async function safeExtractZip(
  zipPath: string,
  workDir: string,
  limits?: Partial<ReleaseLimits>,
): Promise<FileEntry[]>
```

### 10.1 解压策略

```txt
1. 使用 yauzl lazyEntries 逐个读取 entry
2. 每个 entry 先做路径规范化
3. 只允许 directory 和 regular file
4. 禁止 symlink 和其他特殊文件
5. 根据 entry.uncompressedSize 做快速预判
6. 解压 stream 时继续统计真实字节数
7. 超过限制立即中断并抛错
8. 写入文件前确保父目录存在（mkdir parents）
9. 写入完毕后再读取下一个 entry
10. 返回 FileEntry[]
```

### 10.2 限制策略

| 限制项   |   默认值 | 处理                |
| ----- | ----: | ----------------- |
| 文件数量  | 10000 | 超过立即 failed       |
| 单文件大小 | 100MB | 超过立即 failed       |
| 总解压体积 | 512MB | 超过立即 failed       |
| 危险路径  |   不允许 | 整个 release failed |
| 软链接   |   不允许 | 整个 release failed |
| 重复路径  |   不允许 | 整个 release failed |

### 10.3 重复路径

同一个 zip 中不允许出现重复归一化路径。

例如：

```txt
assets/index.js
assets//index.js
./assets/index.js
```

如果归一化后都变成：

```txt
assets/index.js
```

则视为重复路径，直接失败。

### 10.4 目录 Entry

目录 entry 不加入 `FileEntry[]`。

例如：

```txt
assets/
```

只创建目录，不进入文件清单。

### 10.5 文件权限策略

解压写入的文件统一设置权限：

```txt
普通文件：0o644（rw-r--r--）
目录：    0o755（rwxr-xr-x）
```

不继承 zip entry 中存储的 Unix 权限位（防止 zip 中存储的 setuid、setgid 或其他危险权限被继承）。

## 11. 产物根目录识别

很多用户压缩产物时会出现两种结构。

结构 A：

```txt
dist.zip
├── index.html
└── assets/
```

结构 B：

```txt
dist.zip
└── dist/
    ├── index.html
    └── assets/
```

为了符合“快速出餐”的产品体验，应支持自动识别单一顶层目录。

函数：

```ts
export function resolveArtifactRoot(files: FileEntry[], workDir: string): {
  rootDir: string
  files: FileEntry[]
}
```

规则：

```txt
1. 如果根目录存在 index.html，则 rootDir = workDir。
2. 如果根目录不存在 index.html，但只有一个顶层目录，且该目录下存在 index.html，则 rootDir = 该顶层目录。
3. 返回的 files 需要重新计算相对 rootDir 的 path。
4. 如果无法找到 `index.html`，不抛错，`rootDir = workDir` 原样返回，交给 detect 阶段返回 `failed`。
```

示例：

```txt
dist/index.html
dist/assets/index.js
```

转换后：

```txt
index.html
assets/index.js
```

## 12. 检测设计

函数：

```ts
export async function runDetection(
  files: FileEntry[],
  options?: {
    detectMode?: 'auto' | 'vite' | 'static'
    maxIndexHtmlAnalyzeSize?: number
  },
): Promise<DetectResult>
```

### 12.1 必须检测项

| 检测项            | 条件                               | 级别      | code                              |
| -------------- | -------------------------------- | ------- | --------------------------------- |
| 缺失 index.html  | 无 index.html                     | failed  | MISSING_INDEX_HTML                |
| 根路径 assets 引用  | HTML/CSS 中出现 /assets             | warning | ROOT_ASSET_PATH_DETECTED          |
| 其他根路径引用        | HTML/CSS 中出现 /xxx                | warning | ROOT_PATH_REFERENCE_DETECTED      |
| 平台保留路径引用       | 出现 /_api、/_console 等             | warning | RESERVED_PLATFORM_PATH_REFERENCED |
| service worker | 存在 service-worker.js、sw.js 或注册语句 | warning | SERVICE_WORKER_DETECTED           |
| sourcemap      | 存在 .map 文件                       | warning | SOURCE_MAP_DETECTED               |
| .env 文件        | 存在 .env 或 .env.*                 | failed  | ENV_FILE_DETECTED                 |
| 密钥文件           | 存在 *.pem、*.key、id_rsa 等          | failed  | SECRET_FILE_DETECTED              |
| .git 目录        | 存在 .git/                         | failed  | GIT_DIR_DETECTED                  |
| 系统垃圾文件         | 存在 `.DS_Store`、`Thumbs.db`、`__MACOSX/` | info    | SYSTEM_FILE_DETECTED              |

### 12.2 assets 目录检测

不要简单地把“缺失 assets 目录”定义为 warning。

正确规则：

```txt
1. 如果 index.html 引用了 assets，但文件清单里没有 assets/，则 warning。
2. 如果 index.html 没有引用 assets，且没有 assets/，则 pass。
3. 如果 detectMode = vite，可以将缺失 assets 作为 info 或 warning。
4. 如果 detectMode = static，不应因缺失 assets 报 warning。
```

建议错误码：

```txt
REFERENCED_ASSETS_DIR_MISSING
```

### 12.3 index.html 内容分析

只读取 `index.html` 的前 `maxIndexHtmlAnalyzeSize` 字节，默认 512KB。

需要支持：

```txt
1. 双引号
2. 单引号
3. 大小写
4. 属性中间空格
5. src
6. href
7. poster
8. data-src
9. modulepreload
```

需要检测：

```html
<script src="/assets/index.js"></script>
<script src='/assets/index.js'></script>
<link href="/assets/index.css">
<img src="/logo.png">
<link rel="modulepreload" href="/assets/index.js">
```

### 12.4 CSS 内容分析

CSS 文件只扫描前 1MB（`maxCssAnalyzeSize`，默认 1MB）。超过 1MB 的 CSS 文件直接跳过扫描（超大 CSS 通常为压缩后产物，风险极低）。

检测：

```css
url('/assets/font.woff2')
url("/assets/bg.png")
url(/assets/bg.png)
```

对应 code：

```txt
ROOT_ASSET_PATH_DETECTED
```

### 12.5 不自动修复

第一版只检测，不自动修改产物。

不做：

```txt
1. 不重写 index.html
2. 不修改 JS
3. 不修改 CSS
4. 不删除 sourcemap
5. 不删除 .env
```

API 层可以根据 `DetectResult` 决定是否允许发布。

## 13. Manifest 设计

函数：

```ts
export async function buildManifest(files: FileEntry[]): Promise<Manifest>
```

步骤：

```txt
1. 对每个文件使用 stream 计算 SHA-256。
2. 生成 ManifestEntry。
3. 按 path 使用稳定 ASCII 字典序排序。
4. 序列化为 JSON.stringify({ version: 1, hashAlgorithm: "sha256", files })。
5. 对 JSON 字符串计算 SHA-256。
6. 得到完整 manifest hash。
7. 默认取前 12 位作为 releaseHash。
```

Manifest 示例：

```json
{
  "version": 1,
  "hashAlgorithm": "sha256",
  "files": [
    {
      "path": "assets/index.js",
      "hash": "c2b1...",
      "size": 10240
    },
    {
      "path": "index.html",
      "hash": "a92d...",
      "size": 512
    }
  ],
  "hash": "a8f32c91abcd...",
  "releaseHash": "a8f32c91abcd"
}
```

## 14. releaseHash 冲突策略

`deploy-core` 默认只负责生成候选 `releaseHash`。

冲突检测通常需要 API 层查询数据库或文件系统，因此不应完全放在 `deploy-core` 内部。

建议约定：

```txt
1. deploy-core 生成完整 manifest hash。
2. deploy-core 默认返回前 12 位 releaseHash。
3. API 层检查同项目下 releaseHash 是否已存在。
4. 如果 releaseHash 已存在且 full hash 相同，视为重复上传。
5. 如果 releaseHash 已存在但 full hash 不同，将 releaseHash 扩展到 16 位。
6. 如仍冲突，继续扩展到 20 位、24 位，直到不冲突。
```

可提供工具函数：

```ts
export function deriveReleaseHash(fullHash: string, length = 12): string
```

## 15. 主流程函数

```ts
export async function processRelease(
  options: ProcessReleaseOptions,
): Promise<ReleaseResult> {
  const limits = resolveReleaseLimits(options.limits)

  const extractedFiles = await safeExtractZip(
    options.zipPath,
    options.workDir,
    limits,
  )

  const { rootDir, files } = resolveArtifactRoot(
    extractedFiles,
    options.workDir,
  )

  const detect = await runDetection(files, {
    detectMode: options.detectMode ?? 'auto',
    maxIndexHtmlAnalyzeSize: limits.maxIndexHtmlAnalyzeSize,
  })

  const manifest = await buildManifest(files)

  return {
    rootDir,
    files,
    detect,
    manifest,
  }
}
```

注意：

```txt
1. 解压失败、安全失败、超限失败 → throw DeployCoreError。
2. 缺失 index.html → 不 throw，由 detect 返回 failed。
3. 空 zip → 解压成功，但 detect 返回 MISSING_INDEX_HTML。
4. Hash 失败 → throw DeployCoreError。
5. 调用方负责清理 workDir。
```

## 16. API 层接入建议

API 层收到 `ReleaseResult` 后，可以这样处理：

```txt
1. 如果 processRelease 抛出 DeployCoreError：
   - release.status = failed
   - 写入错误 code 和 details
   - 清理 temp

2. 如果 detect.level = failed：
   - release.status = failed 或 blocked
   - 保留检测结果
   - 不允许发布

3. 如果 detect.level = warning：
   - release.status = ready
   - 前端展示风险提示
   - 是否允许发布由项目策略决定

4. 如果 detect.level = pass：
   - release.status = ready
   - 生成测试地址
```

## 17. 测试策略

统一测试目录：

```txt
packages/deploy-core/tests/
```

测试命令建议：

```bash
bun test packages/deploy-core/tests
```

根目录可以增加脚本：

```json
{
  "scripts": {
    "test:deploy-core": "bun test packages/deploy-core/tests"
  }
}
```

## 18. Fixture 清单

必须准备：

| Fixture                          | 用途                      | 期望            |
| -------------------------------- | ----------------------- | ------------- |
| valid-vite-relative-base.zip     | 正常 Vite 产物，base: './'   | pass          |
| valid-vite-root-base-warning.zip | Vite 产物，base: '/'       | warning       |
| nested-dist-folder.zip           | zip 内部有 dist/index.html | pass，并识别 root |
| missing-index.zip                | 缺失 index.html           | failed        |
| empty.zip                        | 空 zip                   | failed        |
| zip-slip.zip                     | ../evil.txt             | throw         |
| backslash-zip-slip.zip           | ..\evil.txt             | throw         |
| windows-drive-path.zip           | C:\evil.txt             | throw         |
| absolute-path.zip                | /etc/passwd             | throw         |
| symlink.zip                      | symlink entry           | throw         |
| duplicate-path.zip               | 重复归一化路径                 | throw         |
| too-many-files.zip               | 超过文件数限制                 | throw         |
| large-file.zip                   | 单文件过大                   | throw         |
| service-worker.zip               | 包含 service-worker.js    | warning       |
| sourcemap.zip                    | 包含 .map                 | warning       |
| dot-env.zip                      | 包含 .env                 | failed        |
| secret-file.zip                  | 包含 private.pem/id_rsa   | failed        |
| git-dir.zip                      | 包含 .git/config          | failed        |
| css-root-url.zip                 | CSS 中 url('/assets/x')  | warning       |
| reserved-api-path.zip            | 引用 /_api/               | warning       |
| single-quote-root-asset.zip      | 单引号 /assets             | warning       |
| zero-byte-file.zip               | 0 字节文件                  | pass          |
| exact-limit-size.zip             | 刚好等于限制                  | pass          |
| over-limit-size.zip              | 超过限制 1 byte             | throw         |

## 19. 单元测试覆盖

### 19.1 path.test.ts

必须覆盖：

```txt
normalizeZipEntryPath('index.html') → index.html
normalizeZipEntryPath('./assets/index.js') → assets/index.js
normalizeZipEntryPath('`../evil.txt`') → throw
normalizeZipEntryPath('`..\evil.txt`') → throw
normalizeZipEntryPath('`/etc/passwd`') → throw
normalizeZipEntryPath('`C:\evil.txt`') → throw
normalizeZipEntryPath('`C:/evil.txt`') → throw
normalizeZipEntryPath('`file\0name.txt`') → throw
```

### 19.2 unzip.test.ts

必须覆盖：

```txt
正常 zip 解压成功
zip-slip 被拒绝
反斜杠 zip-slip 被拒绝
绝对路径被拒绝
Windows drive path 被拒绝
symlink 被拒绝
重复路径被拒绝
超过文件数限制被拒绝
超过单文件限制被拒绝
超过总体积限制被拒绝
```

### 19.3 root.test.ts

必须覆盖：

```txt
根目录存在 index.html → rootDir = workDir
dist/index.html → rootDir = dist
多顶层目录且无根 index.html → 不强行选择
空 zip → 无 root，但不 throw
```

### 19.4 detect.test.ts

必须覆盖：

```txt
正常 Vite 相对路径 → pass
缺失 index.html → failed
根路径 /assets → warning
CSS url('/assets/x') → warning
service-worker.js → warning
.map → warning
.env → failed
private.pem → failed
.git/config → failed
/_api 引用 → warning
没有 assets 但也没有引用 assets → pass
引用 assets 但缺失 assets 目录 → warning
```

### 19.5 manifest.test.ts

必须覆盖：

```txt
相同文件生成相同 hash
文件顺序不同生成相同 hash
不同内容生成不同 hash
releaseHash 默认长度为 12
deriveReleaseHash(fullHash, 16) 返回 16 位
manifest files 按 path 稳定排序
```

## 20. 实现注意事项

### 20.1 不要读全量内容到内存

禁止：

```txt
把所有文件内容放入 FileEntry.content
把整个 zip 一次性读入 Buffer
把所有解压文件一次性读入内存 hash
```

应该：

```txt
entry stream → file write stream
file read stream → hash
index.html 小范围读取 → 内容检测
```

### 20.2 不要自动修复用户产物

第一版只检测，不修改。

原因：

```txt
1. 自动重写 HTML 可能漏掉 JS 动态 import。
2. 自动重写 CSS url 可能破坏路径。
3. 自动删除 sourcemap 可能让用户困惑。
4. 自动修复应该作为后续独立功能。
```

### 20.3 不要混入业务逻辑

`deploy-core` 不应该知道：

```txt
userId
projectId
organizationId
database
release 表
current 软链接
```

这些都属于 API 层或 publish 模块。

### 20.4 release 不可变

`deploy-core` 输出的处理结果应对应一个不可变 release。

如果用户重新上传，即使文件名一样，也应该重新处理并生成新的候选结果。

## 21. 最终验收标准

完成本阶段后，需要满足：

```txt
1. 可以安全处理正常 Vite zip。
2. 可以识别 dist/ 外层目录。
3. 可以阻止 zip-slip。
4. 可以阻止 Windows 路径逃逸。
5. 可以阻止绝对路径。
6. 可以阻止 symlink。
7. 可以限制文件数量。
8. 可以限制单文件大小。
9. 可以限制总体积。
10. 可以检测缺失 index.html。
11. 可以检测 Vite root base 风险。
12. 可以检测 service worker。
13. 可以检测 sourcemap。
14. 可以检测 .env 和密钥文件。
15. 可以生成稳定 manifest。
16. 可以生成稳定 releaseHash。
17. 相同产物 hash 一致。
18. 文件顺序不影响 hash。
19. 所有核心能力都有单元测试。
20. `bun test packages/deploy-core/tests` 可以通过。
```

## 22. 本阶段结论

本阶段的重点不是 API，也不是发布流程，而是把静态产物处理能力做扎实。

最重要的原则：

```txt
1. 安全优先。
2. 不信任 zip 元数据。
3. 不把大文件全部读进内存。
4. Release 内容不可变。
5. 检测只报告，不自动修改。
6. Hash 必须稳定。
7. 测试必须覆盖危险路径和边界条件。
```

只有 `deploy-core` 稳定，后续上传、预览、发布、回滚才有可靠基础。
