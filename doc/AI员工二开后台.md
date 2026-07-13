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

## 信息架构（PR3：客户画像 CRM / 待确认中心独立化）

PR3 把「客户画像」和「待确认」从 AI 员工中心内部 tab，升级成两个独立产品路由，更贴近真实 SCRM（企微 / Intercom）与审批队列（Gorgias macros approval / Linear inbox / 风控队列）的使用心智。React 内部新增路由（生产反代路径仍为 `/wechat/woc`）：

```text
客户    /customers   —— 客户画像 CRM（列表 + 筛选 + 画像 + AI 建议）
待确认  /approvals   —— 待确认中心（动作队列 + 风险 + 审计）
```

- 侧栏「客户 / 待确认」不再 `?tab=` 跳 AI 员工中心，而是进入独立页面；总控台「高意向客户 / 风险客户」跳 `/customers`，「待确认动作」跳 `/approvals`。
- AI 员工中心保留客户 / 待确认 tab，并新增交叉入口条「打开客户 CRM ›」「打开待确认中心 ›」。

### 共享只读模型 `aiConsoleModel.ts`

两页共用 `useAiConsoleModel()`：真实模式读取 `/api/ai-employees/console`（`mode="real"`，allowlist + 按可见实例过滤），失败回退 deterministic 演示（`seedOf` 派生，不跳动）。归一化产出 `CrmCustomer[]`（客户画像）、`pendingCounts` / `ApprovalAction[]`（待确认队列），并把客户 / 动作按 `bound_employee_ids`、实例 hash 关联到负责员工与可见实例（命中可跳转接管）。AI 跟进建议与风险理由由 `stage / risk / intent / 活跃度` 派生成安全产品文案，绝不引用聊天正文。

### `/customers` 客户画像 CRM

- **Hero + KPI**：客户数 / 高意向 / 高风险 / 今日观察 / 记忆数。
- **左·列表 + 筛选**：全部 / 高意向 / 高风险 / 售后 / 沉默；客户项显示 code（hash 前缀）、阶段、所属微信、最近观察、意向分、风险点。
- **中·画像**：客户 hash、阶段、意向分、风险、消息数（收 / 发）、活跃 / 候选记忆、所属微信 suffix + WOC 可见实例名、最近观察，以及 AI 跟进建议块。
- **右·画像栏**：负责 AI 员工、所属微信（命中可见实例可「接管实例」跳 `/i/:id`，否则 disabled）、最近观察、风险提示。

### `/approvals` 待确认中心

- **Hero + KPI**：总待确认 / 回复待人工 / 计划发送 / 改备注 / 群操作。
- **动作类型**（基于 pending counts + `recent_tasks` 派生）：`reply_jobs_needs_human` / `employee_tasks_waiting_approval` / `send_actions_planned` / `contact_remark_actions_planned` / `group_operation_actions_planned`。
- **左·队列（局部深色工作队列面板）**：按类型分流筛选，行显示风险点、动作类型、所属微信、关联员工、发起时间、状态。真实模式用 `recent_tasks` 的脱敏摘要富化对应条目；无真实 action 列表时按计数展开为 deterministic 安全占位队列。
- **右·详情**：脱敏摘要、动作类型 / 风险等级 / 关联员工 / 所属微信 / 时间 / 状态、风险理由、审计提示。批准 / 修改 / 拒绝为 disabled 占位（**真实审批写操作 API 后续接入**），「接管实例」命中可见实例时跳 `/i/:id`。

> 页面明确声明：当前仅展示聚合待确认动作的安全视图，队列正文均脱敏，不触发任何真实微信动作。

### 安全展示约束（PR3）

沿用 PR2 约束：只渲染 hash / suffix / count / status / keys / stage·risk·intent / 脱敏摘要；禁止聊天正文、回复正文、token、绑定串明文、知识库原始标题、员工原始姓名、原始职责。AI 建议 / 风险理由 / 占位队列文案均为派生产品文案，不含任何原文。

## 信息架构（PR4：监控墙 / 单实例工作台深度升级）

PR4 把 `/monitor` 与 `/i/:id` 从「VNC 工具页 + 右侧装饰卡」升级成 **多实例 AI 监控墙 + 单实例接管工作台**：参考 AdsPower 多环境矩阵 / 云手机墙 / Linear 状态墙（监控墙），以及 Intercom 接管台（单实例）。两页复用共享只读模型的新增单实例派生视图，数据只读、脱敏。

### 共享模型扩展 `aiConsoleModel.ts`

在 PR3 的 `useAiConsoleModel()` 基础上，`buildReal` / `buildDemo` 额外产出 `instanceEmployees`（按可见实例 id → 绑定 AI 员工：岗位 / 状态 / `permission_keys`），并导出一组按实例 id 过滤 / 派生的安全 helper：

```text
getInstanceEmployee(m, instId)     绑定 AI 员工（岗位 / 状态 / 权限键）
getInstanceCustomers(m, instId)    该实例客户画像（按意向降序）
getInstanceApprovals(m, instId)    该实例待确认动作
getInstanceRiskSummary(m, inst)    客户 / 高风险 / 高意向 / 待确认 / 未读计数 + 代理·安装·运行 badges + 是否需接管
getInstanceAiContext(m, inst)      聚合：员工 + 头号客户 + 风险 + AI 判断文案 + 运行时间线
getInstanceTimeline(m, inst)       OCR → 画像 → 起草回复 → 待确认 → 接管（deterministic 安全 fallback）
```

`AI 判断` / 时间线文案由实例状态 / 阶段 / 风险 / 意向派生，绝不引用聊天正文；未读为 deterministic 安全占位，实例不可用时恒 0；`permission_keys` 经 `permKeyLabel` 渲染成中文 chips（allowlist 键，非原始职责）。

### `/monitor` 多实例监控墙

- 顶部 KPI：总实例 / 在线 / 待确认 / 高风险客户 / 需接管 / AI 在岗。
- 筛选增强：全部 / 在线 / 异常 / 未读 / 待确认 / 高风险 / 有AI员工（每项带实时计数，支持 `/monitor?filter=abnormal` 深链直达）。
- 布局：自动 / 2×2 / 3×3 / 4×4（保留）。
- 每格 tile：实例名 + 应用类型 + 在线状态 + 绑定 AI 员工（状态点 / 岗位）；VNC 画面上叠加未读 / 待确认 / 高风险计数 chip；当前头号客户摘要（code / 阶段 / 意向 / 风险 / 客户数）；代理 / 安装 / 运行 badges；操作 新窗口 / 进入实例 / 接管（需接管时接管按钮高亮）。
- 数据来源标识：真实（ai-wechat-employee）/ 演示占位（实例状态恒真）。

### `/i/:id` 单实例工作台（AI Context Rail）

保留全部原有能力（VNC 主画面、文件上传下载、剪贴板 / IME 输入、壁纸 / 字体 / 声音、控制权、start/stop/restart/admin）。右侧工作台从装饰卡升级成 **AI Context Rail**：

- **当前 AI 员工**：岗位 / 在岗状态 / 权限中文 chips。
- **当前客户上下文**：头号客户 code / 阶段 / 意向 / 风险 / 活跃·候选记忆 / 本实例客户数。
- **待确认动作**：该实例待确认计数 + 跳 `/approvals`。
- **AI 判断**：按实例状态 / 阶段 / 风险 / 意向派生的安全文案（不含聊天正文）。
- **接管状态**：人工接管中 / 他人操作中 / AI 值守中（读已有控制权轮询）；「人工接管 / 续约控制权」复用已有 `controlTake`，「恢复 AI」无真实写 API 故 disabled。
- **运行时间线**：OCR → 画像 → 起草回复 → 待确认 → 接管。
- **快捷链接**：客户 CRM / 待确认中心 / 监控墙。

### 总控台跳转

总控台「微信实例健康概览」头部新增「监控墙 ›」入口，有异常时跳 `/monitor?filter=abnormal`，否则跳 `/monitor`。

### 安全展示约束（PR4）

沿用 PR2/PR3 约束：只渲染 hash / suffix / count / status / keys / stage·risk·intent / 脱敏摘要与派生文案；禁止聊天正文、回复正文、token、绑定串明文、知识库原始标题、员工原始姓名、原始职责。接管复用已有控制权 API；无真实写 API 的动作（恢复 AI / 批准等）保持 disabled 或仅跳转，不假执行。

## 信息架构（PR5：人格可编辑 + 游戏代练客服自动回复测试模式）

PR5 把 `/ai-employees` 员工详情 pane 从「只读身份卡」升级成可编辑的 **AI 员工人格 + 自动回复策略** 配置台：可配置游戏代练客服人格、允许在受控范围内测试自动回复而无需逐条人审。设计参考 Intercom teammate settings（人格 / 授权分层）、Gorgias automation rule（规则 + guardrail）、Linear settings（高密度表单 + 分段）。前端与后端分支 `ai-wechat-employee feat/game-boost-auto-reply` 兼容式对接：后端命令未部署时优雅 fallback，不影响现有页面、不假装成功。

### 员工详情新增两区（在 `EmployeeDetail` 内，权限策略之后）

- **人格配置区**：显示名 / 客服名、业务域（如游戏代练客服）、岗位（售前 / 售中 / 售后）、语气（专业 / 快速 / 像真人 / 不油腻，多选）、目标（引导收集游戏 / 区服 / 段位 / 预算 / 时限）、禁止承诺 / 红线（100% 不封号、违规外挂、诱导敏感密码等）。后端安全 payload 仍只给人格指纹（name hash/suffix + 职责长度/hash），故 UI 明示「当前后端未开放明文编辑快照」，但表单可基于模板填充并提交到新 API。
- **自动回复策略区**：授权分三档 `disabled` / `suggest_only` / `auto_send_test`（开关 + 模式 radio 组合）；生效范围（仅当前实例 / 已绑定实例 / 白名单会话，白名单为 UI 占位）；频率限制（每客户每 N 秒最多 M 条）；强制人审触发（退款 / 封号 / 付款 / 外挂 / 链接 / 大额订单 / 投诉，命中即转人工确认）。

### 一键「游戏代练客服模板」

`应用游戏代练客服模板` 先本地填充人格（代练客服小助手 / 游戏代练客服 / 售前 / 四种语气 / 收集需求目标 / 代练红线）与安全默认策略（`suggest_only`、仅当前实例、60s/1 条限频、全部 guardrail 开启——**安全优先，默认不自动外发**），再尝试下发到后端；后端未就绪时仍保留本地草稿并明确提示。

### 自动回复安全文案（强风险提示）

选中 `auto_send_test` 时强制展示红色风险条：仅测试实例 / 白名单会话 / 低风险咨询自动发送；付款 / 退款 / 封号 / 外挂 / 链接 / 大额订单 / 投诉命中人审触发词转人工；所有动作写 audit；真实发送由后端二次 gating，前端不直接触发微信动作；后端未就绪时不假装开启成功。

### API / proxy

前端 `api.ts` 新增 `applyAiEmployeeTemplate` / `saveAiEmployeePolicy` / `runAiEmployeeAutoReplyTest`；后端 `ai-employee.ts` + `index.ts` 新增只读+写代理 endpoint（管理员限定）：

```text
POST /api/ai-employees/:employeeId/apply-template
POST /api/ai-employees/:employeeId/policy
POST /api/ai-employees/:employeeId/auto-reply-test
```

代理通过 `execFile`（无 shell、带超时）调 ai-wechat CLI 子命令 `apply-template` / `set-policy` / `auto-reply-test`。入参只接受人格模板文本 + policy/guardrail allowlist 键并做长度收敛；出参只回 hash / suffix / keys / status / decision / risk 等安全字段。CLI 未部署 / 命令不存在 / 子进程失败一律返回结构化 fallback（HTTP 200）：

```json
{ "ok": false, "mode": "unavailable", "reason": "backend_command_missing" }
```

前端据此 inline 提示（保存失败 / 后端待部署），绝不 500、绝不假成功。演示模式（无真实 employee_id）下写按钮 disabled 并提示接入后可用。

### 安全展示约束（PR5）

沿用 PR2~PR4 约束：只渲染 hash / suffix / count / status / keys / decision / risk / 脱敏摘要；禁止聊天正文、回复正文、token、绑定串明文、原始职责。新增可编辑对象仅限「用户正在编辑的人格模板文本 + policy / guardrail allowlist 键」；试运行示例文本为用户自填测试输入，不取任何客户聊天正文；后端下发的策略快照只回 hash / keys / status，不回明文。

## 安全边界

- 不新增租户/子账号/实例授权模型，继续复用 WOC `useAuth()` / `useInstances()` / 后端可见实例过滤。
- 不显示聊天正文、客户真实名、token、secret、raw prompt/reply。
- “确认建议 / 发送 / 接管”中除接管复用已有控制权 API 外，真实发送类动作仍保持 disabled 或跳转人审流程。
- 一次性绑定串不再以明文文本渲染，仅编码进二维码；页面文字只展示 channel / payload hash / token hash。（`bind_payload_text` 仅作为后端下发字段名与前端二维码入参存在，不再是 UI 可见明文。）
