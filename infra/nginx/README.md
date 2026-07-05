# Nginx

这里放置 ZipShip 的正式地址、测试地址、SPA fallback 和缓存策略配置。

## zipship.conf

Nginx 访问平面配置模板，使用 `__ZIPSHIP_*__` 占位符：

| 占位符 | 默认值 | 说明 |
|--------|--------|------|
| `__ZIPSHIP_LISTEN_PORT__` | `80` | 监听端口 |
| `__ZIPSHIP_NGINX_PID__` | `/var/run/nginx.pid` | PID 文件路径 |
| `__ZIPSHIP_SITES_ROOT__` | 由部署脚本设置 | 站点根目录 |
| `__ZIPSHIP_CONSOLE_ROOT__` | 由部署脚本设置 | 控制台管理界面根目录 |
| `__ZIPSHIP_API_UPSTREAM__` | `http://127.0.0.1:3001` | API 上游地址 |

### 路由规则

- `/_api/*`、`/_sites/*` → 代理到 Elysia API 上游
- `/_console/*` → 控制台管理界面（SPA fallback、no-cache）
- `/:slug/` → 当前版本站点
- `/:slug/:hash/` → 指定版本站点
- `/:slug/path` → 当前版本站点的 SPA fallback
- `/:slug/:hash/path` → 指定版本站点的 SPA fallback

构建产物在 `try_files` 和命名 location 中缓存一年（immutable）；入口 HTML 使用 `Cache-Control: no-cache`。
