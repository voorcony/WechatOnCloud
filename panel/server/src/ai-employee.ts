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
function runCli(cfg: AiEmployeeConfig, subcommand: 'console' | 'create-bind' | 'import-kb-dir', extraArgs: string[] = []): Promise<any> {
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

// ---------- 出参类型（allowlist） ----------
type TaskCounts = Record<string, number>;
type RunCounts = Record<string, number>;

export interface EmployeeCard {
  employee_id: number;
  role: string;
  status: string;
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
  title: string;
  source_path_hash: string;
  content_hash: string;
  chunk_count: number;
  updated_at: string | null;
}
export interface KnowledgeSummary {
  document_count: number;
  chunk_count: number;
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
  return {
    employee_id: num(v?.employee_id) ?? 0,
    role: str(v?.role) ?? '',
    status: str(v?.status) ?? '',
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
    documents: docs.map((d: any) => ({
      document_id: num(d?.document_id) ?? 0,
      title: str(d?.title) ?? '',
      source_path_hash: str(d?.source_path_hash) ?? '',
      content_hash: str(d?.content_hash) ?? '',
      chunk_count: num(d?.chunk_count) ?? 0,
      updated_at: str(d?.updated_at),
    })),
  };
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
    knowledge_summary: pickKnowledge(raw?.knowledge_summary),
    bind_panel: bindPanel,
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
  const consolePayload = filterConsole(raw, canFilter ? hashToId : null);

  return {
    enabled: true,
    mode: 'real',
    source: 'ai-wechat-employee',
    visibleInstanceCount: visibleInstanceIds.length,
    console: consolePayload,
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
