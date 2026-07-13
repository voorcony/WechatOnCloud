# AI 员工二开后台

本次二开目标是把 WechatOnCloud 面板改造成自有 **AI WeChat Console**，生产反代路径保持 `/wechat/woc` 不变，React 内部路由仍使用 `/ai-employees`、`/monitor`、`/i/:id`。

## 品牌与版本

- 面板关于区显示 `AI WeChat Console / Voorcony Build`。
- 服务端 `versionInfo()` 固定返回本地自有构建信息，不再外呼 Docker Hub/GHCR 查询上游官方版本。
- 前端不再显示“升级到官方正式版 / 查看上游新版 / 发布日志”入口，避免把用户引回原版品牌链路。

## 信息架构（PR1：总控台 / 导航重构）

二开后默认首页不再是「云微信实例管理工具」，而是 **AI WeChat Console 总控台**。旧的云微能力（登录、子账号、实例授权、VNC、文件、剪贴板、代理、实例生命周期）全部保留，只是从「主叙事」下沉成 AI 员工的**底座能力**。

### 侧栏导航（产品化排序）

```text
总控台      /              —— AI 运营总控台（默认首页）
AI 员工     /ai-employees  —— AI 员工中心
客户        /ai-employees?tab=customers  —— 直达客户画像分段
待确认      /ai-employees?tab=pending    —— 直达待人工确认分段
监控墙      /monitor       —— 多实例 VNC 监控
微信实例    （侧栏底部实例列表，底座区域）
系统设置    /admin
```

- 品牌名从「云微」改为「AI Console」。
- 「客户 / 待确认」本 PR 先跳转到 AI 员工中心对应 tab（`?tab=` 直达并回填高亮），视觉上是独立产品模块。AI 员工中心随 URL `?tab=` 同步分段。
- 「微信实例」不再是主导航叙事，作为侧栏底部的实例列表（底座）。

### `/` 总控台（默认首页）

第一眼回答五个问题：今天 AI 员工干了什么 / 哪些微信在线 / 哪些客户要处理 / 哪些动作等我确认 / 哪里需要接管。

结构：

- **Hero**：AI WeChat Console · 24/7 私域 AI 员工团队 + 在岗员工 / 在线微信统计。
- **KPI**：今日消息 / AI 处理 / 待确认 / 在线微信 / 高意向客户 / 异常。
- **主区左**：AI 员工在岗 + 今日任务。
- **主区中**：实时运营时间线（Linear 风格局部深色面板，只显示脱敏摘要）+ 待确认动作（只读计数，不触发真实微信动作）。
- **主区右**：高意向客户（hash + 阶段 + 意向分）+ 风险提醒（异常实例可一键进入接管）+ 快捷入口。
- **底部**：微信实例健康概览（承接旧 HomeView 的实例卡片能力，改造为底座区域，不再是主视觉）。

数据来源：`useInstances()` 真实实例状态 + `/api/ai-employees/console` 真实只读快照，失败时回退 deterministic（按实例 id 派生、不跳动）演示数据。演示态有明确数据源提示条。

视觉：温暖浅底（`--warm`）+ AI 蓝紫强调色（`--ai-accent`，区别于云微绿），沿用既有 `--surface / --crease / --sheen` 主题变量，兼容亮/暗与折叠侧栏，桌面/平板/手机三档响应式不崩。

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

## 信息架构（PR2：AI 员工详情产品化）

PR2 把 `/ai-employees` 从「数据表 / 卡片集合」升级成真正的 **AI 员工管理中心**：像管理真实客服 / SCRM 团队一样管理 AI 员工，而不是一堆指标。设计参考 Intercom（客户侧边栏 / AI 建议）、Gorgias·Zendesk（员工效率 / 待处理 / 权限边界）、Linear（高密度列表 + detail pane + 状态 badges）、SCRM（客户阶段 / 标签 / 归属员工）。

### 归一化 ViewModel

真实模式（`/api/ai-employees/console` 的 `mode="real"`）与本地演示 fallback 都先归一化成同一套 `EmployeeVM / CustomerVM / RunVM / KnowledgeVM / PendingVM`，因此名册、详情、各 tab 组件对两种来源完全一致，只是数据源不同：

- 真实模式：`buildRealVM()` 按 `bound_employee_ids` 把 `instance_cards` 挂到员工、按实例 hash 把 `customer_cards` 归属到员工、按 `employee_id` 收敛 `recent_runs`；权限键从员工绑定的实例 `permission_keys` 聚合去重。
- 演示模式：`buildDemoVM()` 按 index 把可见实例分配到岗位形成 1~4 个 demo 员工，deterministic（`seedOf` 派生）不跳动；派生出的 name/responsibility「指纹」为 `fakeHash()` 合成，不含任何真实字段。

### Tabs（产品化导航）

```text
员工总览  overview   —— 员工名册（左）+ 员工详情（右）
客户画像  customers  —— 风险筛选 + 意向排序的客户卡
知识库    knowledge  —— 导入 Markdown + 文档 / 切片 / 状态表
待确认    pending    —— 只读计数 + 脱敏草稿（按钮 disabled，不触发真实动作）
绑定秘书  bind       —— 一次性绑定二维码 + 控制通道表
运行记录  runs       —— 全员运行时间线（脱敏摘要）
```

侧栏 `?tab=customers` / `?tab=pending` 及总控台的 `?tab=bind` / `?tab=knowledge` 直达仍有效（段 key 保留）。

### 员工总览 = 名册 + 详情 pane

- **左·名册**：员工头像（岗位色 + emoji）、姓名（`岗位助理 ···name_suffix`）、岗位 badge、状态 badge（在岗 / 暂停 / 异常）、负责微信 / 负责客户 / 待确认计数。列表 + detail pane 布局，窄屏降级为单列。
- **右·详情**：
  - **身份人格**：岗位、`name_suffix` / `name_hash` 前缀、快捷指标（负责微信 / 客户 / 运行 / 待确认）。
  - **AI 行为边界**：按岗位生成的产品文案（非员工原始职责原文）；职责只显示 `responsibility_len` + `responsibility_hash`。
  - **权限策略**：`approval_policy_keys/count`、`memory_policy_keys/count`、操作 `permission_keys/count`，均渲染成中文 chips。
  - **负责微信**：实例卡（命中可见实例可跳转），显示状态 / 应用 / 任务 / 运行 / `permission_count` / `binding_scopes`。
  - **负责客户**：过滤显示该员工负责实例上的客户卡（阶段 / 意向 / 风险 / 消息 / 记忆计数）。
  - **知识库范围（共享）**：文档 `title_suffix` / hash、`chunk_count` / 状态。
  - **运行记录**：该员工最近运行时间线。

### 安全展示约束（PR2）

禁止渲染：聊天正文、回复正文、token、绑定串明文、知识库原始标题、员工原始姓名、原始职责。允许渲染：hash / suffix / count / status / keys / stage·risk·intent / 脱敏摘要。`bind_payload_text` 仅用于 `QRCode.toDataURL` 生成二维码，不以文本 / `<code>` 形式出现。知识导入 / 绑定在未接入真实数据源时按钮 disabled，接入后可用。

## 安全边界

- 不新增租户/子账号/实例授权模型，继续复用 WOC `useAuth()` / `useInstances()` / 后端可见实例过滤。
- 不显示聊天正文、客户真实名、token、secret、raw prompt/reply。
- “确认建议 / 发送 / 接管”中除接管复用已有控制权 API 外，真实发送类动作仍保持 disabled 或跳转人审流程。
- 一次性绑定串不再以明文文本渲染，仅编码进二维码；页面文字只展示 channel / payload hash / token hash。（`bind_payload_text` 仅作为后端下发字段名与前端二维码入参存在，不再是 UI 可见明文。）
