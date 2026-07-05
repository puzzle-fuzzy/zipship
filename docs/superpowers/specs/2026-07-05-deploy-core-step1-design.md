# deploy-core Step 1：解压、检测、Hash 纯逻辑库

## 1. 背景

ZipShip 项目目前 API 模块已基本就绪（in-memory repository），但 `packages/deploy-core` 只有 slug 校验。真正的产物解压、安全检测、hash 计算和 manifest 生成尚未实现。

这是后端核心链路（选项 A）的第一步：实现 `deploy-core` 作为可独立测试的纯逻辑库。

## 2. 目标

实现 `packages/deploy-core` 的以下能力：

- 安全解压 zip（防路径逃逸、绝对路径、软链接）
- 产物完整性检测（index.html、assets、文件/体积限制）
- 产物风险检测（Vite base 根路径、service-worker、sourcemap、.env）
- Manifest 生成 + release_hash 计算

## 3. 非目标

- 不涉及 API 集成（路由、controller、repository）
- 不涉及文件系统持久化（storage package）
- 不涉及 publish/rollback 流程
- 不涉及 temp 目录清理（由上层调用方负责）

## 4. 模块结构

```
packages/deploy-core/src/
├── types.ts          # 所有数据类型定义
├── unzip.ts          # 安全解压
├── detect.ts         # 安全检测 + 产物检测
├── manifest.ts       # 文件扫描 → hash → manifest
├── hash.ts           # hash 工具函数（SHA-256）
└── index.ts          # 导出管道函数
```

## 5. 数据类型（types.ts）

```ts
// 解压后的文件条目
export interface FileEntry {
  path: string          // 归一化的相对路径（forward slash）
  content: Uint8Array
  size: number
}

// 检测项
export interface DetectItem {
  level: 'pass' | 'warning' | 'failed'
  code: string          // 稳定错误码，如 'MISSING_INDEX_HTML'
  detail?: string       // 结构化字段（如风险文件名），无展示文案
}

// 检测结果
export interface DetectResult {
  level: 'pass' | 'warning' | 'failed'
  items: DetectItem[]
}

// Manifest 文件项
export interface ManifestEntry {
  path: string
  hash: string          // 文件内容 SHA-256（hex）
  size: number
}

// Manifest
export interface Manifest {
  files: ManifestEntry[]
  hash: string           // 整个 manifest JSON 的 SHA-256
  truncatedHash: string  // 前 12 位 → release_hash
}

// 完整管道产出
export interface ReleaseResult {
  files: FileEntry[]
  detect: DetectResult
  manifest: Manifest
}
```

## 6. 解压（unzip.ts）

使用 `yauzl` 读取 zip entries：

```ts
function safeExtract(zipPath: string, destDir: string): Promise<FileEntry[]>
```

每条 entry 的校验：

| 检查项 | 检测方式 | 结果 |
|--------|----------|------|
| 路径逃逸 | `path.resolve(destDir, relativePath)` 必须在 destDir 内 | 跳过+拒绝 |
| 绝对路径 | entry.fileName 以 `/` 开头 | 跳过+拒绝 |
| 软链接 | entry.unixFileType 为 symlink | 跳过+拒绝 |
| 单文件 > 100MB | entry.uncompressedSize 检查 | 视为 failed |
| 总文件数 > 10000 | 计数超限 | 立即停止，视为 failed |
| 解压后总体积 > 512MB | 累计值超限 | 立即停止，视为 failed |

超过限制后不继续解压，直接抛出错误（让调用方清理 temp 目录）。

## 7. 检测（detect.ts）

```ts
function runDetection(files: FileEntry[]): Promise<DetectResult>
```

扫描逻辑：

### 7.1 文件清单扫描（scanForRisks）

基于文件名和路径的检查（注意：文件数量、总体积、单文件大小限制已在解压阶段由 `safeExtract` 作为硬限制拦截，检测层不做重复检查）：

| 检测项 | 判定条件 | 级别 |
|--------|----------|------|
| 缺失 index.html | 不存在 `index.html` 条目 | failed |
| 缺失 assets 目录 | 不存在 `assets/` 前缀条目 | warning |
| service-worker | 存在 `service-worker.js` 或 sw 注册文件 | warning |
| sourcemap | 存在 `.map` 后缀文件 | warning |
| .env 文件 | 存在 `.env`、`.env.local` 等 | warning |

### 7.2 index.html 内容分析（analyzeIndexHtml）

读取 `index.html` 的前 512KB，正则匹配：

| 检测项 | 正则 | 级别 |
|--------|------|------|
| 根路径资源引用 | `(src\|href)\s*=\s*"/assets/` | warning |
| 绝对路径引用 | `(src\|href)\s*=\s*"/[^/]` 但不是 `/_api`, `/_console` | warning |

### 7.3 结果组合

```ts
// failed items 有任何一个 → level = 'failed'
// 无 failed 但有 warning → level = 'warning'
// 全部 pass → level = 'pass'
```

## 8. Manifest + Hash（manifest.ts）

```ts
function buildManifest(files: FileEntry[]): Promise<Manifest>
```

步骤：
1. 对每个文件计算 SHA-256 hex hash
2. 按 `path` 字典序排序（ASCII 顺序，保证跨平台稳定）
3. 序列化为 JSON：`JSON.stringify({ files })`，不传美化参数。Node/Bun 的 `JSON.stringify` 对同构对象始终输出相同字符串，且 `files` 数组元素顺序已由上一步保证
4. 对 JSON 字符串计算 SHA-256 → `hash`（完整 manifest hash）
5. 取完整 hash 前 12 位 → `truncatedHash`

## 9. 管道函数（index.ts）

```ts
export async function processRelease(
  zipPath: string,
  destDir: string,
): Promise<ReleaseResult> {
  const files = await safeExtract(zipPath, destDir)
  const detect = await runDetection(files)
  const manifest = await buildManifest(files)
  return { files, detect, manifest }
}
```

每步都是纯函数（或干净的可测试函数），可单独调用。

## 10. 第三方依赖

| 依赖 | 用途 | 类型 |
|------|------|------|
| `yauzl` | 读取 zip entries（流式、低内存） | dependencies |
| `@types/yauzl` | yauzl 类型定义 | devDependencies |

`yauzl` 选择原因：Node.js 生态最成熟的 zip 读取库，支持流式逐条读取，不使用 `child_process`，安全可控。

## 11. 测试策略

### 11.1 测试 fixture

准备以下 zip 文件放到 `tests/fixtures/`：

| 文件 | 用途 | 期望结果 |
|------|------|----------|
| valid-vite-relative-base.zip | 正常 Vite 产物，`base: './'` | pass |
| valid-vite-root-base-warning.zip | Vite 产物，`base: '/'` | warning（根路径引用）|
| missing-index.zip | 不存在 index.html | failed |
| zip-slip.zip | 含 `../evil.txt` 条目 | 解压阶段拒绝 |
| absolute-path.zip | 含 `/etc/passwd` 条目 | 解压阶段拒绝 |
| too-many-files.zip | 超过 10000 个文件 | failed |
| large-file.zip | 单文件超过 100MB | failed |
| service-worker.zip | 含 service-worker.js | warning |
| sourcemap.zip | 含 .map 文件 | warning |
| dot-env.zip | 含 .env 文件 | warning |

### 11.2 测试覆盖

```ts
// 解压测试
safeExtract 对正常 zip → 正确解压全部文件
safeExtract 对 zip-slip → 拒绝
safeExtract 对绝对路径 → 拒绝
safeExtract 对空 zip → 返回 []

// 检测测试
runDetection 正常产物 → level === 'pass'
runDetection 缺失 index.html → code === 'MISSING_INDEX_HTML'
runDetection 根路径引用 → code === 'ROOT_ASSET_PATH_DETECTED'

// Hash 测试
buildManifest 相同文件 → 相同 hash
buildManifest 文件顺序不同 → 相同 hash（排序保证）
buildManifest 不同文件 → 不同 hash
truncatedHash 长度 === 12
```

### 11.3 运行方式

```bash
bun test --filter deploy-core  # 仅运行 deploy-core 相关测试
bun test                       # 不影响现有 42 个测试
```

## 12. 目录结构变更

```
packages/deploy-core/
├── package.json     # +yauzl 依赖
├── src/
│   ├── types.ts     # 新建
│   ├── unzip.ts     # 新建
│   ├── detect.ts    # 新建
│   ├── manifest.ts  # 新建
│   ├── hash.ts      # 新建
│   └── index.ts     # 修改：导出新 API
└── tests/           # 新建
    ├── unit/
    │   ├── unzip.test.ts
    │   ├── detect.test.ts
    │   └── manifest.test.ts
    └── fixtures/    # 新建
        ├── scripts/
        │   └── generate-fixtures.ts
        ├── valid-vite-relative-base.zip
        ├── valid-vite-root-base-warning.zip
        └── ...
```

## 13. 边界与错误处理

- `processRelease` 抛出错误的场景：zip 文件损坏、解压超限、解压失败。调用方需负责清理 `destDir`
- Hash 不抛出业务错误，所有文件始终可计算 hash（空 zip 返回空 manifest）
- 检测永远返回结果（不 throw），错误状态通过 `DetectResult.level` 表达
- 所有路径使用 forward slash 归一化
- 不接受文件名编码攻击（`yauzl` 默认处理）
