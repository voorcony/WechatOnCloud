// AI 员工中心 · 只读代理（PR3）
//
// 把 WOC 面板接入 ai-wechat-employee 已做好的 management_api 数据（大秘书 → AI 员工
// → 实例 → 任务 → 运行时间线 → 待确认 → 绑定面板）。本模块只做「只读代理 + 权限过滤」：
//   - 通过子进程调用 ai-wechat 的 CLI（scripts/woc_management_api.py console），拿到
//     management_api_v1 payload；不直接读它的 SQLite，也不新建任何写路径。
//   - 严格 fail-safe：未启用 / 缺 DB/CLI / 子进程失败或超时 → 一律回退到 demo_fallback，
//     绝不 500，也绝不把子进程 stderr 原文透给前端（只记短 error code）。
//   - 严格权限过滤：只回当前 WOC 账号可见实例范围内的数据。ai-wechat 只出实例 hash/suffix，
//     所以这里对 WOC 可见实例用「同一套 sha256 前缀」算法算出 hash 集合，再据此过滤
//     instance_cards / recent_tasks / recent_runs；employee_cards 收敛到「未绑定或绑定到
//     可见实例」的员工。
//   - 所有出参字段走 allowlist：绝不把 payload 里的未知对象整块透传。ai-wechat 层已保证
//     不含租户原文 / 聊天正文 / reply_text / bind token / external id / conversation_key，
//     本层再叠一层 allowlist 兜底。
//
// 安全约束见 doc/AI员工中心.md。

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { User } from './store.js';

const SCHEMA_VERSION = 'management_api_v1';
const CLI_TIMEOUT_MS = 8000;
const CLI_MAX_BUFFER = 8 * 1024 * 1024; // 8MB，足够 console 快照

// ---------- 配置（全部走 env，默认关闭） ----------
export interface AiEmployeeConfig {
  enabled: boolean;
  db: string;
  tenant: string;
  secretaryId: number;
  cli: string;
  python: string;
  kbDir: string;
}

function envFlag(v: string | undefined): boolean {
  if (!v) return false;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

export function aiEmployeeConfig(): AiEmployeeConfig {
  return {
    enabled: envFlag(process.env.WOC_AI_EMPLOYEE_ENABLED),
    db: process.env.WOC_AI_EMPLOYEE_DB || '',
    tenant: process.env.WOC_AI_EMPLOYEE_TENANT || 'default',
    secretaryId: Math.max(1, Number(process.env.WOC_AI_EMPLOYEE_SECRETARY_ID || 1) || 1),
    cli:
      process.env.WOC_AI_EMPLOYEE_CLI ||
      '/home/ubuntu/projects/ai-wechat-employee/scripts/woc_management_api.py',
    python: process.env.WOC_AI_EMPLOYEE_PYTHON || 'python3',
    kbDir: process.env.WOC_AI_EMPLOYEE_KB_DIR || '/ai-employee-data/kb/uploads',
  };
}

// 已完整配置且落盘文件都在（enabled 且 DB/CLI 都存在）才算「可真跑」。
export function isConfigured(cfg: AiEmployeeConfig): boolean {
  return cfg.enabled && !!cfg.db && existsSync(cfg.db) && !!cfg.cli && existsSync(cfg.cli);
}

// 与 ai-wechat `events.compute_text_hash` 完全一致：先归一化空白（strip + 连续空白折叠成单空格），
// 再取 sha256 十六进制前 16 位。这样 WOC 侧对实例 id 算出的 hash 才能和 payload 的
// instance_id_hash 对齐，从而做可见性过滤。
export function computeTextHash(text: string): string {
  const normalized = (text ?? '').trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

// ---------- 子进程调用 CLI ----------
// 只读、无 shell、带超时；成功返回解析后的 payload，失败一律抛 coded Error（上层转 fallback）。
type CliSubcommand =
  | 'console'
  | 'approval-queue'
  | 'create-bind'
  | 'import-kb-dir'
  | 'apply-template'
  | 'set-policy'
  | 'auto-reply-test';
function runCli(cfg: AiEmployeeConfig, subcommand: CliSubcommand, extraArgs: string[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      cfg.python,
      [
        cfg.cli,
        subcommand,
        '--db',
        cfg.db,
        '--tenant',
        cfg.tenant,
        ...(subcommand === 'import-kb-dir' ? [] : ['--secretary-id', String(cfg.secretaryId)]),
        ...extraArgs,
      ],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // 不透传 stderr 原文：只标记短 code。timeout 时 err.killed 为 true。
          return reject(new Error((err as any).killed ? 'cli_timeout' : 'cli_failed'));
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('cli_bad_json'));
        }
      },
    );
  });
}


export interface AiServiceHealthResponse {
  enabled: boolean;
  mode: 'real' | 'demo_fallback';
  reason?: 'not_configured' | 'unavailable';
  source?: 'ai-wechat-employee';
  health: null | {
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
  };
}

export interface AiServiceRunsResponse {
  enabled: boolean;
  mode: 'real' | 'demo_fallback';
  reason?: 'not_configured' | 'unavailable';
  source?: 'ai-wechat-employee';
  runs: null | {
    status: string;
    employee_id: number;
    run_type: string | null;
    run_count: number;
    runs: RunCard[];
  };
}

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
}


const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const;
type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export function buildServiceActionPlan(action: unknown): AiServiceActionPlanResponse {
  const cfg = aiEmployeeConfig();
  const selected = SERVICE_ACTIONS.includes(action as ServiceAction) ? (action as ServiceAction) : 'start';
  const serviceCli = serviceCliPath(cfg);
  return {
    ok: true,
    mode: 'dry_run_disabled',
    enabled: isConfigured(cfg),
    action: selected,
    executable: false,
    planned_command: [
      cfg.python,
      serviceCli,
      selected,
      '--db',
      cfg.db || '<configured-db>',
      '--tenant',
      cfg.tenant,
      '--employee-id',
      String(cfg.secretaryId),
    ],
    safety_checks: [
      '确认当前实例已登录且授权给该 AI 员工',
      '确认 daemon 启动会先 baseline 当前消息，不处理历史消息',
      '确认自动发送仍受人审/安全词/频控闸门约束',
      '确认日志和返回值只展示 hash/count/status，不展示聊天正文',
    ],
    warnings: [
      '当前接口只返回计划，不执行 start/stop/restart',
      '正式开启写操作前必须补二次确认、审计日志和生产 E2E',
    ],
    next_required: 'enable_execute_path_with_confirmation_and_audit',
  };
}

function serviceCliPath(cfg: AiEmployeeConfig): string {
  return process.env.WOC_AI_EMPLOYEE_SERVICE_CLI || path.join(path.dirname(cfg.cli), 'woc_ai_employee_service.py');
}

function pickFlatObject(v: unknown): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    else if (typeof val === 'string' || typeof val === 'boolean' || val === null) out[k] = val;
  }
  return out;
}

function pickServiceHealth(v: any): NonNullable<AiServiceHealthResponse['health']> {
  return {
    status: str(v?.status) ?? '',
    service_state: str(v?.service_state) ?? 'unknown',
    pid_alive: !!v?.pid_alive,
    healthy: !!v?.healthy,
    last_iteration: num(v?.last_iteration),
    last_poll_at: str(v?.last_poll_at),
    vision_status: str(v?.vision_status) ?? 'unknown',
    recent_ocr: pickFlatObject(v?.recent_ocr),
    recent_reply: pickFlatObject(v?.recent_reply),
    recent_send: pickFlatObject(v?.recent_send),
    last_error_present: !!v?.last_error_present,
    last_error_hash: str(v?.last_error_hash),
    log_summary: pickFlatObject(v?.log_summary),
  };
}

function runServiceHealthCli(cfg: AiEmployeeConfig): Promise<any> {
  return new Promise((resolve, reject) => {
    const serviceCli = serviceCliPath(cfg);
    if (!existsSync(serviceCli)) return reject(new Error('service_cli_missing'));
    execFile(
      cfg.python,
      [
        serviceCli,
        'health',
        '--db',
        cfg.db,
        '--tenant',
        cfg.tenant,
        '--employee-id',
        String(cfg.secretaryId),
      ],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER, windowsHide: true },
      (_err, stdout) => {
        // health/status intentionally returns non-zero when offline/degraded. If it
        // produced valid JSON, treat it as a successful read-only health response.
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('service_health_bad_json'));
        }
      },
    );
  });
}


function runServiceRunsCli(cfg: AiEmployeeConfig): Promise<any> {
  return new Promise((resolve, reject) => {
    const serviceCli = serviceCliPath(cfg);
    if (!existsSync(serviceCli)) return reject(new Error('service_cli_missing'));
    execFile(
      cfg.python,
      [
        serviceCli,
        'recent-runs',
        '--db',
        cfg.db,
        '--tenant',
        cfg.tenant,
        '--employee-id',
        String(cfg.secretaryId),
        '--run-type',
        'service_lifecycle',
        '--limit',
        '20',
      ],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: CLI_MAX_BUFFER, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(new Error((err as any).killed ? 'service_runs_timeout' : 'service_runs_failed'));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('service_runs_bad_json'));
        }
      },
    );
  });
}

export async function buildServiceRunsResponse(log?: (code: string) => void): Promise<AiServiceRunsResponse> {
  const cfg = aiEmployeeConfig();
  if (!isConfigured(cfg)) {
    return { enabled: false, mode: 'demo_fallback', reason: 'not_configured', runs: null };
  }
  try {
    const raw = await runServiceRunsCli(cfg);
    const runs = Array.isArray(raw?.runs) ? raw.runs.map((r: any) => pickRun(r, () => null)) : [];
    return {
      enabled: true,
      mode: 'real',
      source: 'ai-wechat-employee',
      runs: {
        status: str(raw?.status) ?? 'ok',
        employee_id: num(raw?.employee_id) ?? cfg.secretaryId,
        run_type: str(raw?.run_type),
        run_count: num(raw?.run_count) ?? runs.length,
        runs,
      },
    };
  } catch (e: any) {
    log?.(e?.message || 'service_runs_failed');
    return { enabled: false, mode: 'demo_fallback', reason: 'unavailable', runs: null };
  }
}

export async function buildServiceHealthResponse(log?: (code: string) => void): Promise<AiServiceHealthResponse> {
  const cfg = aiEmployeeConfig();
  if (!isConfigured(cfg)) {
    return { enabled: false, mode: 'demo_fallback', reason: 'not_configured', health: null };
  }
  try {
    const raw = await runServiceHealthCli(cfg);
    return { enabled: true, mode: 'real', source: 'ai-wechat-employee', health: pickServiceHealth(raw) };
  } catch (e: any) {
    log?.(e?.message || 'service_health_failed');
    return { enabled: false, mode: 'demo_fallback', reason: 'unavailable', health: null };
  }
}

// ---------- 出参类型（allowlist） ----------
type TaskCounts = Record<string, number>;
type RunCounts = Record<string, number>;

export interface EmployeeCard {
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
  task_counts: TaskCounts;
  run_counts: RunCounts;
  latest_task_id: number | null;
  latest_run_id: number | null;
}
export interface InstanceCard {
  instance_id_hash: string;
  instance_id_suffix: string;
  // 回填当前账号可见的 WOC 实例 id（由 hash 反查而来，仅在命中可见实例时非空）。
  // 让前端能显示真实实例名并跳转，而无需拿到 ai-wechat 的 raw handle。
  woc_instance_id: string | null;
  bound_employee_ids: number[];
  active_binding_count: number;
  binding_scopes: Record<string, number>;
  permission_keys: string[];
  permission_count: number;
  task_counts: TaskCounts;
  run_counts: RunCounts;
  latest_run_id: number | null;
}
export interface TaskCard {
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
export interface RunCard {
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
export interface CustomerCard {
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
export interface KnowledgeDocument {
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
export interface KnowledgeGroup {
  group_key: string;
  document_count: number;
  chunk_count: number;
}
export interface KnowledgeSummary {
  document_count: number;
  chunk_count: number;
  enabled_count: number | null;
  disabled_count: number | null;
  group_count: number | null;
  groups: KnowledgeGroup[];
  documents: KnowledgeDocument[];
}

export interface KnowledgeImportResponse {
  ok: true;
  document_count: number;
  chunk_count: number;
  document_ids: number[];
}
export interface BindPayloadResponse {
  ok: true;
  channel_id: number;
  channel_type: string;
  bind_payload_hash: string;
  bind_token_hash: string;
  bind_payload_text: string;
}
export interface BindChannel {
  channel_id: number;
  channel_type: string;
  bind_status: string;
  bound_at: string | null;
  has_bind_token: boolean;
  created_at: string | null;
  updated_at: string | null;
}
export type SafeSummary = Record<string, number | string | boolean | null | Record<string, number>>;
export interface ConsolePayload {
  found: boolean;
  dashboard: Record<string, number | string | number[]> | null;
  employee_cards: EmployeeCard[];
  instance_cards: InstanceCard[];
  recent_tasks: TaskCard[];
  recent_runs: RunCard[];
  pending: Record<string, number> | null;
  customer_cards: CustomerCard[];
  knowledge_summary: KnowledgeSummary | null;
  bind_panel: {
    found: boolean;
    channel_count: number;
    counts: Record<string, number>;
    channels: BindChannel[];
  } | null;
  service_status_summary: SafeSummary | null;
  vision_status_summary: SafeSummary | null;
  approval_status_summary: SafeSummary | null;
  send_status_summary: SafeSummary | null;
  customer_status_summary: SafeSummary | null;
}


export interface ApprovalReplyJobCard {
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
export interface ApprovalSendActionCard {
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
export interface ApprovalEmployeeTaskCard {
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
export interface ApprovalQueuePayload {
  found: boolean;
  summary: Record<string, number>;
  reply_job_cards: ApprovalReplyJobCard[];
  send_action_cards: ApprovalSendActionCard[];
  employee_task_cards: ApprovalEmployeeTaskCard[];
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
      queue: ApprovalQueuePayload;
    };

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
      console: ConsolePayload;
    };

// ---------- allowlist pick ----------
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function pickCounts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    }
  }
  return out;
}

function pickStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function pickDashboard(v: unknown): ConsolePayload['dashboard'] {
  if (!v || typeof v !== 'object') return null;
  const out: Record<string, number | string | number[]> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    else if (typeof val === 'string') out[k] = val;
    else if (Array.isArray(val) && val.every((x) => typeof x === 'number')) out[k] = val as number[];
  }
  return out;
}

function pickEmployee(v: any): EmployeeCard {
  const approvalPolicyKeys = pickStringArray(v?.approval_policy_keys);
  const memoryPolicyKeys = pickStringArray(v?.memory_policy_keys);
  return {
    employee_id: num(v?.employee_id) ?? 0,
    name_hash: str(v?.name_hash) ?? '',
    name_suffix: str(v?.name_suffix) ?? '',
    role: str(v?.role) ?? '',
    status: str(v?.status) ?? '',
    responsibility_hash: str(v?.responsibility_hash) ?? '',
    responsibility_len: num(v?.responsibility_len) ?? 0,
    approval_policy_keys: approvalPolicyKeys,
    approval_policy_count: num(v?.approval_policy_count) ?? approvalPolicyKeys.length,
    memory_policy_keys: memoryPolicyKeys,
    memory_policy_count: num(v?.memory_policy_count) ?? memoryPolicyKeys.length,
    instance_count: num(v?.instance_count) ?? 0,
    task_counts: pickCounts(v?.task_counts),
    run_counts: pickCounts(v?.run_counts),
    latest_task_id: num(v?.latest_task_id),
    latest_run_id: num(v?.latest_run_id),
  };
}
function pickInstance(v: any, wocId: (h: unknown) => string | null): InstanceCard {
  return {
    instance_id_hash: str(v?.instance_id_hash) ?? '',
    instance_id_suffix: str(v?.instance_id_suffix) ?? '',
    woc_instance_id: wocId(v?.instance_id_hash),
    bound_employee_ids: Array.isArray(v?.bound_employee_ids)
      ? v.bound_employee_ids.filter((x: unknown) => typeof x === 'number')
      : [],
    active_binding_count: num(v?.active_binding_count) ?? 0,
    binding_scopes: pickCounts(v?.binding_scopes),
    permission_keys: pickStringArray(v?.permission_keys),
    permission_count: num(v?.permission_count) ?? pickStringArray(v?.permission_keys).length,
    task_counts: pickCounts(v?.task_counts),
    run_counts: pickCounts(v?.run_counts),
    latest_run_id: num(v?.latest_run_id),
  };
}
function pickTask(v: any, wocId: (h: unknown) => string | null): TaskCard {
  return {
    task_id: num(v?.task_id) ?? 0,
    status: str(v?.status) ?? '',
    task_type: str(v?.task_type) ?? '',
    employee_id: num(v?.employee_id) ?? 0,
    instance_id_hash: str(v?.instance_id_hash),
    instance_id_suffix: str(v?.instance_id_suffix),
    woc_instance_id: wocId(v?.instance_id_hash),
    input_redacted: str(v?.input_redacted),
    created_at: str(v?.created_at),
    updated_at: str(v?.updated_at),
  };
}
function pickRun(v: any, wocId: (h: unknown) => string | null): RunCard {
  return {
    run_id: num(v?.run_id) ?? 0,
    run_type: str(v?.run_type) ?? '',
    status: str(v?.status) ?? '',
    employee_id: num(v?.employee_id) ?? 0,
    task_id: num(v?.task_id),
    instance_id_hash: str(v?.instance_id_hash),
    instance_id_suffix: str(v?.instance_id_suffix),
    woc_instance_id: wocId(v?.instance_id_hash),
    redacted_summary: str(v?.redacted_summary),
    started_at: str(v?.started_at),
    finished_at: str(v?.finished_at),
  };
}
function pickCustomer(v: any): CustomerCard {
  return {
    instance_id_hash: str(v?.instance_id_hash) ?? '',
    instance_id_suffix: str(v?.instance_id_suffix) ?? '',
    conversation_key_hash: str(v?.conversation_key_hash) ?? '',
    display_name_hash: str(v?.display_name_hash) ?? '',
    message_count: num(v?.message_count) ?? 0,
    incoming_count: num(v?.incoming_count) ?? 0,
    outgoing_count: num(v?.outgoing_count) ?? 0,
    latest_observed_at: str(v?.latest_observed_at),
    active_memory_count: num(v?.active_memory_count) ?? 0,
    candidate_memory_count: num(v?.candidate_memory_count) ?? 0,
    profile_present: !!v?.profile_present,
    profile_stage: str(v?.profile_stage),
    profile_risk_level: str(v?.profile_risk_level),
    profile_intent_score: num(v?.profile_intent_score),
  };
}
function pickKnowledge(v: any): KnowledgeSummary | null {
  if (!v || typeof v !== 'object') return null;
  const docs = Array.isArray(v.documents) ? v.documents : [];
  return {
    document_count: num(v.document_count) ?? 0,
    chunk_count: num(v.chunk_count) ?? 0,
    enabled_count: num(v.enabled_count),
    disabled_count: num(v.disabled_count),
    group_count: num(v.group_count),
    groups: Array.isArray(v.groups)
      ? v.groups.map((g: any) => ({
          group_key: str(g?.group_key) ?? '',
          document_count: num(g?.document_count) ?? 0,
          chunk_count: num(g?.chunk_count) ?? 0,
        }))
      : [],
    documents: docs.map((d: any) => ({
      document_id: num(d?.document_id) ?? 0,
      title_hash: str(d?.title_hash) ?? '',
      title_suffix: str(d?.title_suffix) ?? '',
      source_path_hash: str(d?.source_path_hash) ?? '',
      source_path_suffix: str(d?.source_path_suffix) ?? '',
      content_hash: str(d?.content_hash) ?? '',
      chunk_count: num(d?.chunk_count) ?? 0,
      updated_at: str(d?.updated_at),
      enabled: typeof d?.enabled === 'boolean' ? d.enabled : null,
      version: num(d?.version),
      group_key: str(d?.group_key),
    })),
  };
}

function pickSafeSummary(v: unknown): SafeSummary | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: SafeSummary = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    else if (typeof val === 'string' || typeof val === 'boolean' || val === null) out[k] = val;
    else if (val && typeof val === 'object' && !Array.isArray(val)) {
      const counts = pickCounts(val);
      if (Object.keys(counts).length > 0) out[k] = counts;
    }
  }
  return out;
}

function pickChannel(v: any): BindChannel {
  return {
    channel_id: num(v?.channel_id) ?? 0,
    channel_type: str(v?.channel_type) ?? '',
    bind_status: str(v?.bind_status) ?? '',
    bound_at: str(v?.bound_at),
    has_bind_token: !!v?.has_bind_token,
    created_at: str(v?.created_at),
    updated_at: str(v?.updated_at),
  };
}

// ---------- 权限过滤 + allowlist：把 raw payload 收敛成给前端的 ConsolePayload ----------
// hashToId 为 null 表示「无法过滤」（payload 缺 instance_id_hash 字段），交由上层决定
// admin 放行 / 子账号回退；非空则据此过滤 + 回填 woc_instance_id。
function filterConsole(raw: any, hashToId: Map<string, string> | null): ConsolePayload {
  const rawInstances: any[] = Array.isArray(raw?.instance_cards) ? raw.instance_cards : [];
  const rawTasks: any[] = Array.isArray(raw?.recent_tasks) ? raw.recent_tasks : [];
  const rawRuns: any[] = Array.isArray(raw?.recent_runs) ? raw.recent_runs : [];
  const rawEmployees: any[] = Array.isArray(raw?.employee_cards) ? raw.employee_cards : [];
  const rawCustomers: any[] = Array.isArray(raw?.customer_cards) ? raw.customer_cards : [];

  const visible = (h: unknown): boolean => hashToId === null || (typeof h === 'string' && hashToId.has(h));
  const wocId = (h: unknown): string | null =>
    hashToId !== null && typeof h === 'string' ? hashToId.get(h) ?? null : null;

  const instanceCards = rawInstances.filter((c) => visible(c?.instance_id_hash)).map((c) => pickInstance(c, wocId));

  // 可见实例上绑定的员工 id 集合：employee_cards 只保留「绑定到可见实例」或「未绑定任何实例」
  // 的员工，避免泄露只绑定在不可见实例上的员工。
  const visibleEmployeeIds = new Set<number>();
  for (const c of instanceCards) for (const id of c.bound_employee_ids) visibleEmployeeIds.add(id);
  const employeeCards = rawEmployees
    .map(pickEmployee)
    .filter((e) => visibleEmployeeIds.has(e.employee_id) || e.instance_count === 0);

  // 任务/运行：绑定到可见实例的保留；instance 为 null（无实例关联）的也保留——不泄露任何隐藏实例。
  const recentTasks = rawTasks
    .map((t) => pickTask(t, wocId))
    .filter((t) => t.instance_id_hash === null || visible(t.instance_id_hash));
  const recentRuns = rawRuns
    .map((r) => pickRun(r, wocId))
    .filter((r) => r.instance_id_hash === null || visible(r.instance_id_hash));

  const customerCards = rawCustomers.filter((c) => visible(c?.instance_id_hash)).map(pickCustomer);

  const bp = raw?.bind_panel;
  const bindPanel = bp && typeof bp === 'object'
    ? {
        found: bp.found !== false,
        channel_count: num(bp.channel_count) ?? 0,
        counts: pickCounts(bp.counts),
        channels: Array.isArray(bp.channels) ? bp.channels.map(pickChannel) : [],
      }
    : null;

  return {
    found: raw?.found !== false,
    dashboard: pickDashboard(raw?.dashboard),
    employee_cards: employeeCards,
    instance_cards: instanceCards,
    recent_tasks: recentTasks,
    recent_runs: recentRuns,
    pending: raw?.pending && typeof raw.pending === 'object' ? pickCounts(raw.pending) : null,
    customer_cards: customerCards,
    knowledge_summary: pickKnowledge(raw?.knowledge_admin) ?? pickKnowledge(raw?.knowledge_summary),
    bind_panel: bindPanel,
    service_status_summary: pickSafeSummary(raw?.service_status_summary),
    vision_status_summary: pickSafeSummary(raw?.vision_status_summary),
    approval_status_summary: pickSafeSummary(raw?.approval_status_summary),
    send_status_summary: pickSafeSummary(raw?.send_status_summary),
    customer_status_summary: pickSafeSummary(raw?.customer_status_summary),
  };
}


function pickApprovalReplyJob(v: any, wocId: (h: unknown) => string | null): ApprovalReplyJobCard {
  return {
    reply_job_id: num(v?.reply_job_id) ?? 0,
    status: str(v?.status) ?? '',
    needs_human: !!v?.needs_human,
    should_send: !!v?.should_send,
    instance_id_hash: str(v?.instance_id_hash) ?? '',
    instance_id_suffix: str(v?.instance_id_suffix) ?? '',
    woc_instance_id: wocId(v?.instance_id_hash),
    conversation_key_hash: str(v?.conversation_key_hash) ?? '',
    incoming_message_id: num(v?.incoming_message_id),
    reply_text_hash: str(v?.reply_text_hash) ?? '',
    reply_text_len: num(v?.reply_text_len) ?? 0,
    retrieved_chunk_count: num(v?.retrieved_chunk_count) ?? 0,
    memory_count: num(v?.memory_count) ?? 0,
    reason_hash: str(v?.reason_hash),
    created_at: str(v?.created_at),
    updated_at: str(v?.updated_at),
  };
}
function pickApprovalSendAction(v: any, wocId: (h: unknown) => string | null): ApprovalSendActionCard {
  return {
    send_action_id: num(v?.send_action_id) ?? 0,
    reply_job_id: num(v?.reply_job_id),
    mode: str(v?.mode) ?? '',
    status: str(v?.status) ?? '',
    instance_id_hash: str(v?.instance_id_hash) ?? '',
    instance_id_suffix: str(v?.instance_id_suffix) ?? '',
    woc_instance_id: wocId(v?.instance_id_hash),
    conversation_key_hash: str(v?.conversation_key_hash) ?? '',
    reply_text_hash: str(v?.reply_text_hash) ?? '',
    has_plan: !!v?.has_plan,
    created_at: str(v?.created_at),
    updated_at: str(v?.updated_at),
  };
}
function pickApprovalEmployeeTask(v: any, wocId: (h: unknown) => string | null): ApprovalEmployeeTaskCard {
  return {
    task_id: num(v?.task_id) ?? 0,
    employee_id: num(v?.employee_id),
    task_type: str(v?.task_type) ?? '',
    status: str(v?.status) ?? '',
    instance_id_hash: str(v?.instance_id_hash),
    instance_id_suffix: str(v?.instance_id_suffix),
    woc_instance_id: wocId(v?.instance_id_hash),
    input_hash: str(v?.input_hash),
    input_redacted: str(v?.input_redacted),
    created_at: str(v?.created_at),
    updated_at: str(v?.updated_at),
  };
}
function filterApprovalQueue(raw: any, hashToId: Map<string, string>, includeUnknownInstances: boolean): ApprovalQueuePayload {
  const visible = (h: unknown): boolean => includeUnknownInstances || (typeof h === 'string' && hashToId.has(h));
  const wocId = (h: unknown): string | null => (typeof h === 'string' ? hashToId.get(h) ?? null : null);
  const replyJobCards = (Array.isArray(raw?.reply_job_cards) ? raw.reply_job_cards : [])
    .filter((c: any) => visible(c?.instance_id_hash))
    .map((c: any) => pickApprovalReplyJob(c, wocId));
  const sendActionCards = (Array.isArray(raw?.send_action_cards) ? raw.send_action_cards : [])
    .filter((c: any) => visible(c?.instance_id_hash))
    .map((c: any) => pickApprovalSendAction(c, wocId));
  const employeeTaskCards = (Array.isArray(raw?.employee_task_cards) ? raw.employee_task_cards : [])
    .filter((c: any) => c?.instance_id_hash == null || visible(c?.instance_id_hash))
    .map((c: any) => pickApprovalEmployeeTask(c, wocId));
  return {
    found: raw?.found !== false,
    summary: raw?.summary && typeof raw.summary === 'object' ? pickCounts(raw.summary) : {},
    reply_job_cards: replyJobCards,
    send_action_cards: sendActionCards,
    employee_task_cards: employeeTaskCards,
  };
}

// ---------- 主入口：给路由用 ----------
// 传入当前用户 + 其可见实例 id 列表。永不抛错——任何异常都收敛为 demo_fallback。
export async function buildConsoleResponse(
  user: Pick<User, 'role'>,
  visibleInstanceIds: string[],
  log?: (code: string) => void,
): Promise<AiEmployeeConsoleResponse> {
  const cfg = aiEmployeeConfig();
  const fallback = (
    reason: 'not_configured' | 'unavailable' | 'cannot_enforce_instance_filter',
  ): AiEmployeeConsoleResponse => ({
    enabled: false,
    mode: 'demo_fallback',
    reason,
    visibleInstanceIds,
    console: null,
  });

  if (!isConfigured(cfg)) return fallback('not_configured');

  let raw: any;
  try {
    raw = await runCli(cfg, 'console');
  } catch (e) {
    log?.((e as Error).message || 'cli_error');
    return fallback('unavailable');
  }

  if (!raw || raw.schema_version !== SCHEMA_VERSION) {
    log?.('schema_mismatch');
    return fallback('unavailable');
  }

  // 防御：契约里 instance_cards 应带 instance_id_hash。若确实缺字段而无法证明归属，
  // 子账号回退（reason=cannot_enforce_instance_filter），管理员放行看全量。
  const rawInstances: any[] = Array.isArray(raw.instance_cards) ? raw.instance_cards : [];
  const canFilter = rawInstances.every((c) => typeof c?.instance_id_hash === 'string');
  if (!canFilter && user.role !== 'admin') return fallback('cannot_enforce_instance_filter');

  const hashToId = new Map<string, string>();
  for (const id of visibleInstanceIds) hashToId.set(computeTextHash(id), id);
  const consolePayload = filterConsole(raw, user.role === 'admin' || !canFilter ? null : hashToId);

  return {
    enabled: true,
    mode: 'real',
    source: 'ai-wechat-employee',
    visibleInstanceCount: visibleInstanceIds.length,
    console: consolePayload,
  };
}



export async function buildApprovalQueueResponse(
  user: Pick<User, 'role'>,
  visibleInstanceIds: string[],
  log?: (code: string) => void,
): Promise<AiEmployeeApprovalQueueResponse> {
  const cfg = aiEmployeeConfig();
  const fallback = (reason: 'not_configured' | 'unavailable'): AiEmployeeApprovalQueueResponse => ({
    enabled: false,
    mode: 'demo_fallback',
    reason,
    visibleInstanceIds,
    queue: null,
  });
  if (!isConfigured(cfg)) return fallback('not_configured');
  let raw: any;
  try {
    raw = await runCli(cfg, 'approval-queue');
  } catch (e) {
    log?.((e as Error).message || 'cli_error');
    return fallback('unavailable');
  }
  if (!raw || raw.schema_version !== SCHEMA_VERSION || raw.page !== 'approval_queue') {
    log?.('schema_mismatch');
    return fallback('unavailable');
  }
  const hashToId = new Map<string, string>();
  for (const id of visibleInstanceIds) hashToId.set(computeTextHash(id), id);
  return {
    enabled: true,
    mode: 'real',
    source: 'ai-wechat-employee',
    visibleInstanceCount: visibleInstanceIds.length,
    queue: filterApprovalQueue(raw, hashToId, user.role === 'admin'),
  };
}

function safeKbFilename(title: string): string {
  const base = (title || 'knowledge').trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'knowledge'}-${Date.now()}.md`;
}

export async function importAiEmployeeKnowledge(
  title: string,
  markdown: string,
  log?: (code: string) => void,
): Promise<KnowledgeImportResponse | null> {
  const cfg = aiEmployeeConfig();
  if (!isConfigured(cfg)) return null;
  const body = markdown.trim();
  if (!body || body.length > 200_000) return null;
  try {
    await mkdir(cfg.kbDir, { recursive: true, mode: 0o700 });
    const filename = safeKbFilename(title);
    const target = path.join(cfg.kbDir, filename);
    await writeFile(target, body.endsWith('\n') ? body : `${body}\n`, { encoding: 'utf8', mode: 0o600 });
    const raw = await runCli(cfg, 'import-kb-dir', ['--kb-dir', cfg.kbDir, '--allowed-root', cfg.kbDir]);
    if (!raw || raw.schema_version !== SCHEMA_VERSION || raw.page !== 'import_kb_dir') return null;
    return {
      ok: true,
      document_count: num(raw.document_count) ?? 0,
      chunk_count: num(raw.chunk_count) ?? 0,
      document_ids: Array.isArray(raw.document_ids)
        ? raw.document_ids.filter((x: unknown) => typeof x === 'number')
        : [],
    };
  } catch (e) {
    log?.((e as Error).message || 'kb_import_failed');
    return null;
  }
}

export async function createAiEmployeeBindPayload(log?: (code: string) => void): Promise<BindPayloadResponse | null> {
  const cfg = aiEmployeeConfig();
  if (!isConfigured(cfg)) return null;
  try {
    const raw = await runCli(cfg, 'create-bind');
    if (!raw || raw.schema_version !== SCHEMA_VERSION || raw.page !== 'create_bind') return null;
    const text = str(raw.bind_payload_text);
    const channelId = num(raw.channel_id);
    if (!text || channelId === null) return null;
    return {
      ok: true,
      channel_id: channelId,
      channel_type: str(raw.channel_type) ?? 'wechat_bot',
      bind_payload_hash: str(raw.bind_payload_hash) ?? '',
      bind_token_hash: str(raw.bind_token_hash) ?? '',
      bind_payload_text: text,
    };
  } catch (e) {
    log?.((e as Error).message || 'cli_error');
    return null;
  }
}

// ---------- PR5：可编辑人格 + 自动回复策略（兼容式代理） ----------
// 后端分支 ai-wechat-employee feat/game-boost-auto-reply 会新增 CLI 子命令
// （apply-template / set-policy / auto-reply-test）暴露安全字段与写路径。
// 本层保持 fail-safe：未配置 / 命令缺失 / 子进程失败 → 一律返回结构化 unavailable，
// 绝不 500、绝不假装成功，也绝不把 stderr 原文透给前端。
//
// 数据安全：入参只接受人格模板文本 + policy/guardrail allowlist 键；出参只回
// hash/suffix/keys/status/decision 等安全字段，绝不回聊天正文 / reply 原文 / token。

// 自动回复授权模式（三档）：关闭 / 只生成建议 / 测试自动发送。
const AUTO_REPLY_MODES = ['disabled', 'suggest_only', 'auto_send_test'] as const;
// 生效范围（白名单会话为占位）。
const AUTO_REPLY_SCOPES = ['current_instance', 'bound_instances', 'whitelist'] as const;
// 强制人审触发（guardrail allowlist 键）：退款 / 封号 / 付款 / 外挂 / 链接 / 大额订单 / 投诉。
const GUARDRAIL_KEYS = ['refund', 'ban', 'payment', 'cheat', 'link', 'large_order', 'complaint'] as const;
// 岗位（售前 / 售中 / 售后）与语气（allowlist）。
const PERSONA_POSTS = ['pre_sale', 'in_sale', 'after_sale'] as const;
const PERSONA_TONES = ['professional', 'fast', 'human_like', 'not_pushy'] as const;

export interface AiActionUnavailable {
  ok: false;
  mode: 'unavailable';
  reason: 'backend_command_missing' | 'not_configured' | 'invalid_request';
}
const unavailable = (reason: AiActionUnavailable['reason']): AiActionUnavailable => ({
  ok: false,
  mode: 'unavailable',
  reason,
});

const boundedText = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pickAllowed = (v: unknown, allowed: readonly string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)))] : [];

// 入参 policy → 只保留 allowlist 字段并做长度收敛，绝不整块透传前端对象。
export interface PolicyInput {
  persona?: unknown;
  autoReply?: unknown;
}
interface SanitizedPolicy {
  persona: {
    display_name: string;
    service_domain: string;
    post: string;
    tones: string[];
    goals: string;
    forbidden: string;
  };
  auto_reply: {
    mode: string;
    scope: string;
    rate_limit_seconds: number;
    rate_limit_count: number;
    guardrail_keys: string[];
  };
}
function sanitizePolicy(input: PolicyInput): SanitizedPolicy {
  const persona = (input?.persona ?? {}) as Record<string, unknown>;
  const auto = (input?.autoReply ?? {}) as Record<string, unknown>;
  const mode = typeof auto.mode === 'string' && (AUTO_REPLY_MODES as readonly string[]).includes(auto.mode) ? auto.mode : 'suggest_only';
  const scope = typeof auto.scope === 'string' && (AUTO_REPLY_SCOPES as readonly string[]).includes(auto.scope) ? auto.scope : 'current_instance';
  const post = typeof persona.post === 'string' && (PERSONA_POSTS as readonly string[]).includes(persona.post) ? persona.post : 'pre_sale';
  return {
    persona: {
      display_name: boundedText(persona.displayName, 60),
      service_domain: boundedText(persona.serviceDomain, 60),
      post,
      tones: pickAllowed(persona.tones, PERSONA_TONES),
      goals: boundedText(persona.goals, 2000),
      forbidden: boundedText(persona.forbidden, 2000),
    },
    auto_reply: {
      mode,
      scope,
      rate_limit_seconds: Math.min(3600, Math.max(0, Math.floor(num(auto.rateLimitSeconds) ?? 60))),
      rate_limit_count: Math.min(100, Math.max(1, Math.floor(num(auto.rateLimitCount) ?? 1))),
      guardrail_keys: pickAllowed(auto.guardrails, GUARDRAIL_KEYS),
    },
  };
}

export interface ApplyTemplateResult {
  ok: true;
  mode: 'applied';
  employee_id: number;
  template_key: string;
  persona_hash: string;
  policy_keys: string[];
  guardrail_keys: string[];
}
export async function applyAiEmployeeTemplate(
  employeeId: number,
  templateKey: string,
  log?: (code: string) => void,
): Promise<ApplyTemplateResult | AiActionUnavailable> {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return unavailable('invalid_request');
  const cfg = aiEmployeeConfig();
  if (!isConfigured(cfg)) return unavailable('not_configured');
  const key = boundedText(templateKey, 64) || 'game_boost_support';
  try {
    const raw = await runCli(cfg, 'apply-template', ['--employee-id', String(employeeId), '--template', key]);
    if (!raw || raw.schema_version !== SCHEMA_VERSION || raw.page !== 'apply_template' || raw.ok === false) {
      return unavailable('backend_command_missing');
    }
    return {
      ok: true,
      mode: 'applied',
      employee_id: num(raw.employee_id) ?? employeeId,
      template_key: str(raw.template_key) ?? key,
      persona_hash: str(raw.persona_hash) ?? '',
      policy_keys: pickStringArray(raw.policy_keys),
      guardrail_keys: pickStringArray(raw.guardrail_keys),
    };
  } catch (e) {
    log?.((e as Error).message || 'cli_error');
    return unavailable('backend_command_missing');
  }
}

export interface SavePolicyResult {
  ok: true;
  mode: 'saved';
  employee_id: number;
  auto_reply_mode: string;
  scope: string;
  rate_limit_seconds: number;
  guardrail_keys: string[];
  persona_hash: string;
}
export async function saveAiEmployeePolicy(
  employeeId: number,
  input: PolicyInput,
  log?: (code: string) => void,
): Promise<SavePolicyResult | AiActionUnavailable> {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return unavailable('invalid_request');
  const cfg = aiEmployeeConfig();
  if (!isConfigured(cfg)) return unavailable('not_configured');
  const policy = sanitizePolicy(input);
  try {
    const raw = await runCli(cfg, 'set-policy', ['--employee-id', String(employeeId), '--payload', JSON.stringify(policy)]);
    if (!raw || raw.schema_version !== SCHEMA_VERSION || raw.page !== 'set_policy' || raw.ok === false) {
      return unavailable('backend_command_missing');
    }
    return {
      ok: true,
      mode: 'saved',
      employee_id: num(raw.employee_id) ?? employeeId,
      auto_reply_mode: str(raw.auto_reply_mode) ?? policy.auto_reply.mode,
      scope: str(raw.scope) ?? policy.auto_reply.scope,
      rate_limit_seconds: num(raw.rate_limit_seconds) ?? policy.auto_reply.rate_limit_seconds,
      guardrail_keys: pickStringArray(raw.guardrail_keys),
      persona_hash: str(raw.persona_hash) ?? '',
    };
  } catch (e) {
    log?.((e as Error).message || 'cli_error');
    return unavailable('backend_command_missing');
  }
}

export interface AutoReplyTestResult {
  ok: true;
  mode: 'evaluated';
  employee_id: number;
  decision: string; // auto_send | needs_human | suggest_only
  risk_level: string; // low | medium | high
  matched_guardrails: string[];
  redacted_summary: string;
}
export async function runAiEmployeeAutoReplyTest(
  employeeId: number,
  sampleText: string,
  log?: (code: string) => void,
): Promise<AutoReplyTestResult | AiActionUnavailable> {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return unavailable('invalid_request');
  const cfg = aiEmployeeConfig();
  if (!isConfigured(cfg)) return unavailable('not_configured');
  const sample = boundedText(sampleText, 500);
  if (!sample) return unavailable('invalid_request');
  try {
    const raw = await runCli(cfg, 'auto-reply-test', ['--employee-id', String(employeeId), '--sample', sample]);
    if (!raw || raw.schema_version !== SCHEMA_VERSION || raw.page !== 'auto_reply_test' || raw.ok === false) {
      return unavailable('backend_command_missing');
    }
    return {
      ok: true,
      mode: 'evaluated',
      employee_id: num(raw.employee_id) ?? employeeId,
      decision: str(raw.decision) ?? 'needs_human',
      risk_level: str(raw.risk_level) ?? 'medium',
      matched_guardrails: pickStringArray(raw.matched_guardrails),
      redacted_summary: str(raw.redacted_summary) ?? '',
    };
  } catch (e) {
    log?.((e as Error).message || 'cli_error');
    return unavailable('backend_command_missing');
  }
}
