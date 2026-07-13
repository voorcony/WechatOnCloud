export interface PanelUser {
  id: string;
  username: string;
  role: 'admin' | 'sub';
  disabled: boolean;
  createdAt: string;
  allowedInstances: string[]; // admin 为空数组（隐式全部）
  mustChangePassword?: boolean; // 仍在用默认密码时为 true
}

export type WechatPhase = 'idle' | 'downloading' | 'extracting' | 'installing' | 'done' | 'error';
export interface WechatStatus {
  phase: WechatPhase;
  percent: number; // -1 表示进度不确定
  installed: boolean;
  version: string;
  message: string;
  updatedAt: number;
}

export type RuntimeState = 'running' | 'stopped' | 'missing';
export type AppType = 'wechat' | 'telegram' | 'chromium' | 'custom';
export const APP_LABELS: Record<AppType, string> = {
  wechat: '微信',
  telegram: 'Telegram',
  chromium: 'Chromium',
  custom: '自定义应用',
};

// 各应用的 UI 画像，供卡片/桌面页按类型显示正确文案（避免到处写死「微信」）。
//   needsInstall: 是否需要运行时下载安装（微信/Telegram 是；Chromium 已烤进镜像、即创建即就绪）。
//   enterHint:    首次进入实例的提示。
//   updateLabel:  「管理」菜单里的更新按钮文案（needsInstall=false 时不显示）。
export interface AppProfile {
  label: string;
  needsInstall: boolean;
  enterHint: string;
  updateLabel: string;
}
export const APP_PROFILES: Record<AppType, AppProfile> = {
  wechat: { label: '微信', needsInstall: true, enterHint: '首次进入请扫码登录微信', updateLabel: '更新微信' },
  telegram: { label: 'Telegram', needsInstall: true, enterHint: '首次进入请登录 Telegram', updateLabel: '更新 Telegram' },
  chromium: { label: 'Chromium', needsInstall: false, enterHint: '浏览器已就绪，直接使用即可', updateLabel: '' },
  custom: { label: '自定义应用', needsInstall: true, enterHint: '', updateLabel: '更新' },
};
export const appProfile = (t?: AppType): AppProfile => APP_PROFILES[t ?? 'wechat'] ?? APP_PROFILES.wechat;
export interface PanelInstance {
  id: string;
  name: string;
  appType?: AppType; // 缺省（老实例）= wechat
  icon?: string; // 自定义图标：data: 图片 / builtin:<key>；缺省按 appType 取默认图标
  createdAt: string;
  createdBy: string;
  memSoftLimitMB?: number;
  memHardLimitMB?: number;
  // 代理安全字段（后端脱敏下发，永不含密码）：
  proxyConfigured?: boolean; // 是否存有代理 URL
  proxyEnabled?: boolean; // 是否启用了有效代理（未启用则禁止进入 VNC）
  proxyDisplay?: string; // 脱敏展示，如 socks5://***@1.2.3.4:1080
}
// 代理配置弹窗 GET 返回（脱敏）：绝不含原始密码。
export interface ProxyConfig {
  enabled: boolean;
  configured: boolean;
  display: string; // 脱敏展示；无则空串
  noProxy: string;
  defaultNoProxy: string;
  running: boolean; // 实例是否运行中（用于提示"重启后生效"）
}
export interface MemLimits {
  soft: number | null;
  hard: number | null;
  defaultSoft: number;
  defaultHard: number;
  currentMB: number;
  watchdogEnabled: boolean;
  intervalSec: number;
}
export interface InstanceWithStatus extends PanelInstance {
  runtime: RuntimeState;
  wechat: WechatStatus;
  imageVersion?: string | null; // 实例镜像版本（CI 发布版如 "1.4.0"；自构建为镜像短 id；容器缺失为 null）
}

export interface VolEntry {
  name: string;
  type: 'dir' | 'file' | 'link' | 'other';
  size: number;
  mtime: number; // epoch ms
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  isDev: boolean;
  checkedAt: number;
  source: string | null;
  error: string | null;
  product?: string;
  channel?: string;
}

// ---------- AI 员工中心（PR3：接 ai-wechat-employee 的 management_api 只读代理） ----------
// 后端 /api/ai-employees/console 返回：已启用则 mode="real" 带 console 快照（已按当前账号可见
// 实例过滤、字段 allowlist）；未配置/子进程失败则 mode="demo_fallback"，前端回退到本地演示。
export type AiTaskCounts = Record<string, number>;
export type AiRunCounts = Record<string, number>;
export interface AiEmployeeCard {
  employee_id: number;
  name_hash: string;
  name_suffix: string;
  role: string;
  status: string;
  responsibility_hash: string;
  responsibility_len: number;
  approval_policy_keys: string[];
  approval_policy_count: number;
  memory_policy_keys: string[];
  memory_policy_count: number;
  instance_count: number;
  task_counts: AiTaskCounts;
  run_counts: AiRunCounts;
  latest_task_id: number | null;
  latest_run_id: number | null;
}
export interface AiInstanceCard {
  instance_id_hash: string;
  instance_id_suffix: string;
  woc_instance_id: string | null; // 命中的当前账号可见 WOC 实例 id（后端回填），可用于显示真实名/跳转
  bound_employee_ids: number[];
  active_binding_count: number;
  binding_scopes: Record<string, number>;
  permission_keys: string[];
  permission_count: number;
  task_counts: AiTaskCounts;
  run_counts: AiRunCounts;
  latest_run_id: number | null;
}
export interface AiTaskCard {
  task_id: number;
  status: string;
  task_type: string;
  employee_id: number;
  instance_id_hash: string | null;
  instance_id_suffix: string | null;
  woc_instance_id: string | null;
  input_redacted: string | null;
  created_at: string | null;
  updated_at: string | null;
}
export interface AiRunCard {
  run_id: number;
  run_type: string;
  status: string;
  employee_id: number;
  task_id: number | null;
  instance_id_hash: string | null;
  instance_id_suffix: string | null;
  woc_instance_id: string | null;
  redacted_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
}
export interface AiCustomerCard {
  instance_id_hash: string;
  instance_id_suffix: string;
  conversation_key_hash: string;
  display_name_hash: string;
  message_count: number;
  incoming_count: number;
  outgoing_count: number;
  latest_observed_at: string | null;
  active_memory_count: number;
  candidate_memory_count: number;
  profile_present: boolean;
  profile_stage: string | null;
  profile_risk_level: string | null;
  profile_intent_score: number | null;
}
export interface AiKnowledgeDocument {
  document_id: number;
  title_hash: string;
  title_suffix: string;
  source_path_hash: string;
  source_path_suffix: string;
  content_hash: string;
  chunk_count: number;
  updated_at: string | null;
  enabled: boolean | null;
  version: number | null;
  group_key: string | null;
}
export interface AiKnowledgeGroup {
  group_key: string;
  document_count: number;
  chunk_count: number;
}
export interface AiKnowledgeSummary {
  document_count: number;
  chunk_count: number;
  enabled_count: number | null;
  disabled_count: number | null;
  group_count: number | null;
  groups: AiKnowledgeGroup[];
  documents: AiKnowledgeDocument[];
}
export interface AiKnowledgeImportResponse {
  ok: true;
  document_count: number;
  chunk_count: number;
  document_ids: number[];
}

export interface AiBindPayloadResponse {
  ok: true;
  channel_id: number;
  channel_type: string;
  bind_payload_hash: string;
  bind_token_hash: string;
  bind_payload_text: string;
}
export interface AiBindChannel {
  channel_id: number;
  channel_type: string;
  bind_status: string;
  bound_at: string | null;
  has_bind_token: boolean;
  created_at: string | null;
  updated_at: string | null;
}
export type AiSafeSummary = Record<string, number | string | boolean | null | Record<string, number>>;
export interface AiConsolePayload {
  found: boolean;
  dashboard: Record<string, number | string | number[]> | null;
  employee_cards: AiEmployeeCard[];
  instance_cards: AiInstanceCard[];
  recent_tasks: AiTaskCard[];
  recent_runs: AiRunCard[];
  pending: Record<string, number> | null;
  customer_cards: AiCustomerCard[];
  knowledge_summary: AiKnowledgeSummary | null;
  bind_panel: {
    found: boolean;
    channel_count: number;
    counts: Record<string, number>;
    channels: AiBindChannel[];
  } | null;
  service_status_summary: AiSafeSummary | null;
  vision_status_summary: AiSafeSummary | null;
  approval_status_summary: AiSafeSummary | null;
  send_status_summary: AiSafeSummary | null;
  customer_status_summary: AiSafeSummary | null;
}
// ---------- AI 员工中心（PR5：可编辑人格 + 自动回复策略写路径） ----------
// 后端命令缺失 / 未部署时统一返回 { ok:false, mode:'unavailable' }，前端 inline 提示、不假成功。
export interface AiActionUnavailable {
  ok: false;
  mode: 'unavailable';
  reason: 'backend_command_missing' | 'not_configured' | 'invalid_request';
}
export interface AiApplyTemplateResult {
  ok: true;
  mode: 'applied';
  employee_id: number;
  template_key: string;
  persona_hash: string;
  policy_keys: string[];
  guardrail_keys: string[];
}
export interface AiSavePolicyResult {
  ok: true;
  mode: 'saved';
  employee_id: number;
  auto_reply_mode: string;
  scope: string;
  rate_limit_seconds: number;
  guardrail_keys: string[];
  persona_hash: string;
}
export interface AiAutoReplyTestResult {
  ok: true;
  mode: 'evaluated';
  employee_id: number;
  decision: string; // auto_send | needs_human | suggest_only
  risk_level: string; // low | medium | high
  matched_guardrails: string[];
  redacted_summary: string;
}

export interface AiApprovalReplyJobCard {
  reply_job_id: number;
  status: string;
  needs_human: boolean;
  should_send: boolean;
  instance_id_hash: string;
  instance_id_suffix: string;
  woc_instance_id: string | null;
  conversation_key_hash: string;
  incoming_message_id: number | null;
  reply_text_hash: string;
  reply_text_len: number;
  retrieved_chunk_count: number;
  memory_count: number;
  reason_hash: string | null;
  created_at: string | null;
  updated_at: string | null;
}
export interface AiApprovalSendActionCard {
  send_action_id: number;
  reply_job_id: number | null;
  mode: string;
  status: string;
  instance_id_hash: string;
  instance_id_suffix: string;
  woc_instance_id: string | null;
  conversation_key_hash: string;
  reply_text_hash: string;
  has_plan: boolean;
  created_at: string | null;
  updated_at: string | null;
}
export interface AiApprovalEmployeeTaskCard {
  task_id: number;
  employee_id: number | null;
  task_type: string;
  status: string;
  instance_id_hash: string | null;
  instance_id_suffix: string | null;
  woc_instance_id: string | null;
  input_hash: string | null;
  input_redacted: string | null;
  created_at: string | null;
  updated_at: string | null;
}
export interface AiApprovalQueuePayload {
  found: boolean;
  summary: Record<string, number>;
  reply_job_cards: AiApprovalReplyJobCard[];
  send_action_cards: AiApprovalSendActionCard[];
  employee_task_cards: AiApprovalEmployeeTaskCard[];
}
export type AiEmployeeApprovalQueueResponse =
  | {
      enabled: false;
      mode: 'demo_fallback';
      reason: 'not_configured' | 'unavailable';
      visibleInstanceIds: string[];
      queue: null;
    }
  | {
      enabled: true;
      mode: 'real';
      source: 'ai-wechat-employee';
      visibleInstanceCount: number;
      queue: AiApprovalQueuePayload;
    };

// 前端提交的人格 / 自动回复策略草稿（模板文本 + allowlist 键），绝不含聊天正文 / token。
export interface AiPersonaDraft {
  displayName: string;
  serviceDomain: string;
  post: string; // pre_sale | in_sale | after_sale
  tones: string[]; // professional | fast | human_like | not_pushy
  goals: string;
  forbidden: string;
}
export interface AiAutoReplyDraft {
  mode: string; // disabled | suggest_only | auto_send_test
  scope: string; // current_instance | bound_instances | whitelist
  rateLimitSeconds: number;
  rateLimitCount: number;
  guardrails: string[]; // refund | ban | payment | cheat | link | large_order | complaint
}


export interface AiServiceHealthPayload {
  status: string;
  service_state: string;
  pid_alive: boolean;
  healthy: boolean;
  last_iteration: number | null;
  last_poll_at: string | null;
  vision_status: string;
  recent_ocr: Record<string, number | string | boolean | null>;
  recent_reply: Record<string, number | string | boolean | null>;
  recent_send: Record<string, number | string | boolean | null>;
  last_error_present: boolean;
  last_error_hash: string | null;
  log_summary: Record<string, number | string | boolean | null>;
}
export type AiEmployeeServiceHealthResponse =
  | {
      enabled: false;
      mode: 'demo_fallback';
      reason: 'not_configured' | 'unavailable';
      health: null;
    }
  | {
      enabled: true;
      mode: 'real';
      source: 'ai-wechat-employee';
      health: AiServiceHealthPayload;
    };


export interface AiServiceRunsPayload {
  status: string;
  employee_id: number;
  run_type: string | null;
  run_count: number;
  runs: AiRunCard[];
}
export type AiEmployeeServiceRunsResponse =
  | {
      enabled: false;
      mode: 'demo_fallback';
      reason: 'not_configured' | 'unavailable';
      runs: null;
    }
  | {
      enabled: true;
      mode: 'real';
      source: 'ai-wechat-employee';
      runs: AiServiceRunsPayload;
    };


export interface AiServiceActionPlanResponse {
  ok: true;
  mode: 'dry_run_disabled';
  enabled: boolean;
  action: 'start' | 'stop' | 'restart';
  executable: false;
  planned_command: string[];
  safety_checks: string[];
  warnings: string[];
  next_required: string;
  audit_record: null | {
    recorded: boolean;
    run_id?: number;
    run_status?: string;
    error_hash?: string;
  };
}

export type AiEmployeeConsoleResponse =
  | {
      enabled: false;
      mode: 'demo_fallback';
      reason: 'not_configured' | 'unavailable' | 'cannot_enforce_instance_filter';
      visibleInstanceIds: string[];
      console: null;
    }
  | {
      enabled: true;
      mode: 'real';
      source: 'ai-wechat-employee';
      visibleInstanceCount: number;
      console: AiConsolePayload;
    };

// 原始二进制上传（File 直传 application/octet-stream），用于数据卷上传/解压/恢复
async function rawUpload(url: string, file: File): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `请求失败 (${res.status})`);
  return data;
}

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  // 仅在有 body 时声明 JSON content-type：否则 Fastify 对「空 body + application/json」会报 400
  const headers = opts.body ? { 'content-type': 'application/json', ...opts.headers } : opts.headers;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 会话过期：除登录/探测接口外，任意接口收到 401 都说明 cookie 失效，直接回登录页（避免页面卡在错误态）
    const isAuthProbe = path.includes('/api/auth/login') || path.includes('/api/auth/me');
    if (res.status === 401 && !isAuthProbe && location.pathname !== '/login') {
      location.assign('/login');
    }
    throw new Error((data as any).error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  me: () => req<{ user: PanelUser }>('/api/auth/me'),
  login: (username: string, password: string) =>
    req<{ user: PanelUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  changePassword: (oldPassword: string, newPassword: string) =>
    req('/api/account/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),

  // AI 员工中心：只读 console 快照（后端已按可见实例过滤 + allowlist；未配置则返回 demo_fallback）
  aiEmployeeConsole: () => req<AiEmployeeConsoleResponse>('/api/ai-employees/console'),
  aiEmployeeApprovalQueue: () => req<AiEmployeeApprovalQueueResponse>('/api/ai-employees/approval-queue'),
  aiEmployeeServiceHealth: () => req<AiEmployeeServiceHealthResponse>('/api/ai-employees/service-health'),
  aiEmployeeServiceRuns: () => req<AiEmployeeServiceRunsResponse>('/api/ai-employees/service-runs'),
  aiEmployeeServiceActionPlan: (action: 'start' | 'stop' | 'restart') =>
    req<AiServiceActionPlanResponse>('/api/ai-employees/service-action', { method: 'POST', body: JSON.stringify({ action }) }),
  createAiEmployeeBind: () => req<AiBindPayloadResponse>('/api/ai-employees/bind', { method: 'POST' }),
  importAiEmployeeKnowledge: (title: string, markdown: string) =>
    req<AiKnowledgeImportResponse>('/api/ai-employees/knowledge/import', {
      method: 'POST',
      body: JSON.stringify({ title, markdown }),
    }),

  // PR5：可编辑人格 + 自动回复策略。后端未部署时返回 { ok:false, mode:'unavailable' }（HTTP 200）。
  applyAiEmployeeTemplate: (employeeId: number, templateKey: string) =>
    req<AiApplyTemplateResult | AiActionUnavailable>(`/api/ai-employees/${employeeId}/apply-template`, {
      method: 'POST',
      body: JSON.stringify({ templateKey }),
    }),
  saveAiEmployeePolicy: (employeeId: number, persona: AiPersonaDraft, autoReply: AiAutoReplyDraft) =>
    req<AiSavePolicyResult | AiActionUnavailable>(`/api/ai-employees/${employeeId}/policy`, {
      method: 'POST',
      body: JSON.stringify({ persona, autoReply }),
    }),
  runAiEmployeeAutoReplyTest: (employeeId: number, sample: string) =>
    req<AiAutoReplyTestResult | AiActionUnavailable>(`/api/ai-employees/${employeeId}/auto-reply-test`, {
      method: 'POST',
      body: JSON.stringify({ sample }),
    }),

  // 版本与更新检测
  getVersion: () => req<VersionInfo>('/api/version'),
  checkUpdate: () => req<VersionInfo>('/api/admin/version/check', { method: 'POST' }),
  // 一键更新面板自身：拉新镜像 + 派生 helper 容器重建 woc-panel（带回滚）。返回后面板会重启。
  selfUpdatePanel: () => req<{ ok: boolean; target: string; message: string }>('/api/admin/version/self-update', { method: 'POST' }),

  // 实例桌面深色（与面板主题统一的那个开关）：读取当前态 + 设置（管理员，实时切换运行中实例）。
  getDesktopTheme: () => req<{ dark: boolean }>('/api/desktop-theme'),
  setDesktopTheme: (dark: boolean) =>
    req<{ ok: boolean; dark: boolean; applied: number; failed: number }>('/api/admin/desktop-theme', {
      method: 'POST',
      body: JSON.stringify({ dark }),
    }),

  // 子账号
  listUsers: () => req<{ users: PanelUser[] }>('/api/admin/users'),
  createUser: (username: string, password: string, allowedInstances: string[] = []) =>
    req<{ user: PanelUser }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, allowedInstances }),
    }),
  setDisabled: (id: string, disabled: boolean) =>
    req<{ user: PanelUser }>(`/api/admin/users/${id}/disable`, { method: 'POST', body: JSON.stringify({ disabled }) }),
  resetUser: (id: string, newPassword: string) =>
    req<{ user: PanelUser }>(`/api/admin/users/${id}/reset`, { method: 'POST', body: JSON.stringify({ newPassword }) }),
  renameUser: (id: string, username: string) =>
    req<{ user: PanelUser }>(`/api/admin/users/${id}/rename`, { method: 'POST', body: JSON.stringify({ username }) }),
  deleteUser: (id: string) => req(`/api/admin/users/${id}`, { method: 'DELETE' }),
  setUserInstances: (id: string, instanceIds: string[]) =>
    req<{ user: PanelUser }>(`/api/admin/users/${id}/instances`, { method: 'POST', body: JSON.stringify({ instanceIds }) }),

  // 微信实例
  listInstances: () => req<{ instances: InstanceWithStatus[] }>('/api/instances'),
  createInstance: (name: string, allowedUserIds: string[] = [], reuseVolume?: string, appType: AppType = 'wechat') =>
    req<{ instance: PanelInstance }>('/api/admin/instances', {
      method: 'POST',
      body: JSON.stringify({ name, allowedUserIds, reuseVolume: reuseVolume || undefined, appType }),
    }),
  regenMachineId: (id: string) =>
    req(`/api/admin/instances/${id}/regen-machine-id`, { method: 'POST' }),
  getInstanceMemLimits: (id: string) =>
    req<MemLimits>(`/api/admin/instances/${id}/mem-limits`),
  setInstanceMemLimits: (id: string, soft: number | null | undefined, hard: number | null | undefined) =>
    req<{ instance: PanelInstance }>(`/api/admin/instances/${id}/mem-limits`, {
      method: 'PUT',
      body: JSON.stringify({ soft, hard }),
    }),
  // 实例出站代理（管理员）：GET 只拿脱敏视图；PUT 保存（url 空或 enabled=false = 清除/关闭），重启后生效。
  getInstanceProxy: (id: string) => req<ProxyConfig>(`/api/admin/instances/${id}/proxy`),
  setInstanceProxy: (id: string, body: { enabled?: boolean; url?: string; noProxy?: string }) =>
    req<{ instance: PanelInstance; running: boolean; restartRequired: boolean; proxyEnabled: boolean }>(
      `/api/admin/instances/${id}/proxy`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  listOrphanVolumes: () =>
    req<{ volumes: { name: string; createdAt?: string; sizeBytes?: number }[] }>('/api/admin/orphan-volumes'),
  deleteOrphanVolume: (name: string) =>
    req(`/api/admin/orphan-volumes/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  listOrphanContainers: () =>
    req<{ containers: { id: string; name: string; status: string; volumeName?: string }[] }>('/api/admin/orphan-containers'),
  deleteOrphanContainer: (idOrName: string) =>
    req(`/api/admin/orphan-containers/${encodeURIComponent(idOrName)}`, { method: 'DELETE' }),
  setInstanceIcon: (id: string, icon: string | null) =>
    req<{ instance: PanelInstance }>(`/api/admin/instances/${id}/icon`, { method: 'POST', body: JSON.stringify({ icon }) }),
  renameInstance: (id: string, name: string) =>
    req<{ instance: PanelInstance }>(`/api/admin/instances/${id}/rename`, { method: 'POST', body: JSON.stringify({ name }) }),
  deleteInstance: (id: string, purge = false) =>
    req(`/api/admin/instances/${id}${purge ? '?purge=1' : ''}`, { method: 'DELETE' }),
  setInstanceUsers: (id: string, userIds: string[]) =>
    req(`/api/admin/instances/${id}/users`, { method: 'POST', body: JSON.stringify({ userIds }) }),
  instanceWechatStatus: (id: string) => req<{ status: WechatStatus }>(`/api/instances/${id}/wechat/status`),
  // 卡死自愈：VNC 多次重连仍连不上时，重启该实例恢复（限频；需对实例有访问权）。
  healInstance: (id: string) => req<{ ok: boolean; restarted: boolean }>(`/api/instances/${id}/heal`, { method: 'POST' }),
  // 客户端连接日志：把前端的 VNC 连接态/动作回传服务端，记进实例日志（[client] 前缀），便于排查。Fire-and-forget。
  clientLog: (id: string, msg: string) => {
    req(`/api/instances/${id}/clientlog`, { method: 'POST', body: JSON.stringify({ msg }) }).catch(() => {});
  },
  instanceWechatInstall: (id: string) => req(`/api/admin/instances/${id}/wechat/install`, { method: 'POST' }),
  instanceWechatUpdate: (id: string) => req(`/api/admin/instances/${id}/wechat/update`, { method: 'POST' }),
  instanceStart: (id: string) => req(`/api/admin/instances/${id}/start`, { method: 'POST' }),
  instanceStop: (id: string) => req(`/api/admin/instances/${id}/stop`, { method: 'POST' }),
  instanceRestart: (id: string) => req(`/api/admin/instances/${id}/restart`, { method: 'POST' }),
  // 单实例升级：异步（后端登记后立即返回），轮询 upgradeStatus().upgradingIds 直到该 id 移出。
  instanceUpgrade: (id: string) => req<{ ok: boolean; started: boolean }>(`/api/admin/instances/${id}/upgrade`, { method: 'POST' }),
  // 实例镜像升级状态（哪些实例落后于本地最新镜像、远端是否有新版、单个/批量升级进度）。
  upgradeStatus: () =>
    req<{
      known: boolean;
      outdatedCount: number;
      outdatedIds: string[];
      instances: { id: string; name: string; outdated: boolean }[];
      remoteNewer: boolean | null;
      upgradeAll: { running: boolean; total: number; done: number; failed: number; phase: string };
      upgradingIds: string[];
    }>('/api/admin/instances/upgrade-status'),
  // 一键升级全部（异步，立即返回；先拉镜像再判定落后，进度看 upgradeStatus().upgradeAll）。
  upgradeAllInstances: () =>
    req<{ ok: boolean; started: boolean }>('/api/admin/instances/upgrade-all', { method: 'POST' }),
  instanceLogsUrl: (id: string) => `/api/admin/instances/${id}/logs`,
  // 全局日志 / 诊断包（范围 24h/7d/30d/1y）
  diagnosticsUrl: (range: string) => `/api/admin/diagnostics?range=${encodeURIComponent(range)}`,
  panelLogUrl: (range: string) => `/api/admin/panel-log?range=${encodeURIComponent(range)}`,

  // 文件中转
  listFiles: (id: string) => req<{ files: { name: string; size: number }[] }>(`/api/instances/${id}/files`),
  uploadFile: async (id: string, file: File) => {
    const res = await fetch(`/api/instances/${id}/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || '上传失败');
    return res.json();
  },
  downloadFileUrl: (id: string, name: string) => `/api/instances/${id}/download?name=${encodeURIComponent(name)}`,
  deleteFile: (id: string, name: string) => req(`/api/instances/${id}/files?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // 数据卷管理（仅管理员）
  volumeList: (id: string, path = '') =>
    req<{ path: string; entries: VolEntry[] }>(`/api/admin/instances/${id}/volume?path=${encodeURIComponent(path)}`),
  volumeMkdir: (id: string, path: string) =>
    req(`/api/admin/instances/${id}/volume/mkdir`, { method: 'POST', body: JSON.stringify({ path }) }),
  volumeMove: (id: string, from: string, to: string) =>
    req(`/api/admin/instances/${id}/volume/move`, { method: 'POST', body: JSON.stringify({ from, to }) }),
  volumeDelete: (id: string, path: string) =>
    req(`/api/admin/instances/${id}/volume?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  volumeDownloadUrl: (id: string, path: string) =>
    `/api/admin/instances/${id}/volume/download?path=${encodeURIComponent(path)}`,
  volumeBackupUrl: (id: string) => `/api/admin/instances/${id}/volume/backup`,
  volumeUpload: (id: string, path: string, file: File) =>
    rawUpload(`/api/admin/instances/${id}/volume/upload?path=${encodeURIComponent(path)}&name=${encodeURIComponent(file.name)}`, file),
  volumeExtract: (id: string, path: string, file: File) =>
    rawUpload(`/api/admin/instances/${id}/volume/extract?path=${encodeURIComponent(path)}`, file),
  volumeRestore: (id: string, file: File) =>
    rawUpload(`/api/admin/instances/${id}/volume/restore`, file),

  // 多端协作：操作控制权
  controlStatus: (id: string) => req<{ free: boolean; mine: boolean; holder: string | null }>(`/api/instances/${id}/control`),
  controlBeat: (id: string) => req<{ mine: boolean; holder: string }>(`/api/instances/${id}/control/beat`, { method: 'POST' }),
  controlTake: (id: string) => req<{ mine: boolean; holder: string }>(`/api/instances/${id}/control/take`, { method: 'POST' }),
  typeInInstance: (id: string, text: string) => req(`/api/instances/${id}/type`, { method: 'POST', body: JSON.stringify({ text }) }),
  keyInInstance: (id: string, key: string) => req(`/api/instances/${id}/key`, { method: 'POST', body: JSON.stringify({ key }) }),

  // 桌面壁纸
  listBackgrounds: (id: string) => req<{ backgrounds: string[] }>(`/api/admin/instances/${id}/backgrounds`),
  uploadBackground: async (id: string, name: string, file: File) => {
    const res = await fetch(`/api/admin/instances/${id}/backgrounds?name=${encodeURIComponent(name)}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' }, body: file,
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || '上传失败');
    return res.json();
  },
  applyBackground: (id: string, name: string) =>
    req(`/api/admin/instances/${id}/backgrounds/${encodeURIComponent(name)}/apply`, { method: 'POST' }),
  deleteBackground: (id: string, name: string) =>
    req(`/api/admin/instances/${id}/backgrounds/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getCurrentBackground: (id: string) => req<{ background: string }>(`/api/admin/instances/${id}/backgrounds/current`),
  clearBackground: (id: string) => req(`/api/admin/instances/${id}/backgrounds/clear`, { method: 'POST' }),

  // 字体管理
  listFonts: (id: string) => req<{ fonts: string[] }>(`/api/admin/instances/${id}/fonts`),
  uploadFont: async (id: string, name: string, file: File) => {
    const res = await fetch(`/api/admin/instances/${id}/fonts?name=${encodeURIComponent(name)}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' }, body: file,
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || '上传失败');
    return res.json();
  },
  deleteFont: (id: string, name: string) =>
    req(`/api/admin/instances/${id}/fonts/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getCurrentFont: (id: string) => req<{ fontFile: string }>(`/api/admin/instances/${id}/fonts/current`),
  applyFont: (id: string, name: string) =>
    req(`/api/admin/instances/${id}/fonts/${encodeURIComponent(name)}/apply`, { method: 'POST' }),
  resetFontDefault: (id: string) =>
    req(`/api/admin/instances/${id}/fonts/default`, { method: 'POST' }),
};
