# ZipShip 测试规范与实施计划

## 1. 测试目标

ZipShip 是部署工具，所以测试不能只测页面。

必须重点保证：

```txt
账号登录安全
权限判断正确
上传处理可靠
zip 解压安全
产物检测准确
release hash 稳定
正式发布可控
回滚可靠
Nginx 路由正确
Desktop Deep Link 登录正确
审计日志完整
```

测试体系要服务于一个目标：

> 任何一次上传、发布、回滚，都必须可追踪、可验证、可恢复。

## 2. 测试工具

推荐：

```txt
Bun Test       单元测试、后端集成测试、packages 测试
Playwright    Web E2E 测试
Playwright Electron / 手动 smoke test    Desktop 关键流程测试
Docker Compose / 临时 PostgreSQL         API 集成测试环境
```

Bun 的测试运行器支持 TypeScript、JSX、mock、生命周期钩子、snapshot 和 watch 模式，适合用作 packages 与后端业务逻辑的默认测试工具。

Playwright 适合 Web 端端到端测试，并且 Electron 自动化目前属于实验性支持，所以 Desktop 端第一阶段建议只覆盖关键 smoke test，不要把全部 Desktop 测试都压在 Electron E2E 上。

## 3. 测试目录规范

统一使用：

```txt
tests
```

不要使用：

```txt
test
```

原因是 `tests` 更适合表达“测试集合”，并且适合区分不同测试层级。

推荐结构：

```txt
zipship/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   └── tests/
│   │       ├── integration/
│   │       └── fixtures/
│   │
│   ├── web-shell/
│   │   ├── src/
│   │   └── tests/
│   │       └── e2e/
│   │
│   └── desktop-shell/
│       ├── src/
│       └── tests/
│           ├── smoke/
│           └── deeplink/
│
├── packages/
│   ├── deploy-core/
│   │   ├── src/
│   │   └── tests/
│   │       ├── unit/
│   │       └── fixtures/
│   │
│   ├── storage/
│   │   ├── src/
│   │   └── tests/
│   │       └── unit/
│   │
│   └── shared/
│       ├── src/
│       └── tests/
│           └── unit/
│
└── tests/
    ├── e2e/
    ├── nginx/
    └── fixtures/
```

文件命名：

```txt
*.test.ts       Bun 单元测试 / 集成测试
*.spec.ts       Playwright E2E 测试
*.fixture.ts    测试数据
```

示例：

```txt
validate-release.test.ts
publish-release.test.ts
desktop-login.spec.ts
nginx-routing.spec.ts
```

## 4. 测试分层

### 4.1 Unit Tests 单元测试

覆盖 packages 内部纯逻辑。

重点：

```txt
packages/deploy-core
packages/storage
packages/shared
packages/config
permission.service
desktop-auth.service
```

必须覆盖：

```txt
slug 校验
release hash 生成
manifest 生成
zip slip 检测
index.html 检测
/assets 根路径检测
权限判断
ticket 过期判断
ticket 单次使用判断
```

### 4.2 Integration Tests 集成测试

覆盖 API + DB + 文件系统。

重点：

```txt
注册登录
创建组织
创建项目
上传 zip
处理 release
发布 release
回滚 release
邀请成员
权限拒绝
审计日志写入
Desktop ticket 换 token
```

集成测试应使用独立测试数据库和临时目录：

```txt
ZIPSHIP_DATA_DIR=/tmp/zipship-test
DATABASE_URL=postgres://...
NODE_ENV=test
```

### 4.3 E2E Tests 端到端测试

覆盖真实用户流程。

Web E2E：

```txt
登录
创建项目
上传 zip
查看检测结果
打开测试地址
发布正式版本
访问正式地址
回滚旧版本
邀请成员
权限校验
```

Desktop E2E / Smoke Test：

```txt
账号密码登录
打开浏览器授权
接收 Deep Link
ticket 换取 session
选择 dist 文件夹
压缩上传
上传完成后打开测试地址
```

Desktop 测试第一阶段以 smoke test 为主，不追求覆盖所有 UI 分支。

### 4.4 Nginx Routing Tests

Nginx 路由是项目成败关键，需要独立测试。

必须测试：

```txt
/admin 自动跳转 /admin/
/admin/ 返回 current index.html
/admin/assets/index.js 返回 current assets
/admin/a8f32c91 自动跳转 /admin/a8f32c91/
/admin/a8f32c91/ 返回指定 release index.html
/admin/a8f32c91/assets/index.js 返回指定 release assets
/admin/settings 进入正式版 SPA fallback
/admin/a8f32c91/settings 进入测试版 SPA fallback
/_api/ 代理到 Elysia
/_console/ 返回管理后台
```

测试方式：

```txt
启动测试 Nginx
准备 /srv/zipship-test/sites/...
curl 请求各路径
断言状态码、Location、响应内容
```

## 5. 关键测试用例

### 5.1 slug 校验

必须通过：

```txt
admin
admin-system
admin_system
app123
```

必须拒绝：

```txt
_admin
_api
_console
Admin
admin system
../admin
admin/
favicon.ico
```

### 5.2 release hash

需要保证：

```txt
相同产物生成相同 hash
不同产物生成不同 hash
文件顺序不同不影响 hash
manifest 稳定排序
hash 冲突时能处理
```

### 5.3 zip 安全

必须拒绝：

```txt
../evil.txt
/absolute/path.txt
symbolic link escape
超大文件
超多文件
解压后超过限制
```

### 5.4 Vite base 检测

检测下面风险：

```html
<script src="/assets/index.js"></script>
<link rel="stylesheet" href="/assets/index.css">
```

应该产生 warning：

```txt
root_asset_path_detected
```

检测下面相对路径不应报错：

```html
<script src="./assets/index.js"></script>
<link rel="stylesheet" href="./assets/index.css">
```

### 5.5 发布权限

测试：

```txt
Owner 可以发布
Admin 可以发布
Developer 默认不能发布
Viewer 不能发布
未登录不能发布
非组织成员不能发布
```

### 5.6 并发发布

模拟：

```txt
成员 A 发布 release A
成员 B 同时发布 release B
```

预期：

```txt
只有一个发布流程先获得锁
最终 current_release_id 与 current 软链接一致
deployment 记录顺序正确
无脏状态
```

### 5.7 回滚

测试：

```txt
发布 v1
发布 v2
回滚 v1
```

预期：

```txt
正式地址返回 v1
project.current_release_id 指向 v1
deployment action = rollback
audit_log 有记录
```

### 5.8 Desktop 网页授权登录

测试：

```txt
创建 login_request
网页授权
生成 authorization_code
Deep Link 回调
Desktop 换 token
```

必须覆盖失败场景：

```txt
state 不一致
code 过期
code 已使用
code_verifier 错误
device_id 不一致
用户取消授权
```

### 5.9 Web 主动调起 Desktop

测试：

```txt
Web 生成 ticket
打开 zipship://login?ticket=xxx
Desktop exchange-ticket
```

必须覆盖：

```txt
ticket 过期
ticket 重复使用
ticket 不存在
ticket 不属于当前用户
ticket 已撤销
```

## 6. 测试脚本规范

根 `package.json` 建议：

```json
{
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test packages/*/tests/unit apps/*/tests/unit",
    "test:integration": "bun test apps/api/tests/integration",
    "test:e2e": "playwright test",
    "test:nginx": "bun run tests/nginx/run-nginx-tests.ts",
    "test:desktop": "playwright test apps/desktop-shell/tests",
    "typecheck": "bun run --filter '*' typecheck",
    "lint": "bun run --filter '*' lint"
  }
}
```

Bun 的 `--filter` 可以在 monorepo 中按 package 名称或路径选择包运行命令，适合 workspace 项目做分包脚本。

## 7. 测试数据规范

测试 fixtures 统一放：

```txt
tests/fixtures/
```

建议准备：

```txt
valid-vite-relative-base.zip
valid-vite-root-base-warning.zip
missing-index.zip
zip-slip.zip
too-many-files.zip
large-file.zip
service-worker.zip
sourcemap.zip
```

每个 fixture 要有说明：

```txt
fixture-name
purpose
expected result
```

示例：

```txt
valid-vite-relative-base.zip
用途：测试正常 Vite 产物
期望：检测通过，状态 ready

missing-index.zip
用途：测试缺失 index.html
期望：检测失败，不允许发布
```

## 8. 测试环境规范

测试环境变量：

```txt
NODE_ENV=test
ZIPSHIP_DATA_DIR=/tmp/zipship-test
DATABASE_URL=postgres://zipship_test:zipship_test@localhost:5432/zipship_test
JWT_SECRET=test_secret
DESKTOP_PROTOCOL=zipship
```

每次集成测试前：

```txt
清空测试数据库
清空 ZIPSHIP_DATA_DIR
重新创建必要目录
准备 fixture 项目
```

每次测试后：

```txt
清理 temp
清理 upload
清理 release 测试目录
关闭测试服务
```

## 9. CI 建议

第一阶段 CI 至少包含：

```txt
Install
Typecheck
Lint
Unit Tests
API Integration Tests
Build Web
Build API
Nginx Routing Tests
```

第二阶段增加：

```txt
Web E2E
Desktop Smoke Test
Deep Link Smoke Test
```

CI 顺序：

```txt
bun install
bun run typecheck
bun run lint
bun run test:unit
bun run test:integration
bun run build
bun run test:nginx
bun run test:e2e
```

## 10. 实施计划

### Phase 1：基础工程

```txt
创建 Bun workspace
创建 apps/api
创建 apps/web-shell
创建 packages/shared
创建 packages/db
创建 packages/deploy-core
创建 packages/storage
创建 packages/api-client
创建 packages/console-app
配置 typecheck / lint / test
```

### Phase 2：账号与组织

```txt
用户注册
用户登录
session
默认组织
members
基础角色权限
审计日志
```

### Phase 3：项目与上传

```txt
创建项目
slug 校验
上传 zip
upload_task
release 状态流转
deploy-core 解压检测
生成 release_hash
返回测试地址
```

### Phase 4：Nginx 访问

```txt
准备 /srv/zipship 目录
正式地址 /:slug/
测试地址 /:slug/:hash/
无尾斜杠跳转
SPA fallback
Nginx routing tests
```

### Phase 5：发布与回滚

```txt
发布 release
current 软链接切换
项目发布锁
回滚
deployment 记录
audit_log
active release 保护
```

### Phase 6：Web Console

```txt
登录页
项目列表
项目详情
上传页面
检测报告
版本列表
发布按钮
回滚按钮
成员页面
审计日志页面
```

### Phase 7：Desktop 登录与上传

```txt
Desktop Shell
ElectronRuntime
账号密码登录
Deep Link 注册
浏览器授权登录
Web 主动调起 Desktop
选择 dist 文件夹
本地压缩上传
Desktop smoke tests
```

### Phase 8：协作增强

```txt
邀请成员
修改角色
项目级权限
发布备注
更详细审计日志
检测报告详情
```

## 11. 第一版验收标准

第一版完成后，必须满足：

```txt
1. 用户可以注册和登录。
2. 用户登录后自动进入默认组织。
3. 用户可以创建项目。
4. 项目 slug 不能冲突，不能使用保留词。
5. 用户可以上传 zip 产物。
6. 后端可以安全解压 zip。
7. 后端可以检测 index.html。
8. 后端可以检测 Vite base 风险。
9. 后端可以生成 release hash。
10. 用户可以访问测试地址。
11. 用户可以把测试版本发布为正式版本。
12. 用户访问不带 / 的正式地址时会自动跳转到带 / 地址。
13. 用户可以回滚到旧版本。
14. 发布和回滚不需要 reload Nginx。
15. 所有上传、发布、回滚都有审计日志。
16. 没有权限的用户不能发布项目。
17. Desktop 可以账号密码登录。
18. Desktop 可以通过网页授权登录。
19. 核心逻辑有单元测试。
20. 上传、发布、回滚有集成测试。
21. Nginx 路由有测试。
```

## 12. 不建议第一版实现的内容

第一版不要做：

```txt
自定义域名
源码构建
GitHub 自动构建
复杂审批流
对象存储
多区域部署
复杂流量统计
灰度发布
边缘缓存
Desktop 自动更新
```

这些会显著增加复杂度。

## 13. 最终建议

开发顺序应该是：

```txt
数据模型
权限模型
deploy-core
Nginx 路由
上传发布闭环
测试规范
Web Console
Desktop
```

不要先做漂亮页面。
这个项目成败的核心不是 UI，而是：

```txt
上传是否可靠
检测是否准确
发布是否原子
回滚是否稳定
权限是否正确
审计是否完整
测试是否覆盖关键风险
```
