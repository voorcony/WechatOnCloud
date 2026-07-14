# Changelog

## [Unreleased] - 2026-07-15

### Fixed
- 统一 WOC AI Console 外壳与 `/admin` 实例账号管理内页，避免进入实例账号管理时切到另一套 UI。
- 修复 `/wechat/woc` 子路径路由、`/admin` 嵌套路由命中与模块级错误边界，降低页面白屏风险。
- 统一总览、AI 员工、待确认、对话、监控等核心页的 card/grid/button/text overflow 视觉密度。
- 待确认页以展示队列作为唯一统计口径，修复顶部 KPI 与队列 tab 数字打架问题。
- AI 员工服务控制区改为用户可读的启动/停止状态文案，隐藏 raw lifecycle/restart/dry-run 技术文案。
- 兼容旧用户记录缺少 `createdAt` 的情况，避免 `/api/admin/users` 500。

### Validation
- `npm --prefix panel/web run build`
- `./panel/server/node_modules/.bin/tsc --noEmit --pretty false -p panel/server/tsconfig.json`
- `git diff --check`
- 生产热验证 `/wechat/woc/admin`、`/wechat/woc/approvals`、`/wechat/woc/ai-employees` HTTP 200。
