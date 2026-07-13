# AI 员工二开后台

本次二开目标是把 WechatOnCloud 面板改造成自有 **AI WeChat Console**，生产反代路径保持 `/wechat/woc` 不变，React 内部路由仍使用 `/ai-employees`、`/monitor`、`/i/:id`。

## 品牌与版本

- 面板关于区显示 `AI WeChat Console / Voorcony Build`。
- 服务端 `versionInfo()` 固定返回本地自有构建信息，不再外呼 Docker Hub/GHCR 查询上游官方版本。
- 前端不再显示“升级到官方正式版 / 查看上游新版 / 发布日志”入口，避免把用户引回原版品牌链路。

## 新增页面

### `/monitor` 多实例监控墙

- 复用 WOC 登录态与 `useInstances()` 可见实例范围。
- 支持筛选：全部、在线、异常、未读、AI员工。
- 支持布局：自动、2×2、3×3、4×4。
- 每格展示：实例名、应用类型、AI 员工岗位、状态、VNC 监控 iframe、未读计数、打开新窗口、进入实例、接管。
- 监控墙只展示状态与计数，不展示聊天正文、token、reply 原文。

### `/ai-employees` AI 员工中心

- 继续保留现有真实数据源桥接逻辑：优先读取 `/api/ai-employees/console` 的 allowlist 数据，失败时回退本地演示。
- 视觉文案升级为 AI WeChat Console 信息架构：客户画像、知识库、AI 员工、云微信实例、人工确认。
- 页面不渲染 raw payload，只展示 hash、suffix、计数和 redacted 摘要。

### `/i/:id` 单实例 AI 工作台

- 保留原 VNC 主功能、文件、剪贴板、输入模式、声音、桌面设置等能力。
- 宽屏右侧新增 AI 上下文工作台：AI 员工身份、当前客户画像、安全状态、AI 判断/待确认动作。
- 当前工作台使用安全字段 + 本地稳定 fallback，暂无真实上下文字段时不展示聊天正文。

## 安全边界

- 不新增租户/子账号/实例授权模型，继续复用 WOC `useAuth()` / `useInstances()` / 后端可见实例过滤。
- 不显示聊天正文、客户真实名、token、secret、raw prompt/reply。
- “确认建议 / 发送 / 接管”中除接管复用已有控制权 API 外，真实发送类动作仍保持 disabled 或跳转人审流程。
