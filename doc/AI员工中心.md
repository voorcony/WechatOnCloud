# AI 员工中心（云微面板）

云微原生后台内的「AI 私域员工总控台」。定位在云微信实例之上、独立于单个实例页面：

```
大秘书 → AI 员工 → 云微信实例 → 任务 → 时间线 → 待确认
```

- 面板路径：`/ai-employees`
- 生产入口：`https://aipowerlogin.com/wechat/woc`
- 侧栏位置：主页 → **AI 员工** → 实例列表… → 管理/设置

## 为什么做在 WechatOnCloud 面板

AI 员工的操作对象是**云微信实例**，而实例的登录态、角色、子账号、访问授权都由 WechatOnCloud 面板提供。把总控台做进云微面板，才能直接复用这套已有账户/权限体系，不必重造。

明确区分：`ai-automation-saas` 的 `/dashboard` 是 **AI SaaS 后台**，不是云微后台。二者不同栈、不同账户体系；早先误建的 PR #473 已关闭。本能力只属于 `WechatOnCloud`（前端在 `panel/web`），不涉及 `ai-automation-saas`。

## 如何复用当前账号 / 子账号 / RBAC / 实例授权

页面**不新增**任何租户 / 子账户 / 实例授权模型，全部复用云微既有：

| 复用项 | 来源 |
| --- | --- |
| 面板登录态 | `RequireAuth`（`App.tsx`）包住 `AppShell`，未登录进不来 |
| 用户角色 | `useAuth().user.role`：`admin` / `sub` |
| 子账号体系 | 管理页 `api.listUsers()` / `setUserInstances()`（本页不调用，只读身份） |
| 实例访问授权 | `useInstances()` → `api.listInstances()`，后端已按当前账号授权过滤 |
| 可见实例 | `InstanceWithStatus[]`，携带 `runtime` / `wechat` 状态 |

**权限语义（页面明确写出）：**

> AI 员工可操作范围 = 当前账号在云微已有授权下可见的实例。
> 管理员隐式拥有全部实例（`allowedInstances` 为空数组）；子账号只看到被授权实例。

因此 AI 员工的绑定范围天然等于 `useInstances()` 返回的列表：管理员看到全部，子账号看到被授权子集，无需任何额外过滤。

## PR2 范围：纯 UI MVP

只在 `panel/web` 内新增前端展示，**不碰后端、不产生任何真实副作用**：

- 新增 `panel/web/src/pages/AiEmployeeCenter.tsx`
- `panel/web/src/AppShell.tsx`：加路由 `/ai-employees` + 侧栏「AI 员工」入口
- `panel/web/src/styles.css`：追加 `.ai-*` 样式（复用现有设计令牌，不改动既有类）
- 本文档

**严格约束：**

- 不调用新的后端 API；实例数据只读 `listInstances()`（用户本就可见）。
- 不生成真实 token —— 绑定入口「生成绑定码」按钮 disabled。
- 不触发任何发送/审批/绑定真实动作 —— 待确认「通过并发送 / 编辑后通过 / 驳回」按钮均 disabled。
- 不放真实聊天/客户/账号数据。员工岗位（售前/售后/复购/群运营）、任务、时间线、待确认草稿、客户编号（`客户 #A17`、`会话 hash·xxxx`）均为**演示占位**，按实例 id 稳定派生，仅用于展示形态。
- 真实字段仅限用户已可见的实例：`id` / `name` / `appType` / 运行状态。

页面分区（本地 `useState` segment，不引第三方 UI 库）：总控台 / AI 员工 / 微信实例 / 任务 / 时间线 / 待确认 / 绑定入口。顶部 KPI：可见实例数（真实）、AI 员工数、今日消息、待确认、异常。`instances.length === 0` 时显示空状态，管理员引导去管理页新建实例，子账号提示「暂无被授权实例」。

## PR3 范围：只读代理接真实 management 数据

PR2 是 UI 壳（演示占位）。PR3 把页面接入 `ai-wechat-employee` 已做好的 management_api 真实数据（大秘书 / AI 员工 / 实例绑定 / 任务 / 运行时间线 / 待确认 / 绑定面板），**仍然只读、仍不触发任何真实微信动作**。

### 新增只读端点

```
GET /api/ai-employees/console
```

- 后端模块 `panel/server/src/ai-employee.ts`（`buildConsoleResponse`），路由在 `panel/server/src/index.ts`。
- 需登录（`requireAuth`，未登录 401）。
- 通过 `child_process.execFile`（**无 shell**、带 8s 超时）调用 ai-wechat 的 CLI：

  ```bash
  python3 <CLI> console --db <DB> --tenant <TENANT> --secretary-id <ID>
  ```

  拿到 `management_api_v1` 复合 payload（`dashboard` / `employee_cards` / `instance_cards` /
  `recent_tasks` / `recent_runs` / `pending` / `bind_panel`）。

### env 配置（默认关闭）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WOC_AI_EMPLOYEE_ENABLED` | `0` | `1/true/yes/on` 才启用；否则一律 demo_fallback |
| `WOC_AI_EMPLOYEE_DB` | 空 | ai-wechat-employee 的 SQLite DB 路径 |
| `WOC_AI_EMPLOYEE_TENANT` | `default` | 租户 id |
| `WOC_AI_EMPLOYEE_SECRETARY_ID` | `1` | 大秘书 id |
| `WOC_AI_EMPLOYEE_CLI` | `…/ai-wechat-employee/scripts/woc_management_api.py` | CLI 路径 |
| `WOC_AI_EMPLOYEE_PYTHON` | `python3` | 解释器 |

### 权限过滤策略

ai-wechat payload 只出实例 **hash/suffix**（`instance_id_hash`），不出 raw 实例 handle。后端据此按当前账号可见实例过滤：

1. 对 `userInstances(u)` 里每个实例 id，用与 ai-wechat `events.compute_text_hash` **完全一致**的算法算 hash：`sha256(归一化空白后的文本)` 取十六进制前 16 位。得到 `hashToId` 映射。
2. `instance_cards` 只保留 `instance_id_hash` 命中可见集合的卡；命中时回填 `woc_instance_id`，前端据此显示真实实例名并跳转。
3. `recent_tasks` / `recent_runs` 同理按 `instance_id_hash` 过滤（`null`（无实例关联）保留，不泄露任何隐藏实例）。
4. `employee_cards` 只保留「绑定到可见实例」或「未绑定任何实例（`instance_count===0`）」的员工，避免泄露只绑定在不可见实例上的员工。
5. 防御分支：若 payload 的 `instance_cards` 缺 `instance_id_hash` 字段而无法证明归属，则对**子账号**回退 `demo_fallback`（`reason: "cannot_enforce_instance_filter"`），**管理员**放行看全量。
6. 所有出参字段走 **allowlist**（显式 pick），绝不把 payload 的未知对象整块透传；`bind_panel` 只出 `channel_type` / `bind_status` / `has_bind_token`（布尔）等，**不出** bind token / external id / external hash。

### fail-safe 行为（永不 500）

- 未启用 / 缺 DB / 缺 CLI → `{ enabled:false, mode:"demo_fallback", reason:"not_configured", visibleInstanceIds, console:null }`
- 子进程失败 / 超时 / 坏 JSON / schema 不符 → `mode:"demo_fallback", reason:"unavailable"`（stderr 原文**不**回前端，面板日志只记短 code）
- 成功 → `{ enabled:true, mode:"real", source:"ai-wechat-employee", visibleInstanceCount, console:<过滤后 payload> }`

### 前端行为

`AiEmployeeCenter.tsx` 加载时调 `api.aiEmployeeConsole()`：

- `mode==="real"` 且 `console.found` → 各 tab 用真实数据（KPI 取 `dashboard`/`pending`；员工/实例/任务/时间线/待确认/绑定分别取对应块）。实例卡命中真实实例时显示实例名+图标并可跳转，否则显示 `实例 ···<suffix>`。
- 否则 → 沿用 PR2 演示 UI，并在顶部明确提示「当前未配置 AI 员工数据源，正在展示本地演示数据」。
- 待确认/绑定的真实动作按钮仍 disabled——本页只读，**不触发真实微信发送/审批/绑定**。

## 下一步

- 绑定入口接真实绑定协议，签发受权限约束的 token（仍限于当前账号可见实例）。
- 待确认接人审 API，人工确认后才对目标微信实例执行真实发送动作。
- 生产环境把 WOC 实例 id 作为 ai-wechat 侧的实例 handle 落库，使可见实例 hash 与 `instance_id_hash` 天然对齐。

## 2026-07-13：按新 AI Console 设计稿对齐 10 模块

用户提供了新的 `index.html` / `app.js` / `styles.css` 原型，要求以该设计稿为主，而不是只在现有 WOC 页面上小修小补。本轮把设计稿的 10 个产品入口落到 React 路由，同时继续复用 WOC 登录态、RBAC、实例授权与 ai-wechat safe management payload。

| 设计稿模块 | WOC 路由 | 接入状态 |
| --- | --- | --- |
| 总览 | `/` | 真实 safe API + demo fallback |
| 对话 | `/inbox` | 三栏结构；仅展示 hash/count/status/stage/risk 等安全概览，正文进入实例桌面接管 |
| 客户 | `/customers` | 真实 safe API |
| AI 员工 | `/ai-employees` | 真实 safe API + 既有写路径占位 |
| 知识库 | `/knowledge` | `knowledge_summary` + 导入入口；命中回放待后端 |
| 工具与工作流 | `/tools` | `aiCapabilities.ts` 模块化 capability registry，按权限键/状态派生启用态 |
| 待确认 | `/approvals` | 真实 safe API；人审写路径待后端 |
| 监控 | `/monitor` | 真实 safe API / demo fallback |
| 团队 | `/team` | 复用 WOC 用户/RBAC，只读展示，增删改回 `/admin` |
| 系统设置 | `/settings` | 数据源/安全策略只读；模型路由/预算/Webhook/审计导出为 disabled 占位 |

新增页面：`Inbox.tsx`、`Knowledge.tsx`、`Tools.tsx`、`Team.tsx`、`Settings.tsx`；新增能力注册表：`aiCapabilities.ts`。这些页面只消费 `useAiConsoleModel()` 输出的安全 VM 与 `useInstances()` / `useAuth()`，不直接读 SQLite、不展示 raw chat / reply 原文 / token / 知识库原文 / 绑定串明文。没有后端写路径的操作保留产品位并明确 disabled / 待接入，避免假成功。
