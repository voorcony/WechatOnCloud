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

## 本 PR 范围：纯 UI MVP

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

## 下一步

- 接 `ai-wechat-employee` 的管理数据与 `employee_runs`，把演示占位换成真实员工/任务/运行记录。
- 绑定入口接真实绑定协议，签发受权限约束的 token（仍限于当前账号可见实例）。
- 待确认接人审 API，人工确认后才对目标微信实例执行真实发送动作。
