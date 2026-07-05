# Nginx

`zipship.conf` 是 ZipShip 访问面模板。

测试会替换：

- `__ZIPSHIP_LISTEN_PORT__`
- `__ZIPSHIP_SITES_ROOT__`
- `__ZIPSHIP_CONSOLE_ROOT__`
- `__ZIPSHIP_API_UPSTREAM__`
- `__ZIPSHIP_NGINX_PID__`

本阶段支持：

- `/:slug/` 当前正式版本
- `/:slug/:releaseHash/` 指定测试版本
- `/_api/` API upstream
- `/_console/` Console app
- `/_sites/` 内部预览 upstream
