# Changelog

## [Unreleased] - 2026-07-15

### Changed
- 按 AI Console 设计规范重写总览页展示层：标题、KPI、图表区、待确认/知识库/事件流卡片统一使用 `.card`、`.kpi`、`.btn`、`.dot` 体系。
- 支持同一前端在 `wechat.aipowerlogin.com/dashboard` 下运行，React Router 自动识别 `/dashboard` basename。
- 补齐 dashboard 响应式规则：`<1100px` KPI 固定 2 列，底部三卡先降为 2 列，超窄屏再单列。
- 兼容用户设计 token 中 `.dot.on|busy|warn|off|err` 别名，组件仍优先使用 `st-*` 状态点。

### Fixed
- 修复 AI 员工详情、工具与工作流、系统设置等页面在 1024px 宽度下 card 子 grid 把文本压成一字一行的问题：所有 `1fr` 轨道显式包 `minmax(0, ...)`，并将右侧两列布局提前到 `<1280px` 单列。
- 为 AI Console 关键卡片增加 `min-width`、`word-break` 与 `writing-mode: horizontal-tb` 兜底，避免窄屏竖排/挤压。
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
