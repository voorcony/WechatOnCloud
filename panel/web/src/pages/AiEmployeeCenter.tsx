import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances, statusOf } from '../AppShell';
import {
  api,
  appProfile,
  type InstanceWithStatus,
  type AiEmployeeConsoleResponse,
  type AiConsolePayload,
  type AiEmployeeCard,
  type AiInstanceCard,
  type AiCustomerCard,
  type AiRunCard,
  type AiKnowledgeSummary,
  type AiSafeSummary,
  type AiBindPayloadResponse,
  type AiKnowledgeImportResponse,
  type AiPersonaDraft,
  type AiAutoReplyDraft,
  type AiEmployeeServiceHealthResponse,
  type AiEmployeeServiceRunsResponse,
  type AiServiceActionPlanResponse,
} from '../api';
import { InstanceIcon } from '../AppIcon';

// AI 员工中心（PR2：员工详情产品化）
// 定位：云微信实例之上的 AI 私域「员工管理中心」——像管理真实客服团队一样管理 AI 员工，
//   而不是一张指标表。左侧员工名册 + 右侧员工详情（身份人格 / 权限边界 / 负责微信 /
//   负责客户 / 知识库范围 / 运行记录）。
//
// 数据来源：
//   - 后端 /api/ai-employees/console 返回 mode="real" 且 console.found → 用真实 management 数据。
//   - 否则（未配置 / 子进程不可用 / 无法按实例过滤）→ 回退到 deterministic 本地演示，并明确提示。
//   两种模式都先归一化成同一套 ViewModel（EmployeeVM 等），因此列表 / 详情 / 各 tab 的组件
//   对真实与演示完全一致，只是数据来源不同。
//
// 安全（见 doc/AI员工二开后台.md）：
//   只展示 hash / suffix / 计数 / 状态 / keys / 阶段·意向·风险 / 脱敏摘要。
//   绝不渲染聊天正文 / 回复正文 / token / 绑定串明文 / 知识库原始标题 / 员工原始姓名 / 原始职责。
//   一次性绑定串仅用于二维码生成（QRCode.toDataURL），不以文本 / <code> 形式出现。

// 侧栏同款「AI 员工」图标（机器人/团队），供 AppShell 复用。
export const AiEmployeeIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 8V4.5" />
    <circle cx="12" cy="3.4" r="1.3" />
    <path d="M9 13h.01M15 13h.01" />
    <path d="M1.5 12v3M22.5 12v3" />
  </svg>
);

const ROLES = ['售前', '售后', '复购', '群运营'] as const;
type Role = (typeof ROLES)[number];
const ROLE_GLYPH: Record<string, string> = { 售前: '🛍️', 售后: '🛠️', 复购: '🔁', 群运营: '👥' };

// AI 员工的行为边界说明（按岗位生成的产品文案，非员工原始职责原文——安全可展示）。
const ROLE_BOUNDARY: Record<string, string> = {
  售前: '主动接待新客户咨询、介绍商品与活动、识别高意向并沉淀画像；报价与下单引导可自动进行，成交改价等敏感动作转人工确认。',
  售后: '处理退换货、物流与售后咨询，安抚情绪并给出标准话术；退款赔付等承诺类动作需人工确认后执行。',
  复购: '唤醒沉默客户、推送复购与会员权益，控制打扰频率；群发与优惠发放前需人工确认。',
  群运营: '维护社群秩序、回答常见问题、沉淀社群日报；踢人、群公告、大额优惠等操作需人工确认。',
};
const roleBoundary = (roleCn: string): string =>
  ROLE_BOUNDARY[roleCn] ?? 'AI 员工仅在授权的微信实例内工作；发送、改备注、群操作等敏感动作统一进入待确认队列，由人工确认后执行。';

// ---------- PR5：可编辑人格 + 自动回复策略 allowlist ----------
const PERSONA_POSTS: { key: string; label: string }[] = [
  { key: 'pre_sale', label: '售前' },
  { key: 'in_sale', label: '售中' },
  { key: 'after_sale', label: '售后' },
];
const PERSONA_TONES: { key: string; label: string }[] = [
  { key: 'professional', label: '专业' },
  { key: 'fast', label: '快速' },
  { key: 'human_like', label: '像真人' },
  { key: 'not_pushy', label: '不油腻' },
];
// 强制人审触发（guardrail allowlist 键）：退款 / 封号 / 付款 / 外挂 / 链接 / 大额订单 / 投诉。
const GUARDRAILS: { key: string; label: string }[] = [
  { key: 'refund', label: '退款' },
  { key: 'ban', label: '封号' },
  { key: 'payment', label: '付款' },
  { key: 'cheat', label: '外挂' },
  { key: 'link', label: '外部链接' },
  { key: 'large_order', label: '大额订单' },
  { key: 'complaint', label: '投诉' },
];
const AUTO_MODE_LABELS: Record<string, string> = {
  disabled: '已关闭',
  suggest_only: '只生成建议',
  auto_send_test: '测试自动发送',
};
const SCOPE_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'current_instance', label: '仅当前实例', hint: '只在该 AI 员工绑定的当前实例生效' },
  { key: 'bound_instances', label: '已绑定实例', hint: '该员工绑定的全部可见实例' },
  { key: 'whitelist', label: '白名单会话', hint: '仅白名单会话（UI 占位，后端接入后启用）' },
];
const TEST_DECISION_LABELS: Record<string, { t: string; cls: string }> = {
  auto_send: { t: '可自动发送', cls: 'st-on' },
  suggest_only: { t: '仅生成建议', cls: 'st-warn' },
  needs_human: { t: '强制人工确认', cls: 'st-off' },
};

// 一键「游戏代练客服模板」：人格 + 自动回复策略默认值（安全优先——默认只生成建议，不自动外发）。
const GAME_BOOST_PERSONA: AiPersonaDraft = {
  displayName: '代练客服小助手',
  serviceDomain: '游戏代练客服',
  post: 'pre_sale',
  tones: ['professional', 'fast', 'human_like', 'not_pushy'],
  goals:
    '收集客户需求：游戏 / 区服 / 平台、当前段位与目标段位、预算范围、时限要求、是否需要陪玩或代练，并沉淀为客户画像。',
  forbidden:
    '禁止承诺 100% 不封号 / 稳定不掉分；禁止提供或推荐违规外挂、脚本、第三方作弊工具；禁止诱导客户提供账号密码 / 支付密码 / 短信验证码等敏感凭证；禁止承诺代练必赢或虚构战绩。',
};
const GAME_BOOST_POLICY: AiAutoReplyDraft = {
  mode: 'suggest_only',
  scope: 'current_instance',
  rateLimitSeconds: 60,
  rateLimitCount: 1,
  guardrails: ['refund', 'ban', 'payment', 'cheat', 'link', 'large_order', 'complaint'],
};

// ---------- 真实数据的中文标签映射（未知值回退原字符串，绝不显示 raw 未知对象） ----------
const ROLE_LABELS: Record<string, string> = {
  pre_sales: '售前',
  after_sales: '售后',
  retention: '复购',
  group_ops: '群运营',
};
const TASK_TYPE_LABELS: Record<string, string> = {
  high_intent_summary: '高意向汇总',
  reply_customer: '回复客户',
  daily_report: '日报',
};
const RUN_TYPE_LABELS: Record<string, string> = {
  message_ingest: '接入客户消息',
  reply_suggest: '起草回复',
  approval_wait: '等待人工确认',
};
const RUN_STATUS: Record<string, { t: string; cls: string }> = {
  running: { t: '进行中', cls: 'st-busy' },
  completed: { t: '已完成', cls: 'st-on' },
  failed: { t: '失败', cls: 'st-off' },
  skipped: { t: '跳过', cls: '' },
};
// 权限 / 策略键的中文标签（未知键回退原键名，不显示原始对象）。
const KEY_LABELS: Record<string, string> = {
  send_message: '发送消息',
  reply: '回复客户',
  contact_remark: '修改备注',
  group_operation: '群操作',
  read_history: '读取历史',
  auto_reply: '自动回复',
  need_approval: '需人工确认',
  memory_write: '写入记忆',
  memory_read: '读取记忆',
  profile_update: '更新画像',
  knowledge_read: '检索知识库',
};
const label = (m: Record<string, string>, k: string): string => m[k] ?? k;
const keyLabel = (k: string): string => label(KEY_LABELS, k);
const empRoleLabel = (role: string): string => label(ROLE_LABELS, role);


function formatRunSummary(summary: string | null | undefined): string {
  const text = String(summary || '').trim();
  if (!text) return '—';
  const fields = Object.fromEntries(text.split(/\s+/).map((part) => {
    const i = part.indexOf('=');
    return i > 0 ? [part.slice(0, i), part.slice(i + 1)] : [part, ''];
  }));
  if (fields.source === 'service_lifecycle') {
    const state = fields.service_state || 'unknown';
    const vision = fields.vision_status || 'unknown';
    return `服务巡检 · 状态 ${state} · 视觉 ${vision}`;
  }
  return text.replace(/_/g, ' ').slice(0, 120);
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

// 稳定伪随机（按字符串派生），保证 demo 数字 / 派生 hash 不跳动。
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function fakeHash(s: string, len = 16): string {
  let out = '';
  let seed = seedOf(s);
  while (out.length < len) {
    seed = (Math.imul(seed, 16777619) ^ out.length) >>> 0;
    out += seed.toString(16).padStart(8, '0');
  }
  return out.slice(0, len);
}
function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + (b || 0), 0);
}
function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}

function stageLabel(stage: string | null): string {
  const map: Record<string, string> = { high_intent: '高意向', browsing: '了解中', after_sales: '售后', risk: '风险' };
  return stage ? map[stage] ?? stage : '待培育';
}
type Risk = 'high' | 'medium' | 'low';
function riskOf(risk: string | null): Risk {
  if (risk === 'high') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}
const RISK_LABEL: Record<Risk, string> = { high: '高风险', medium: '关注', low: '正常' };
const riskDotCls = (r: Risk): string => (r === 'high' ? 'st-off' : r === 'medium' ? 'st-warn' : 'st-on');

// ==================== 归一化 ViewModel ====================
interface InstanceVM {
  key: string;
  name: string;
  woc: InstanceWithStatus | null; // 命中可见实例 → 可跳转 + 真实状态
  suffix: string;
  appLabel: string;
  statusText: string;
  statusCls: string;
  bindingScopes: Record<string, number>;
  permissionKeys: string[];
  permissionCount: number;
  tasks: number;
  runs: number;
}
interface CustomerVM {
  key: string;
  code: string;
  instName: string;
  stage: string | null;
  intent: number | null;
  risk: Risk;
  messages: number;
  memActive: number;
  memCandidate: number;
  ago: string;
}
interface RunVM {
  key: string;
  emp: string;
  act: string;
  instName: string;
  status: { t: string; cls: string };
  summary: string;
  ago: string;
}
interface KnowledgeDocVM {
  key: string;
  label: string;
  titleHash: string;
  contentHash: string;
  chunks: number;
  status: string;
  ago: string;
  enabled: boolean | null;
  version: number | null;
  groupKey: string | null;
  sourceSuffix: string;
}
interface KnowledgeVM {
  docCount: number;
  chunkCount: number;
  enabledCount: number | null;
  disabledCount: number | null;
  groupCount: number | null;
  groups: { key: string; docs: number; chunks: number }[];
  docs: KnowledgeDocVM[];
}
interface PendingVM {
  total: number;
  rows: { key: string; label: string; value: number }[];
  drafts: { key: string; taskLabel: string; instName: string; redacted: string }[];
}
interface EmployeeVM {
  key: string;
  displayName: string;
  roleCn: string;
  statusText: string;
  statusCls: string; // st-on | st-warn | st-off
  statusKind: 'on' | 'warn' | 'off';
  nameSuffix: string;
  nameHash: string;
  respLen: number;
  respHash: string;
  approvalKeys: string[];
  approvalCount: number;
  memoryKeys: string[];
  memoryCount: number;
  permKeys: string[];
  permCount: number;
  instances: InstanceVM[];
  customers: CustomerVM[];
  runs: RunVM[];
  totalRuns: number;
  tasksWaiting: number;
}
interface OpsHealthVM {
  rows: { key: string; label: string; value: number; tone: 'ok' | 'warn' | 'danger' | '' }[];
  serviceText: string;
  visionText: string;
  customerText: string;
}
interface CenterVM {
  employees: EmployeeVM[];
  customers: CustomerVM[];
  runs: RunVM[];
  knowledge: KnowledgeVM;
  pending: PendingVM;
  health: OpsHealthVM;
}

const statusKindOf = (raw: string): 'on' | 'warn' | 'off' =>
  raw === 'active' ? 'on' : raw === 'paused' ? 'warn' : 'off';
const statusCn = (raw: string): string =>
  raw === 'active' ? '在岗' : raw === 'paused' ? '暂停' : raw === 'error' ? '异常' : raw || '异常';

// ---- 真实模式：把 console payload 归一化 ----
function buildRealVM(c: AiConsolePayload, wocById: Map<string, InstanceWithStatus>): CenterVM {
  // hash → 可见 woc 实例（instance_cards 带 woc_instance_id，客户/运行卡只有 hash）
  const hashToWoc = new Map<string, InstanceWithStatus>();
  for (const ic of c.instance_cards) {
    const w = ic.woc_instance_id ? wocById.get(ic.woc_instance_id) : undefined;
    if (w) hashToWoc.set(ic.instance_id_hash, w);
  }
  const instName = (suffix: string, hash: string | null, wocId: string | null): string => {
    const w = (wocId && wocById.get(wocId)) || (hash && hashToWoc.get(hash)) || null;
    return w ? w.name : suffix ? `实例 ···${suffix}` : '未关联实例';
  };
  const roleCnOf = (id: number): string => {
    const e = c.employee_cards.find((x) => x.employee_id === id);
    return e ? empRoleLabel(e.role) : '';
  };

  const instVM = (ic: AiInstanceCard): InstanceVM => {
    const woc = ic.woc_instance_id ? wocById.get(ic.woc_instance_id) ?? null : null;
    const st = woc ? statusOf(woc) : null;
    return {
      key: ic.instance_id_hash,
      name: woc ? woc.name : `实例 ···${ic.instance_id_suffix}`,
      woc,
      suffix: ic.instance_id_suffix,
      appLabel: woc ? appProfile(woc.appType).label : '不在可见范围',
      statusText: st ? st.text : '不可见',
      statusCls: st ? st.cls : '',
      bindingScopes: ic.binding_scopes,
      permissionKeys: ic.permission_keys,
      permissionCount: ic.permission_count,
      tasks: sumCounts(ic.task_counts),
      runs: sumCounts(ic.run_counts),
    };
  };
  const custVM = (cc: AiCustomerCard): CustomerVM => ({
    key: cc.conversation_key_hash,
    code: cc.conversation_key_hash.slice(0, 6),
    instName: instName(cc.instance_id_suffix, cc.instance_id_hash, null),
    stage: cc.profile_stage,
    intent: cc.profile_intent_score,
    risk: riskOf(cc.profile_risk_level),
    messages: cc.message_count,
    memActive: cc.active_memory_count,
    memCandidate: cc.candidate_memory_count,
    ago: timeAgo(cc.latest_observed_at),
  });
  const runVM = (r: AiRunCard): RunVM => ({
    key: String(r.run_id),
    emp: `${roleCnOf(r.employee_id)}助理`,
    act: label(RUN_TYPE_LABELS, r.run_type),
    instName: instName(r.instance_id_suffix ?? '', r.instance_id_hash, r.woc_instance_id),
    status: RUN_STATUS[r.status] ?? { t: r.status, cls: '' },
    summary: r.redacted_summary || '',
    ago: timeAgo(r.started_at),
  });

  const employees: EmployeeVM[] = c.employee_cards.map((e: AiEmployeeCard) => {
    const roleCn = empRoleLabel(e.role);
    const ics = c.instance_cards.filter((ic) => ic.bound_employee_ids.includes(e.employee_id));
    const boundHashes = new Set(ics.map((ic) => ic.instance_id_hash));
    const instances = ics.map(instVM);
    const customers = c.customer_cards.filter((cc) => boundHashes.has(cc.instance_id_hash)).map(custVM);
    const runs = c.recent_runs
      .filter((r) => r.employee_id === e.employee_id)
      .slice()
      .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
      .map(runVM);
    return {
      key: String(e.employee_id),
      displayName: `${roleCn}助理${e.name_suffix ? ' ···' + e.name_suffix : ''}`,
      roleCn,
      statusText: statusCn(e.status),
      statusCls: 'st-' + statusKindOf(e.status),
      statusKind: statusKindOf(e.status),
      nameSuffix: e.name_suffix,
      nameHash: e.name_hash,
      respLen: e.responsibility_len,
      respHash: e.responsibility_hash,
      approvalKeys: e.approval_policy_keys,
      approvalCount: e.approval_policy_count,
      memoryKeys: e.memory_policy_keys,
      memoryCount: e.memory_policy_count,
      permKeys: uniq(instances.flatMap((i) => i.permissionKeys)),
      permCount: uniq(instances.flatMap((i) => i.permissionKeys)).length,
      instances,
      customers,
      runs,
      totalRuns: sumCounts(e.run_counts),
      tasksWaiting: e.task_counts.waiting_approval ?? 0,
    };
  });

  const k = c.knowledge_summary;
  const knowledge = kbVMFromReal(k);
  const pending = pendingFromReal(c, instName);
  return {
    employees,
    customers: c.customer_cards.map(custVM),
    runs: c.recent_runs
      .slice()
      .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
      .map(runVM),
    knowledge,
    pending,
    health: healthFromReal(c),
  };
}

function safeMetric(s: AiSafeSummary | null | undefined, key: string): number {
  const v = s?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function safeText(s: AiSafeSummary | null | undefined, key: string, fallback: string): string {
  const v = s?.[key];
  return typeof v === 'string' && v ? v : fallback;
}
function healthFromReal(c: AiConsolePayload): OpsHealthVM {
  const approval = c.approval_status_summary;
  const send = c.send_status_summary;
  const service = c.service_status_summary;
  const vision = c.vision_status_summary;
  const customer = c.customer_status_summary;
  const pendingReply = safeMetric(approval, 'pending_reply_jobs');
  const plannedSend = safeMetric(send, 'planned_count');
  const failedSend = safeMetric(send, 'failed_count');
  const riskCustomers = safeMetric(customer, 'high_intent_count') + safeMetric(customer, 'risk_flag_count');
  return {
    rows: [
      { key: 'reply', label: '待人审回复', value: pendingReply, tone: pendingReply ? 'warn' : 'ok' },
      { key: 'send', label: '计划发送', value: plannedSend, tone: plannedSend ? 'warn' : 'ok' },
      { key: 'failed', label: '发送失败', value: failedSend, tone: failedSend ? 'danger' : 'ok' },
      { key: 'risk', label: '高意向/风险客户', value: riskCustomers, tone: riskCustomers ? 'warn' : '' },
    ],
    serviceText: `在线 ${safeMetric(service, 'online_count')} / 异常 ${safeMetric(service, 'degraded_count')}`,
    visionText: safeText(vision, 'source', 'none') === 'none' ? '视觉未上报' : '视觉已上报',
    customerText: `客户 ${safeMetric(customer, 'customer_count')} · 画像 ${safeMetric(customer, 'active_memory_count')}`,
  };
}

function kbVMFromReal(k: AiKnowledgeSummary | null): KnowledgeVM {
  if (!k) return { docCount: 0, chunkCount: 0, enabledCount: null, disabledCount: null, groupCount: null, groups: [], docs: [] };
  return {
    docCount: k.document_count,
    chunkCount: k.chunk_count,
    enabledCount: k.enabled_count ?? null,
    disabledCount: k.disabled_count ?? null,
    groupCount: k.group_count ?? null,
    groups: (k.groups ?? []).map((g) => ({ key: g.group_key || 'default', docs: g.document_count, chunks: g.chunk_count })),
    docs: k.documents.map((d) => ({
      key: String(d.document_id),
      label: d.title_suffix ? `文档 ···${d.title_suffix}` : `文档 ${d.title_hash.slice(0, 8)}`,
      titleHash: d.title_hash,
      contentHash: d.content_hash,
      chunks: d.chunk_count,
      status: d.enabled === false ? '已停用' : d.chunk_count > 0 ? '已启用' : '待切片',
      ago: timeAgo(d.updated_at),
      enabled: d.enabled,
      version: d.version,
      groupKey: d.group_key,
      sourceSuffix: d.source_path_suffix,
    })),
  };
}

function pendingFromReal(c: AiConsolePayload, instName: (s: string, h: string | null, w: string | null) => string): PendingVM {
  const p = c.pending ?? {};
  const rows = [
    { key: 'reply', label: '回复待人工', value: p.reply_jobs_needs_human ?? 0 },
    { key: 'task', label: '员工任务待人审', value: p.employee_tasks_waiting_approval ?? 0 },
    { key: 'send', label: '计划发送', value: p.send_actions_planned ?? 0 },
    { key: 'remark', label: '计划改备注', value: p.contact_remark_actions_planned ?? 0 },
    { key: 'group', label: '计划群操作', value: p.group_operation_actions_planned ?? 0 },
  ];
  const total = p.pending_total ?? rows.reduce((s, r) => s + r.value, 0);
  const drafts = c.recent_tasks
    .filter((t) => t.status === 'waiting_approval')
    .map((t) => ({
      key: String(t.task_id),
      taskLabel: label(TASK_TYPE_LABELS, t.task_type),
      instName: instName(t.instance_id_suffix ?? '', t.instance_id_hash, t.woc_instance_id),
      redacted: t.input_redacted || '（内容已脱敏，仅计数与状态可见）',
    }));
  return { total, rows, drafts };
}

// ---- 演示模式：把可见实例归一化成同结构的 demo 团队 ----
function buildDemoVM(instances: InstanceWithStatus[]): CenterVM {
  // 按 index 把实例分配到岗位，形成 1~4 个 demo 员工（每人负责一组实例）。
  const groups = new Map<Role, InstanceWithStatus[]>();
  instances.forEach((inst, i) => {
    const role = ROLES[i % ROLES.length];
    const arr = groups.get(role) ?? [];
    arr.push(inst);
    groups.set(role, arr);
  });

  const demoInstVM = (inst: InstanceWithStatus): InstanceVM => {
    const st = statusOf(inst);
    const seed = seedOf(inst.id + ':perm');
    const permKeys = ['reply', 'read_history', 'auto_reply', 'need_approval'].slice(0, 2 + (seed % 3));
    return {
      key: inst.id,
      name: inst.name,
      woc: inst,
      suffix: inst.id.slice(-4),
      appLabel: appProfile(inst.appType).label,
      statusText: st.text,
      statusCls: st.cls,
      bindingScopes: { chat: 1 + (seed % 3), group: seed % 2 },
      permissionKeys: permKeys,
      permissionCount: permKeys.length,
      tasks: 1 + (seed % 5),
      runs: 6 + (seedOf(inst.id + ':r') % 34),
    };
  };
  const demoCustomers = (insts: InstanceWithStatus[]): CustomerVM[] => {
    const out: CustomerVM[] = [];
    insts.forEach((inst) => {
      const n = 3 + (seedOf(inst.id + ':cn') % 5);
      for (let j = 0; j < n; j++) {
        const seed = seedOf(inst.id + ':c' + j);
        const risk: Risk = seed % 9 === 0 ? 'high' : seed % 3 === 0 ? 'medium' : 'low';
        out.push({
          key: inst.id + 'c' + j,
          code: 'A' + (100 + (seed % 800)),
          instName: inst.name,
          stage: ['high_intent', 'browsing', 'after_sales'][seed % 3],
          intent: 40 + (seed % 60),
          risk,
          messages: 6 + (seed % 40),
          memActive: seed % 5,
          memCandidate: seed % 3,
          ago: `${1 + (seed % 50)} 分钟前`,
        });
      }
    });
    return out;
  };
  const acts = ['接入客户消息', '起草回复（待确认）', '路由到对应岗位', '沉淀客户画像', '生成社群日报'];
  const runStatuses = [
    { t: '已完成', cls: 'st-on' },
    { t: '进行中', cls: 'st-busy' },
    { t: '待确认', cls: 'st-warn' },
  ];
  const demoRuns = (insts: InstanceWithStatus[], roleCn: string): RunVM[] =>
    insts.flatMap((inst, i) => {
      const n = 2 + (seedOf(inst.id + ':rn') % 2);
      return Array.from({ length: n }, (_, j) => {
        const seed = seedOf(inst.id + ':run' + i + j);
        return {
          key: inst.id + 'run' + i + j,
          emp: `${roleCn}助理`,
          act: acts[seed % acts.length],
          instName: inst.name,
          status: runStatuses[seed % runStatuses.length],
          summary: `会话 ···${(seed * 7919).toString(16).slice(0, 4)}`,
          ago: `${1 + (seed % 57)} 分钟前`,
        };
      });
    });

  const employees: EmployeeVM[] = [...groups.entries()].map(([roleCn, insts], idx) => {
    const seed = seedOf(roleCn + insts.map((i) => i.id).join());
    const instances = insts.map(demoInstVM);
    const customers = demoCustomers(insts);
    const runs = demoRuns(insts, roleCn);
    const anyRunning = insts.some((i) => statusOf(i).cls === 'st-on');
    const statusKind: 'on' | 'warn' | 'off' = anyRunning ? 'on' : insts.length ? 'warn' : 'off';
    const resp = roleBoundary(roleCn);
    const approvalKeys = ['send_message', 'contact_remark', 'group_operation'].slice(0, 1 + (seed % 3));
    const memoryKeys = ['memory_write', 'memory_read', 'profile_update'].slice(0, 1 + (seed % 3));
    const permKeys = uniq(instances.flatMap((i) => i.permissionKeys));
    return {
      key: `demo-${idx}-${roleCn}`,
      displayName: `${roleCn}助理`,
      roleCn,
      statusText: statusKind === 'on' ? '在岗' : statusKind === 'warn' ? '暂停' : '异常',
      statusCls: 'st-' + statusKind,
      statusKind,
      nameSuffix: fakeHash(roleCn, 4),
      nameHash: fakeHash('name-' + roleCn),
      respLen: resp.length,
      respHash: fakeHash('resp-' + roleCn),
      approvalKeys,
      approvalCount: approvalKeys.length,
      memoryKeys,
      memoryCount: memoryKeys.length,
      permKeys,
      permCount: permKeys.length,
      instances,
      customers,
      runs,
      totalRuns: instances.reduce((s, i) => s + i.runs, 0),
      tasksWaiting: seed % 3,
    };
  });

  const allCustomers = employees.flatMap((e) => e.customers);
  const allRuns = employees.flatMap((e) => e.runs).sort((a, b) => a.ago.localeCompare(b.ago));
  const n = Math.max(1, Math.min(4, instances.length || 1));
  const kbTitles = ['商品知识库', '退换货政策', '优惠活动话术', '常见问题 FAQ'];
  const knowledge: KnowledgeVM = {
    docCount: n,
    chunkCount: n * 6,
    enabledCount: n,
    disabledCount: 0,
    groupCount: Math.min(2, n),
    groups: [
      { key: 'default', docs: Math.ceil(n / 2), chunks: Math.ceil(n / 2) * 6 },
      ...(n > 1 ? [{ key: 'sales', docs: Math.floor(n / 2), chunks: Math.floor(n / 2) * 6 }] : []),
    ],
    docs: Array.from({ length: n }, (_, i) => ({
      key: 'kb' + i,
      label: kbTitles[i % kbTitles.length],
      titleHash: fakeHash('kb' + i),
      contentHash: fakeHash('kb-content' + i),
      chunks: 4 + (seedOf('kb' + i) % 10),
      status: '已启用',
      ago: `${1 + (seedOf('kb' + i) % 12)} 小时前`,
      enabled: true,
      version: 1 + i,
      groupKey: i % 2 ? 'sales' : 'default',
      sourceSuffix: '.md',
    })),
  };
  const waitingTotal = employees.reduce((s, e) => s + e.tasksWaiting, 0);
  const pending: PendingVM = {
    total: waitingTotal,
    rows: [
      { key: 'reply', label: '回复待人工', value: waitingTotal },
      { key: 'send', label: '计划发送', value: instances.length ? seedOf('send' + instances.length) % 2 : 0 },
      { key: 'remark', label: '计划改备注', value: instances.length ? seedOf('remark') % 2 : 0 },
    ],
    drafts: employees
      .filter((e) => e.tasksWaiting > 0)
      .slice(0, 5)
      .map((e) => ({
        key: e.key,
        taskLabel: '回复客户',
        instName: e.instances[0]?.name ?? '—',
        redacted: 'AI 已起草回复，等待人工确认后发送（正文脱敏，仅可确认/驳回）',
      })),
  };

  return { employees, customers: allCustomers, runs: allRuns, knowledge, pending, health: demoHealth(instances.length, waitingTotal) };
}

function demoHealth(instanceCount: number, waitingTotal: number): OpsHealthVM {
  return {
    rows: [
      { key: 'reply', label: '待人审回复', value: waitingTotal, tone: waitingTotal ? 'warn' : 'ok' },
      { key: 'send', label: '计划发送', value: instanceCount ? seedOf('send' + instanceCount) % 2 : 0, tone: 'warn' },
      { key: 'failed', label: '发送失败', value: 0, tone: 'ok' },
      { key: 'risk', label: '高意向/风险客户', value: Math.max(0, instanceCount - 1), tone: instanceCount > 1 ? 'warn' : '' },
    ],
    serviceText: `在线 ${instanceCount} / 异常 0`,
    visionText: '视觉演示模式',
    customerText: '客户画像演示',
  };
}

// ==================== Tab 结构 ====================
type Seg = 'overview' | 'customers' | 'knowledge' | 'tools' | 'pending' | 'bind' | 'runs' | 'settings';
const SEGMENTS: { key: Seg; label: string }[] = [
  { key: 'overview', label: '员工总览' },
  { key: 'customers', label: '客户画像' },
  { key: 'knowledge', label: '知识库' },
  { key: 'tools', label: '工具与工作流' },
  { key: 'pending', label: '待确认' },
  { key: 'bind', label: '绑定秘书' },
  { key: 'runs', label: '运行记录' },
  { key: 'settings', label: '运营设置' },
];

export default function AiEmployeeCenter({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user } = useAuth();
  const { instances, loaded } = useInstances();
  const nav = useNavigate();
  const loc = useLocation();
  const isAdmin = user?.role === 'admin';

  // 支持从侧栏「客户 / 待确认」等入口用 ?tab= 直达对应分段，并随 URL 变化同步。
  const tabParam = new URLSearchParams(loc.search).get('tab');
  const validSeg = (t: string | null): Seg | null =>
    t && SEGMENTS.some((s) => s.key === t) ? (t as Seg) : null;
  const [seg, setSeg] = useState<Seg>(() => validSeg(tabParam) ?? 'overview');
  useEffect(() => {
    const s = validSeg(new URLSearchParams(loc.search).get('tab'));
    if (s) setSeg(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.search]);

  // 拉取真实 console 快照（只读）。失败一律视为 fallback，绝不阻塞页面。
  const [resp, setResp] = useState<AiEmployeeConsoleResponse | null>(null);
  const [probed, setProbed] = useState(false);
  const loadConsole = () => {
    setProbed(false);
    api
      .aiEmployeeConsole()
      .then((r) => setResp(r))
      .catch(() => setResp(null))
      .finally(() => setProbed(true));
  };
  useEffect(() => {
    loadConsole();
  }, []);

  const [serviceHealth, setServiceHealth] = useState<AiEmployeeServiceHealthResponse | null>(null);
  const [serviceRuns, setServiceRuns] = useState<AiEmployeeServiceRunsResponse | null>(null);
  const [serviceActionPlan, setServiceActionPlan] = useState<AiServiceActionPlanResponse | null>(null);
  const [startingService, setStartingService] = useState(false);
  const [stoppingService, setStoppingService] = useState(false);
  const [serviceRefreshing, setServiceRefreshing] = useState(false);
  const [serviceRefreshedAt, setServiceRefreshedAt] = useState<number | null>(null);
  const refreshServiceState = async () => {
    setServiceRefreshing(true);
    try {
      const [health, runs, plan] = await Promise.all([
        api.aiEmployeeServiceHealth().catch(() => null),
        api.aiEmployeeServiceRuns().catch(() => null),
        api.aiEmployeeServiceActionPlan('start').catch(() => null),
      ]);
      setServiceHealth(health);
      setServiceRuns(runs);
      setServiceActionPlan(plan);
      setServiceRefreshedAt(Date.now());
    } finally {
      setServiceRefreshing(false);
    }
  };
  useEffect(() => {
    void refreshServiceState();
  }, []);
  useEffect(() => {
    const pidAlive = serviceHealth?.mode === 'real' && serviceHealth.health.pid_alive;
    if (!pidAlive && !startingService && !stoppingService) return undefined;
    const timer = window.setInterval(() => {
      void refreshServiceState();
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHealth?.mode, serviceHealth?.mode === 'real' ? serviceHealth.health.pid_alive : false, startingService, stoppingService]);

  const real = resp?.mode === 'real' && resp.console.found ? resp.console : null;
  const wocById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);
  const vm = useMemo<CenterVM>(
    () => (real ? buildRealVM(real, wocById) : buildDemoVM(instances)),
    [real, wocById, instances],
  );

  const abnormal = instances.filter((i) => i.runtime !== 'running' || !i.wechat.installed).length;
  const activeEmployees = vm.employees.filter((e) => e.statusKind === 'on').length;
  const kpis = [
    { label: 'AI 员工', value: vm.employees.length, tone: '' },
    { label: '在岗', value: activeEmployees, tone: '' },
    { label: '负责客户', value: vm.customers.length, tone: '' },
    { label: '知识文档', value: vm.knowledge.docCount, tone: '' },
    { label: '待确认', value: vm.pending.total, tone: vm.pending.total ? 'warn' : '' },
    { label: '异常', value: abnormal, tone: abnormal ? 'danger' : '' },
  ];

  const empty = loaded && instances.length === 0;
  const ready = loaded && probed;

  return (
    <div className="console-page">
      <div className="page-h">
        <div>
          <h1>AI 员工</h1>
          <p>
            像管理团队一样管理 AI：身份人格 → 权限边界 → 负责微信 → 负责客户 → 知识库 → 运行记录。
            每个 AI 员工的可操作范围 = 当前账号在云微授权下可见的实例；管理员看全部，子账号只看被授权实例。
          </p>
        </div>
        <div className="act">
          <button className="btn" onClick={() => setSeg('knowledge')}>📚 导入知识库</button>
          <button className="btn primary" onClick={() => setSeg('bind')}>📲 扫码绑定秘书</button>
        </div>
      </div>

      {probed &&
        (real ? (
          <div className="src-note real">
            <span className="d" /> 已接入真实 AI 员工数据 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）
          </div>
        ) : (
          <div className="src-note demo">
            <span className="d" /> 演示数据：当前未配置 AI 员工数据源
            {resp && resp.mode === 'demo_fallback' && resp.reason === 'cannot_enforce_instance_filter'
              ? '（无法按实例过滤，已对子账号回退）'
              : ''}
            。实例名称与在线状态为真实值，员工 / 客户 / 运行为占位演示。
          </div>
        ))}

      <div className="kpi-grid k6">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
            <div className={'delta' + (k.tone === 'danger' ? ' down' : k.tone === 'warn' ? ' warn' : ' muted')}>
              {k.tone === 'danger' ? '需处理' : k.tone === 'warn' ? '待确认' : 'AI 私域团队'}
            </div>
          </div>
        ))}
      </div>

      <OperationsHealthCard health={vm.health} demo={!real} />
      <ServiceHealthCard
        resp={serviceHealth}
        runs={serviceRuns}
        actionPlan={serviceActionPlan}
        isAdmin={isAdmin}
        starting={startingService}
        stopping={stoppingService}
        refreshing={serviceRefreshing}
        refreshedAt={serviceRefreshedAt}
        onRefresh={() => void refreshServiceState()}
        onStartObserveOnly={async () => {
          if (!window.confirm('启动 AI 员工（观察模式）？\n\n当前只观察/记录，不发送微信；会 baseline 当前消息，避免处理历史消息。')) return;
          setStartingService(true);
          try {
            const r = await api.aiEmployeeServiceActionPlan('start', { execute: true, confirm: true });
            setServiceActionPlan(r);
            void refreshServiceState();
          } finally {
            setStartingService(false);
          }
        }}
        onStopObserveOnly={async () => {
          if (!window.confirm('停止 AI 员工观察服务？\n\n只停止后台观察 daemon，不发送微信，也不清空数据。')) return;
          setStoppingService(true);
          try {
            const r = await api.aiEmployeeServiceActionPlan('stop', { execute: true, confirm: true });
            setServiceActionPlan(r);
            void refreshServiceState();
          } finally {
            setStoppingService(false);
          }
        }}
      />

      <div className="tabs" role="tablist" style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-elev)' }}>
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={seg === s.key}
            className={'tab' + (seg === s.key ? ' active' : '')}
            onClick={() => setSeg(s.key)}
          >
            {s.label}
            {s.key === 'pending' && vm.pending.total > 0 && <span className="num">{vm.pending.total}</span>}
          </button>
        ))}
      </div>

      {empty ? (
        <div style={{ marginTop: 16 }}>
          <EmptyBinds isAdmin={isAdmin} onManage={() => nav('/admin')} />
        </div>
      ) : !ready ? (
        <div className="loading">加载可见实例…</div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {seg === 'overview' && (
            <EmployeeWorkspace vm={vm} demo={!real} onOpenInstance={(id) => nav(`/i/${id}`)} onGotoTab={setSeg} />
          )}
          {seg === 'customers' && <CustomerBoard customers={vm.customers} demo={!real} />}
          {seg === 'knowledge' && <KnowledgePanel real={real} knowledge={vm.knowledge} onImported={loadConsole} />}
          {seg === 'tools' && <ToolsPanel vm={vm} demo={!real} />}
          {seg === 'pending' && <PendingBoard pending={vm.pending} demo={!real} />}
          {seg === 'bind' && <BindPanel real={real} />}
          {seg === 'runs' && <RunLog runs={vm.runs} demo={!real} />}
          {seg === 'settings' && <SettingsPanel resp={resp} real={!!real} vm={vm} instanceCount={instances.length} isAdmin={isAdmin} />}
        </div>
      )}
    </div>
  );
}


function OperationsHealthCard({ health, demo }: { health: OpsHealthVM; demo: boolean }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-h">
        <span className="title">运营健康</span>
        <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {demo ? '演示口径' : '真实安全摘要'} · 只显示计数 / 状态 / hash
        </span>
      </div>
      <div className="card-b">
        <div className="grid-4">
          {health.rows.map((r) => (
            <div key={r.key} className="mini-stat">
              <span>{r.label}</span>
              <b className={r.tone === 'danger' ? 'danger' : r.tone === 'warn' ? 'warn' : ''}>{r.value}</b>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
          <span className="chip outline">服务：{health.serviceText}</span>
          <span className="chip outline">视觉：{health.visionText}</span>
          <span className="chip outline">客户：{health.customerText}</span>
        </div>
      </div>
    </div>
  );
}


function ServiceHealthCard({
  resp,
  runs,
  actionPlan,
  isAdmin,
  starting,
  stopping,
  refreshing,
  refreshedAt,
  onRefresh,
  onStartObserveOnly,
  onStopObserveOnly,
}: {
  resp: AiEmployeeServiceHealthResponse | null;
  runs: AiEmployeeServiceRunsResponse | null;
  actionPlan: AiServiceActionPlanResponse | null;
  isAdmin: boolean;
  starting: boolean;
  stopping: boolean;
  onStartObserveOnly: () => void | Promise<void>;
  onStopObserveOnly: () => void | Promise<void>;
}) {
  if (!resp) return null;
  const h = resp.mode === 'real' ? resp.health : null;
  const state = h?.service_state ?? 'unknown';
  const tone = state === 'online' ? 'brand' : state === 'degraded' ? 'warn' : state === 'offline' ? 'outline' : 'danger';
  const refreshText = refreshedAt ? new Date(refreshedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '未刷新';
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-h">
        <span className="title">AI 员工服务状态</span>
        <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>刷新 {refreshText}</span>
        <button className="btn sm" disabled={refreshing} onClick={onRefresh}>{refreshing ? '刷新中…' : '刷新'}</button>
        <span className={'chip ' + tone}>{resp.mode === 'real' ? state : '未配置'}</span>
      </div>
      <div className="card-b">
        {h ? (
          <>
            <div className="grid-4">
              <div className="mini-stat"><span>进程</span><b>{h.pid_alive ? '存活' : '未运行'}</b></div>
              <div className="mini-stat"><span>视觉状态</span><b>{h.vision_status}</b></div>
              <div className="mini-stat"><span>最近轮次</span><b>{h.last_iteration ?? '—'}</b></div>
              <div className="mini-stat"><span>最近错误</span><b className={h.last_error_present ? 'warn' : ''}>{h.last_error_present ? '有' : '无'}</b></div>
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
              <span className="chip outline">OCR events: {String(h.recent_ocr.events_inserted ?? '—')}</span>
              <span className="chip outline">duplicates: {String(h.recent_ocr.duplicates ?? '—')}</span>
              <span className="chip outline">reply: {String(h.recent_reply.decision ?? '—')}</span>
              <span className="chip outline">send: {String(h.recent_send.action_status ?? '—')}</span>
              <span className="chip outline">log: {String(h.log_summary.path_suffix ?? '—')}</span>
            </div>
            <div className="dim" style={{ marginTop: 8, fontSize: 11 }}>
              管理员可二次确认启动/停止 AI 员工观察服务；当前模式只观察/记录，不自动发送微信。
            </div>
            {runs?.mode === 'real' && runs.runs.runs.length > 0 && (
              <div className="card" style={{ marginTop: 12, overflow: 'hidden' }}>
                <div className="card-h">
                  <span className="title">服务生命周期记录</span>
                  <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>最近 {runs.runs.run_count} 条</span>
                </div>
                <table className="t">
                  <thead><tr><th>run</th><th>状态</th><th>摘要</th><th>时间</th></tr></thead>
                  <tbody>
                    {runs.runs.runs.slice(-6).reverse().map((r) => (
                      <tr key={r.run_id}>
                        <td className="mono">#{r.run_id}</td>
                        <td><span className={'dot ' + (r.status === 'completed' ? 'st-on' : r.status === 'failed' ? 'st-off' : 'st-busy')} /> {r.status}</td>
                        <td className="dim">{formatRunSummary(r.redacted_summary)}</td>
                        <td className="dim">{r.started_at ? timeAgo(r.started_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {runs?.mode === 'real' && runs.runs.runs.length === 0 && (
              <div className="safe-note" style={{ marginTop: 12 }}>暂无服务生命周期运行记录。</div>
            )}
            {actionPlan && (
              <ServiceActionPlanCard
                plan={actionPlan}
                isAdmin={isAdmin}
                starting={starting}
                stopping={stopping}
                pidAlive={h.pid_alive}
                onStartObserveOnly={onStartObserveOnly}
                onStopObserveOnly={onStopObserveOnly}
              />
            )}
          </>
        ) : (
          <div className="safe-note">AI 员工服务 health 接口未配置或不可用；本卡只读，不影响现有 console 数据。</div>
        )}
      </div>
    </div>
  );
}


function ServiceActionPlanCard({
  plan,
  isAdmin,
  starting,
  stopping,
  pidAlive,
  onStartObserveOnly,
  onStopObserveOnly,
}: {
  plan: AiServiceActionPlanResponse;
  isAdmin: boolean;
  starting: boolean;
  stopping: boolean;
  onStartObserveOnly: () => void | Promise<void>;
  onStopObserveOnly: () => void | Promise<void>;
}) {
  const result = plan.execution_result;
  const record = result?.record ?? plan.audit_record;
  const resultTone = result?.status === 'failed' ? 'danger' : plan.mode === 'executed' ? 'brand' : 'warn';
  const modeLabel = plan.mode === 'executed' ? '已执行' : plan.mode === 'dry_run_disabled' ? '待确认' : '观察模式';
  const busy = starting || stopping;
  const canStart = isAdmin && !busy && !pidAlive;
  const canStop = isAdmin && !busy && pidAlive;
  return (
    <div className="safe-note" style={{ marginTop: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>AI 员工启动</b>
        <span className={plan.mode === 'executed' ? 'chip brand' : 'chip warn'}>{modeLabel}</span>
        {result && <span className={'chip ' + resultTone}>结果 {result.status}</span>}
        <button className="btn primary" disabled={!canStart} onClick={onStartObserveOnly} title={isAdmin ? (pidAlive ? 'AI 员工观察服务已在运行' : '二次确认后启动 AI 员工观察模式，不自动发送微信') : '当前子账号无启动权限，请用管理员账号启动'}>
          {starting ? '启动中…' : '启动 AI 员工'}
        </button>
        <button className="btn" disabled={!canStop} onClick={onStopObserveOnly} title={isAdmin ? (pidAlive ? '二次确认后停止 AI 员工观察服务' : 'AI 员工观察服务未运行') : '当前子账号无停止权限，请用管理员账号停止'}>
          {stopping ? '停止中…' : '停止 AI 员工'}
        </button>
      </div>
      {!isAdmin && <div className="dim" style={{ marginTop: 8 }}>当前账号是子账号：可以查看运行状态和审批详情；启动/停止 AI 员工需要管理员权限。</div>}
      <div className="dim" style={{ marginTop: 8 }}>
        启动 AI 员工会进入观察模式：先 baseline 当前消息，不处理历史消息，也不自动发送微信；停止只停止后台观察服务。当前状态：{result ? `${result.status} / health=${result.health_state || 'checking'}` : plan.block_reason || '待确认'}。
      </div>
      {result && (
        <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
          <span className="chip outline">pid {result.pid_alive ? 'alive' : 'stopped'}</span>
          <span className="chip outline">health {result.health_checked ? result.health_state || 'unknown' : 'unchecked'}</span>
          <span className="chip outline">wait {result.health_wait_ms}ms</span>
          <span className="chip outline">audit {record?.recorded ? `#${record.run_id ?? 'recorded'}` : 'not recorded'}</span>
        </div>
      )}
      <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
        {plan.safety_checks.slice(0, 4).map((x) => <span key={x} className="chip outline">{x}</span>)}
      </div>
    </div>
  );
}

// ==================== 员工总览：名册 + 详情 ====================
function EmployeeWorkspace({
  vm,
  demo,
  onOpenInstance,
  onGotoTab,
}: {
  vm: CenterVM;
  demo: boolean;
  onOpenInstance: (id: string) => void;
  onGotoTab: (s: Seg) => void;
}) {
  const [selKey, setSelKey] = useState<string | null>(null);
  const selected = vm.employees.find((e) => e.key === selKey) ?? vm.employees[0] ?? null;

  if (vm.employees.length === 0) {
    return <div className="safe-note">当前可见实例上暂无已绑定的 AI 员工。请先在「绑定秘书」生成绑定码接入大秘书。</div>;
  }
  const statusChip = (k: 'on' | 'warn' | 'off') => (k === 'on' ? 'brand' : k === 'warn' ? 'warn' : 'outline');
  return (
    <div>
      <div className="agent-grid">
        {vm.employees.map((e) => {
          const highRisk = e.customers.filter((c) => c.risk === 'high').length;
          const caps = uniq([...e.permKeys, ...e.approvalKeys]).slice(0, 3);
          return (
            <button
              key={e.key}
              className={'agent-card' + (selected && e.key === selected.key ? ' active' : '')}
              onClick={() => setSelKey(e.key)}
            >
              <div className="row1">
                <div className="emoji">{ROLE_GLYPH[e.roleCn] ?? '🤖'}</div>
                <div className="info">
                  <div className="name">{e.displayName}</div>
                  <div className="role">{e.roleCn}岗 · name ···{e.nameSuffix || '——'}</div>
                </div>
                <span className={'chip ' + statusChip(e.statusKind)} style={{ marginLeft: 'auto' }}>
                  <span className={'dot st-' + e.statusKind} /> {e.statusText}
                </span>
              </div>
              <div className="desc">{roleBoundary(e.roleCn)}</div>
              <div className="row2">
                <span className="chip outline">微信 {e.instances.length}</span>
                <span className="chip outline">客户 {e.customers.length}</span>
                <span className="chip outline">运行 {e.totalRuns}</span>
                {e.tasksWaiting > 0 && <span className="chip warn">待确认 {e.tasksWaiting}</span>}
                {highRisk > 0 && <span className="chip danger">高风险 {highRisk}</span>}
              </div>
              <div className="row2" style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 2 }}>
                {caps.length === 0 ? (
                  <span className="chip outline">默认能力 · 敏感动作需确认</span>
                ) : (
                  caps.map((k) => <span key={k} className="chip accent">{keyLabel(k)}</span>)
                )}
                {e.permKeys.length + e.approvalKeys.length > caps.length && (
                  <span className="chip outline">+{e.permKeys.length + e.approvalKeys.length - caps.length}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div style={{ marginTop: 16 }}>
          <EmployeeDetail emp={selected} knowledge={vm.knowledge} demo={demo} onOpenInstance={onOpenInstance} onGotoTab={onGotoTab} />
        </div>
      )}
    </div>
  );
}

function EmployeeDetail({
  emp,
  knowledge,
  demo,
  onOpenInstance,
  onGotoTab,
}: {
  emp: EmployeeVM;
  knowledge: KnowledgeVM;
  demo: boolean;
  onOpenInstance: (id: string) => void;
  onGotoTab: (s: Seg) => void;
}) {
  return (
    <div className="agent-detail">
      {/* 左：基础信息 */}
      <div className="side col" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-h">
            <div className="emoji" style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--brand-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
              {ROLE_GLYPH[emp.roleCn] ?? '🤖'}
            </div>
            <span className="title">{emp.displayName}</span>
            <span className={'chip ' + (emp.statusKind === 'on' ? 'brand' : emp.statusKind === 'warn' ? 'warn' : 'outline')} style={{ marginLeft: 'auto' }}>
              <span className={'dot st-' + emp.statusKind} /> {emp.statusText}
            </span>
          </div>
          <div className="card-b">
            <div className="item"><span>岗位</span><span className="v">{emp.roleCn}岗</span></div>
            <div className="item"><span>脱敏名</span><span className="v mono">···{emp.nameSuffix || '——'}</span></div>
            <div className="item"><span>name hash</span><span className="v mono">{emp.nameHash.slice(0, 12)}</span></div>
            <div className="item"><span>职责摘要</span><span className="v">{emp.respLen} 字 · hash {emp.respHash.slice(0, 10)}</span></div>
            <div className="item"><span>负责微信</span><span className="v">{emp.instances.length}</span></div>
            <div className="item"><span>负责客户</span><span className="v">{emp.customers.length}</span></div>
            <div className="item"><span>运行</span><span className="v">{emp.totalRuns}</span></div>
            <div className="item"><span>待确认</span><span className={'v' + (emp.tasksWaiting ? ' warn' : '')}>{emp.tasksWaiting}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><span className="title">AI 行为边界</span></div>
          <div className="card-b">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{roleBoundary(emp.roleCn)}</p>
            <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
              原始职责与姓名不在后台展示，仅保留长度与指纹（{emp.respLen} 字 · hash {emp.respHash.slice(0, 12)}）。
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="title">权限策略</span>
            <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>审批 {emp.approvalCount} · 记忆 {emp.memoryCount} · 操作 {emp.permCount}</span>
          </div>
          <div className="card-b col" style={{ gap: 12 }}>
            <ChipField title="审批策略" keys={emp.approvalKeys} empty="继承默认：敏感动作需人工确认" />
            <ChipField title="记忆策略" keys={emp.memoryKeys} empty="继承默认记忆策略" />
            <ChipField title="操作权限" keys={emp.permKeys} empty="未授予额外操作权限" />
          </div>
        </div>
      </div>

      {/* 右：人格 / 自动回复策略 / 负责微信 / 客户 / 知识库 / 运行 */}
      <div className="col" style={{ gap: 16 }}>
        {/* 人格配置 + 自动回复策略（PR5：可编辑） */}
        <PersonaPolicyEditor emp={emp} demo={demo} />

        {/* 负责微信 */}
        <div className="card">
          <div className="card-h">
            <span className="title">负责微信</span>
            <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{emp.instances.length} 个实例</span>
          </div>
          <div className="card-b">
            {emp.instances.length === 0 ? (
              <div className="dim">尚未绑定任何可见微信实例。</div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {emp.instances.map((ins) => {
                  const scopes = Object.entries(ins.bindingScopes).map(([k, v]) => `${keyLabel(k)}:${v}`).join(' / ');
                  const inner = (
                    <>
                      <span style={{ flexShrink: 0 }}>
                        {ins.woc ? (
                          <InstanceIcon icon={ins.woc.icon} appType={ins.woc.appType} size={36} radius={10} />
                        ) : (
                          <span className="avatar accent">···{ins.suffix}</span>
                        )}
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{ins.name}</div>
                        <div className="dim" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {ins.statusCls && <span className={'dot ' + ins.statusCls} />} {ins.statusText} · {ins.appLabel}
                        </div>
                        <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                          任务 {ins.tasks} · 运行 {ins.runs}
                          {ins.permissionCount > 0 && <> · 权限 {ins.permissionCount}</>}
                          {scopes && <> · 范围 {scopes}</>}
                        </div>
                      </div>
                      {ins.woc && <span className="dim">›</span>}
                    </>
                  );
                  return ins.woc ? (
                    <button
                      key={ins.key}
                      className="row"
                      style={{ width: '100%', textAlign: 'left', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 12, padding: 10, cursor: 'pointer' }}
                      onClick={() => onOpenInstance(ins.woc!.id)}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div key={ins.key} className="row" style={{ background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 12, padding: 10 }}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 负责客户 */}
        <div className="card">
          <div className="card-h">
            <span className="title">负责客户</span>
            <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{emp.customers.length} 位</span>
            {emp.customers.length > 0 && (
              <button className="btn ghost sm" onClick={() => onGotoTab('customers')}>全部客户画像 ›</button>
            )}
          </div>
          <div className="card-b">
            {emp.customers.length === 0 ? (
              <div className="dim">暂无沉淀的客户画像。</div>
            ) : (
              <div className="grid-3" style={{ marginTop: 0 }}>
                {emp.customers.slice(0, 6).map((cu) => (
                  <CustomerCard key={cu.key} cu={cu} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 知识库范围 */}
        <div className="card">
          <div className="card-h">
            <span className="title">知识库范围（共享）</span>
            <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{knowledge.docCount} 文档 · {knowledge.chunkCount} 切片</span>
            <button className="btn ghost sm" onClick={() => onGotoTab('knowledge')}>管理知识库 ›</button>
          </div>
          <div className="card-b">
            {knowledge.docs.length === 0 ? (
              <div className="dim">暂无知识库。可在「知识库」tab 导入 Markdown。</div>
            ) : (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {knowledge.docs.slice(0, 6).map((d) => (
                  <span key={d.key} className="chip outline">{d.label} · {d.chunks} 切片</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 运行记录 */}
        <div className="card">
          <div className="card-h">
            <span className="title">运行记录</span>
            <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>最近 {emp.runs.length}</span>
            {emp.runs.length > 0 && (
              <button className="btn ghost sm" onClick={() => onGotoTab('runs')}>全部运行记录 ›</button>
            )}
          </div>
          <div className="card-b">
            {emp.runs.length === 0 ? (
              <div className="dim">暂无运行记录。</div>
            ) : (
              <div className="timeline">
                {emp.runs.slice(0, 6).map((r) => (
                  <div key={r.key} className="ti">
                    <div className="d"><div className="dotline" /><div className={'p ' + r.status.cls} /></div>
                    <div className="body">
                      <div className="w">{r.act} <span className="dim">@{r.instName}</span></div>
                      <div className="t">
                        <span className={'dot ' + r.status.cls} /> {r.status.t}
                        {r.summary && <span>· {r.summary}</span>}
                        {r.ago && <span>· {r.ago}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {demo && (
          <div className="safe-note">
            以上为演示数据（deterministic 占位）。接入真实数据源后，此处为该 AI 员工的真实身份 / 权限 / 客户 / 运行。
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 人格配置 + 自动回复策略（PR5） ====================
type Notice = { tone: 'ok' | 'warn' | 'err'; text: string } | null;

function unavailableText(reason: string): string {
  if (reason === 'not_configured' || reason === 'backend_command_missing')
    return '后端自动回复能力尚未部署，策略未真正保存生效（未假装成功）。你填写的草稿已在本地保留，待后端就绪后再次保存即可下发。';
  if (reason === 'invalid_request') return '请求参数无效，请检查后重试。';
  return '后端暂不可用，未生效。';
}

function PersonaPolicyEditor({ emp, demo }: { emp: EmployeeVM; demo: boolean }) {
  // 真实模式下 emp.key = String(employee_id)；演示模式没有真实 id，写操作 disabled 并提示。
  const employeeId = demo ? null : Number.isFinite(Number(emp.key)) ? Number(emp.key) : null;

  const [persona, setPersona] = useState<AiPersonaDraft>({
    displayName: emp.displayName,
    serviceDomain: '',
    post: 'pre_sale',
    tones: [],
    goals: '',
    forbidden: '',
  });
  const [ar, setAr] = useState<AiAutoReplyDraft>({
    mode: 'disabled',
    scope: 'current_instance',
    rateLimitSeconds: 60,
    rateLimitCount: 1,
    guardrails: GUARDRAILS.map((g) => g.key),
  });
  const [sample, setSample] = useState('');
  const [testResult, setTestResult] = useState<{ decision: string; risk: string; matched: string[]; summary: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'template' | 'test'>('');
  const [notice, setNotice] = useState<Notice>(null);

  const enabled = ar.mode !== 'disabled';
  const autoSend = ar.mode === 'auto_send_test';

  const setPost = (post: string) => setPersona((p) => ({ ...p, post }));
  const toggleTone = (key: string) =>
    setPersona((p) => ({ ...p, tones: p.tones.includes(key) ? p.tones.filter((t) => t !== key) : [...p.tones, key] }));
  const toggleGuardrail = (key: string) =>
    setAr((a) => ({ ...a, guardrails: a.guardrails.includes(key) ? a.guardrails.filter((g) => g !== key) : [...a.guardrails, key] }));
  const toggleEnabled = () => setAr((a) => ({ ...a, mode: a.mode === 'disabled' ? 'suggest_only' : 'disabled' }));
  const setMode = (mode: string) => setAr((a) => ({ ...a, mode }));

  const applyTemplate = async () => {
    // 先本地填充模板（无论后端是否就绪，用户都能看到 / 编辑），再尝试下发到后端。
    setPersona(GAME_BOOST_PERSONA);
    setAr(GAME_BOOST_POLICY);
    setTestResult(null);
    if (employeeId == null) {
      setNotice({ tone: 'warn', text: '已按「游戏代练客服模板」填充表单。演示模式无法下发到后端，接入真实数据源后可保存生效。' });
      return;
    }
    setBusy('template');
    setNotice(null);
    try {
      const r = await api.applyAiEmployeeTemplate(employeeId, 'game_boost_support');
      if (r.ok) setNotice({ tone: 'ok', text: `已应用游戏代练客服模板并下发到后端（persona ${r.persona_hash.slice(0, 8) || '—'}）。` });
      else setNotice({ tone: 'warn', text: '已在本地按模板填充表单。' + unavailableText(r.reason) });
    } catch (e: any) {
      setNotice({ tone: 'err', text: e?.message || '应用模板失败' });
    } finally {
      setBusy('');
    }
  };

  const savePolicy = async () => {
    if (employeeId == null) {
      setNotice({ tone: 'warn', text: '演示模式无法保存到后端。接入真实 AI 员工数据源后，此处保存会下发人格与自动回复策略。' });
      return;
    }
    setBusy('save');
    setNotice(null);
    try {
      const r = await api.saveAiEmployeePolicy(employeeId, persona, ar);
      if (r.ok)
        setNotice({
          tone: 'ok',
          text: `策略已保存并下发。自动回复：${AUTO_MODE_LABELS[r.auto_reply_mode] ?? r.auto_reply_mode} · 限频 ${r.rate_limit_seconds}s · 人审触发 ${r.guardrail_keys.length} 项。`,
        });
      else setNotice({ tone: 'warn', text: unavailableText(r.reason) });
    } catch (e: any) {
      setNotice({ tone: 'err', text: e?.message || '保存失败' });
    } finally {
      setBusy('');
    }
  };

  const runTest = async () => {
    if (employeeId == null || !sample.trim()) return;
    setBusy('test');
    setNotice(null);
    setTestResult(null);
    try {
      const r = await api.runAiEmployeeAutoReplyTest(employeeId, sample.trim());
      if (r.ok) setTestResult({ decision: r.decision, risk: r.risk_level, matched: r.matched_guardrails, summary: r.redacted_summary });
      else setNotice({ tone: 'warn', text: unavailableText(r.reason) });
    } catch (e: any) {
      setNotice({ tone: 'err', text: e?.message || '试运行失败' });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      {/* 1. 人格配置 + 自动回复策略：模板 prompt-grid 两栏 */}
      <div className="card">
        <div className="card-h">
          <span className="title">人格配置与自动回复策略</span>
          <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <span className="chip">模板草稿 · 不回显明文</span>
            <button className="btn sm" disabled={busy !== ''} onClick={applyTemplate}>
              {busy === 'template' ? '应用中…' : '应用游戏代练客服模板'}
            </button>
          </div>
        </div>
        <div className="card-b">
          <div className="safe-note">
            当前后端仅下发人格指纹（name ···{emp.nameSuffix || '——'} · hash {emp.nameHash.slice(0, 8)} · 职责 {emp.respLen} 字），
            <b> 不回显明文人格 / 原始职责 / 聊天正文</b>。以下为模板化草稿，可基于模板填充并提交到 API 下发（提交 allowlist 键 + 模板文本）。
          </div>

          <div className="prompt-grid" style={{ marginTop: 12 }}>
            {/* 人设草稿 */}
            <div className="prompt-pane">
              <div className="ph"><span className="title">人设草稿</span></div>
              <div className="body col" style={{ gap: 12 }}>
                <label className="form-field">
                  <span>显示名 / 客服名</span>
                  <input className="input" value={persona.displayName} maxLength={60}
                    onChange={(e) => setPersona((p) => ({ ...p, displayName: e.target.value }))} placeholder="如：代练客服小助手" />
                </label>
                <label className="form-field">
                  <span>业务域</span>
                  <input className="input" value={persona.serviceDomain} maxLength={60}
                    onChange={(e) => setPersona((p) => ({ ...p, serviceDomain: e.target.value }))} placeholder="如：游戏代练客服" />
                </label>
                <div className="form-field">
                  <span>岗位</span>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {PERSONA_POSTS.map((p) => (
                      <button key={p.key} className={'chip' + (persona.post === p.key ? ' brand' : ' outline')} onClick={() => setPost(p.key)}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-field">
                  <span>语气</span>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {PERSONA_TONES.map((t) => (
                      <button key={t.key} className={'chip' + (persona.tones.includes(t.key) ? ' brand' : ' outline')} onClick={() => toggleTone(t.key)}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="form-field">
                  <span>目标（引导收集的信息）</span>
                  <textarea className="textarea" value={persona.goals} maxLength={2000}
                    onChange={(e) => setPersona((p) => ({ ...p, goals: e.target.value }))}
                    placeholder="如：收集游戏 / 区服 / 段位 / 目标段位 / 预算 / 时限，并沉淀客户画像" />
                </label>
                <label className="form-field">
                  <span>禁止承诺 / 红线</span>
                  <textarea className="textarea" value={persona.forbidden} maxLength={2000}
                    onChange={(e) => setPersona((p) => ({ ...p, forbidden: e.target.value }))}
                    placeholder="如：不承诺 100% 不封号；不提供违规外挂；不诱导索取账号 / 支付密码 / 验证码" />
                </label>
              </div>
            </div>

            {/* 自动回复策略草稿 */}
            <div className="prompt-pane">
              <div className="ph">
                <span className="title">自动回复策略</span>
                <span className={'chip ' + (ar.mode === 'disabled' ? 'outline' : autoSend ? 'warn' : 'brand')} style={{ marginLeft: 'auto' }}>
                  {AUTO_MODE_LABELS[ar.mode]}
                </span>
              </div>
              <div className="body col" style={{ gap: 14 }}>
                <div className="row" style={{ gap: 10 }}>
                  <label className="switch">
                    <input type="checkbox" checked={enabled} onChange={toggleEnabled} aria-label="自动回复测试模式" />
                    <span />
                  </label>
                  <div>
                    <div style={{ fontWeight: 600 }}>自动回复测试模式</div>
                    <div className="dim" style={{ fontSize: 12 }}>关闭后 AI 只沉淀画像、不生成自动回复；开启后按下方模式处理。</div>
                  </div>
                </div>

                {enabled && (
                  <div className="form-field">
                    <span>模式</span>
                    <div className="col" style={{ gap: 6 }}>
                      <button className={'chip ' + (ar.mode === 'suggest_only' ? 'brand' : 'outline')} style={{ justifyContent: 'flex-start' }} onClick={() => setMode('suggest_only')}>
                        <span className={'dot ' + (ar.mode === 'suggest_only' ? 'st-on' : 'st-off')} /> 只生成建议 · 进待确认队列，人工确认后才发送（推荐）
                      </button>
                      <button className={'chip ' + (autoSend ? 'warn' : 'outline')} style={{ justifyContent: 'flex-start' }} onClick={() => setMode('auto_send_test')}>
                        <span className={'dot ' + (autoSend ? 'st-warn' : 'st-off')} /> 测试自动发送 · 仅低风险咨询自动发送，命中人审触发词仍转人工
                      </button>
                    </div>
                  </div>
                )}

                {autoSend && (
                  <div className="safe-note" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)', borderColor: 'transparent' }}>
                    <b>⚠️ 测试自动发送已开启 · 请谨慎</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      <li>仅对<b>测试实例 / 白名单会话 / 低风险咨询</b>自动发送，高风险一律转人工确认。</li>
                      <li>付款 / 退款 / 封号 / 外挂 / 外部链接 / 大额订单 / 投诉等命中人审触发词的消息进入待确认队列。</li>
                      <li>所有自动 / 人工动作都会写入 audit 审计；真实发送由后端二次 gating，前端不直接触发微信动作。</li>
                      <li>后端未就绪时不会真正开启，本页只保存策略草稿、不假装生效。</li>
                    </ul>
                  </div>
                )}

                {enabled && (
                  <>
                    <div className="form-field">
                      <span>生效范围</span>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {SCOPE_OPTIONS.map((s) => (
                          <button key={s.key} className={'chip' + (ar.scope === s.key ? ' brand' : ' outline')} title={s.hint}
                            onClick={() => setAr((a) => ({ ...a, scope: s.key }))}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <span className="dim" style={{ fontSize: 11 }}>{SCOPE_OPTIONS.find((s) => s.key === ar.scope)?.hint}</span>
                    </div>

                    <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                      <label className="form-field grow">
                        <span>频率 · 时间窗（秒）</span>
                        <input className="input" type="number" min={0} max={3600} value={ar.rateLimitSeconds}
                          onChange={(e) => setAr((a) => ({ ...a, rateLimitSeconds: Math.max(0, Math.min(3600, Math.floor(Number(e.target.value) || 0))) }))} />
                      </label>
                      <label className="form-field grow">
                        <span>频率 · 最多条数</span>
                        <input className="input" type="number" min={1} max={100} value={ar.rateLimitCount}
                          onChange={(e) => setAr((a) => ({ ...a, rateLimitCount: Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))) }))} />
                      </label>
                    </div>
                    <span className="dim" style={{ fontSize: 11 }}>每客户每 {ar.rateLimitSeconds} 秒最多自动发送 {ar.rateLimitCount} 条。</span>
                  </>
                )}

                <div className="form-field">
                  <span>强制人审触发（命中即转人工确认）</span>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {GUARDRAILS.map((g) => (
                      <button key={g.key} className={'chip' + (ar.guardrails.includes(g.key) ? ' danger' : ' outline')} onClick={() => toggleGuardrail(g.key)}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="safe-note">
                  <b>安全说明</b>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    <li>自动发送只对低风险咨询生效；付款 / 退款 / 封号 / 外挂 / 链接等进入待确认。</li>
                    <li>所有动作写入 audit 审计；真实发送由后端 gating，本页不直接触发真实微信动作。</li>
                    <li>无真实后端能力时不假装开启成功，仅保存本地策略草稿。</li>
                  </ul>
                </div>

                <label className="form-field">
                  <span>试运行判断（输入一条示例咨询，看会自动发送还是转人工）</span>
                  <textarea className="textarea" value={sample} maxLength={500}
                    onChange={(e) => setSample(e.target.value)}
                    placeholder="如：王者荣耀想从黄金上到钻石，大概多少钱多久？" />
                </label>
                {testResult && (
                  <div className="safe-note">
                    <div className="row" style={{ gap: 6 }}>
                      <span className={'dot ' + (TEST_DECISION_LABELS[testResult.decision]?.cls ?? 'st-warn')} />
                      <b>{TEST_DECISION_LABELS[testResult.decision]?.t ?? testResult.decision}</b>
                      <span className="dim">· 风险 {RISK_LABEL[riskOf(testResult.risk)]}</span>
                      {testResult.matched.length > 0 && (
                        <span className="dim">· 命中人审：{testResult.matched.map((k) => GUARDRAILS.find((g) => g.key === k)?.label ?? k).join(' / ')}</span>
                      )}
                    </div>
                    {testResult.summary && <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>{testResult.summary}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {notice && (
            <div className={'src-note ' + (notice.tone === 'ok' ? 'real' : 'demo')} style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="d" /> {notice.text}
            </div>
          )}

          <div className="row" style={{ marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
            <button className="btn primary" disabled={busy !== ''} onClick={savePolicy}>
              {busy === 'save' ? '保存中…' : '保存策略'}
            </button>
            <button className="btn" disabled={busy !== ''} onClick={applyTemplate}>
              {busy === 'template' ? '应用中…' : '应用游戏代练客服模板'}
            </button>
            <button className="btn" disabled={busy !== '' || employeeId == null || !sample.trim()} onClick={runTest}
              title={employeeId == null ? '接入真实数据源后可试运行' : ''}>
              {busy === 'test' ? '判断中…' : '试运行判断'}
            </button>
            {employeeId == null && <span className="dim" style={{ fontSize: 12 }}>演示模式：接入真实 AI 员工数据源后可保存 / 试运行</span>}
          </div>
        </div>
      </div>
    </>
  );
}

function ChipField({ title, keys, empty }: { title: string; keys: string[]; empty: string }) {
  return (
    <div className="form-field">
      <span>{title}</span>
      {keys.length === 0 ? (
        <div className="dim" style={{ fontSize: 12 }}>{empty}</div>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {keys.map((k) => (
            <span key={k} className="chip outline">{keyLabel(k)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const custAvatar: Record<Risk, string> = { high: 'warn', medium: 'accent', low: 'brand' };

function CustomerCard({ cu }: { cu: CustomerVM }) {
  return (
    <div className="card">
      <div className="card-b tight">
        <div className="row">
          <span className={'avatar ' + custAvatar[cu.risk]}>{cu.code.slice(0, 2)}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>客户 {cu.code}</div>
            <div className="dim mono" style={{ fontSize: 11 }}>@{cu.instName} · {cu.ago || '—'}</div>
          </div>
          <span className={'dot ' + riskDotCls(cu.risk)} title={RISK_LABEL[cu.risk]} />
        </div>
        <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
          <span className="chip outline">{stageLabel(cu.stage)}</span>
          <span className="dim" style={{ fontSize: 12 }}>意向 {cu.intent ?? '—'} · 消息 {cu.messages} · 记忆 {cu.memActive}/{cu.memCandidate}</span>
        </div>
      </div>
    </div>
  );
}

// ==================== 客户画像 ====================
function CustomerBoard({ customers, demo }: { customers: CustomerVM[]; demo: boolean }) {
  const nav = useNavigate();
  const [risk, setRisk] = useState<'all' | Risk>('all');
  const filtered = risk === 'all' ? customers : customers.filter((c) => c.risk === risk);
  const sorted = filtered.slice().sort((a, b) => (b.intent ?? 0) - (a.intent ?? 0));
  if (customers.length === 0)
    return (
      <>
        <div className="safe-note row" style={{ justifyContent: 'space-between' }}>
          <span>需要按客户维度筛选 / 查看画像与 AI 建议？</span>
          <button className="btn sm" onClick={() => nav('/customers')}>打开客户 CRM ›</button>
        </div>
        <div className="empty-state">
          <div className="empty-blob">👤</div>
          <div className="empty-title">暂无客户画像</div>
          <div className="empty-sub">请先启动 OCR 历史补全并运行记忆 / 画像抽取。</div>
        </div>
      </>
    );
  const counts = {
    high: customers.filter((c) => c.risk === 'high').length,
    medium: customers.filter((c) => c.risk === 'medium').length,
  };
  return (
    <>
      <div className="safe-note row" style={{ justifyContent: 'space-between' }}>
        <span>需要按客户维度管理、看 AI 跟进建议与所属微信？</span>
        <button className="btn sm" onClick={() => nav('/customers')}>打开客户 CRM ›</button>
      </div>
      <div className="safe-note">
        客户画像来自 OCR 入库消息 + 记忆 / 画像抽取。只展示 hash、阶段、意向、风险与记忆计数，不显示聊天正文。
        {demo && ' 当前为演示数据。'}
      </div>
      <div className="tabs" style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-elev)', marginBottom: 14 }}>
        {(['all', 'high', 'medium', 'low'] as const).map((r) => (
          <button key={r} className={'tab' + (risk === r ? ' active' : '')} onClick={() => setRisk(r)}>
            {r === 'all' ? '全部' : RISK_LABEL[r]}
            {r === 'high' && counts.high > 0 && <span className="num">{counts.high}</span>}
            {r === 'medium' && counts.medium > 0 && <span className="num">{counts.medium}</span>}
          </button>
        ))}
      </div>
      <div className="grid-3" style={{ marginTop: 0 }}>
        {sorted.map((cu) => (
          <CustomerCard key={cu.key} cu={cu} />
        ))}
      </div>
    </>
  );
}

// ==================== 知识库 ====================
function KnowledgePanel({
  real,
  knowledge,
  onImported,
}: {
  real: AiConsolePayload | null;
  knowledge: KnowledgeVM;
  onImported: () => void;
}) {
  const [title, setTitle] = useState('销售知识库');
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiKnowledgeImportResponse | null>(null);
  const [err, setErr] = useState('');
  const canImport = !!real;
  const submit = async () => {
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const res = await api.importAiEmployeeKnowledge(title, markdown);
      setResult(res);
      setMarkdown('');
      onImported();
    } catch (e: any) {
      setErr(e?.message || '导入失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="card">
        <div className="card-h"><span className="title">导入知识库</span></div>
        <div className="card-b col" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            上传 Markdown 到 AI 员工知识库，服务端写入私有目录并重建检索切片。后台只显示 hash / 计数，不展示正文与原始标题。
            {!canImport && ' 当前未接入真实数据源，导入功能在配置数据源后可用。'}
          </p>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文档标题" />
          <textarea
            className="textarea"
            style={{ minHeight: 160 }}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={'# 退换货政策\n\n把商家话术 / 商品知识粘贴到这里'}
          />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy || !markdown.trim() || !canImport} onClick={submit}>
              {busy ? '导入中…' : '导入 Markdown'}
            </button>
            {result && <span className="dim" style={{ fontSize: 12 }}>已导入 {result.document_count} 文档 / {result.chunk_count} 切片</span>}
          </div>
          {err && <div className="src-note demo"><span className="d" /> {err}</div>}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginTop: 16, gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="label">知识文档</div>
          <div className="value">{knowledge.docCount}</div>
        </div>
        <div className="kpi">
          <div className="label">检索切片</div>
          <div className="value">{knowledge.chunkCount}</div>
        </div>
        <div className="kpi">
          <div className="label">启用 / 停用</div>
          <div className="value">{knowledge.enabledCount ?? knowledge.docCount}/{knowledge.disabledCount ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="label">知识分组</div>
          <div className="value">{knowledge.groupCount ?? knowledge.groups.length}</div>
        </div>
      </div>

      {knowledge.groups.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-h"><span className="title">知识分组</span><span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>只显示 group key 与计数</span></div>
          <div className="card-b row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {knowledge.groups.map((g) => (
              <span key={g.key} className="chip outline">{g.key} · {g.docs} 文档 / {g.chunks} 切片</span>
            ))}
          </div>
        </div>
      )}

      {knowledge.docs.length === 0 ? (
        <div className="safe-note" style={{ marginTop: 16 }}>暂无知识库。可在上方粘贴 Markdown 导入。</div>
      ) : (
        <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
          <table className="t">
            <thead>
              <tr>
                <th>文档</th>
                <th>切片</th>
                <th>状态</th>
                <th>分组 / 版本</th>
                <th>内容 hash</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {knowledge.docs.map((d) => (
                <tr key={d.key}>
                  <td>
                    <b>{d.label}</b>
                    <div className="dim mono" style={{ fontSize: 11 }}>title hash · {d.titleHash}</div>
                  </td>
                  <td>{d.chunks}</td>
                  <td>
                    <span className={'dot ' + (d.enabled === false ? 'st-off' : d.status === '待切片' ? 'st-warn' : 'st-on')} /> {d.status}
                  </td>
                  <td>
                    <span className="chip outline">{d.groupKey || 'default'}</span>
                    {d.version != null && <span className="dim" style={{ marginLeft: 6 }}>v{d.version}</span>}
                    {d.sourceSuffix && <span className="dim" style={{ marginLeft: 6 }}>{d.sourceSuffix}</span>}
                  </td>
                  <td className="mono">{(d.contentHash || d.titleHash).slice(0, 12)}</td>
                  <td className="dim">{d.ago}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ==================== 待确认 ====================
function PendingBoard({ pending, demo }: { pending: PendingVM; demo: boolean }) {
  const nav = useNavigate();
  return (
    <>
      <div className="safe-note row" style={{ justifyContent: 'space-between' }}>
        <span>需要按风险 / 类型分流处理待确认动作队列？</span>
        <button className="btn sm" onClick={() => nav('/approvals')}>打开待确认中心 ›</button>
      </div>
      <div className="src-note demo">
        <span className="d" /> 以下为等待人工确认 / 计划中的动作汇总{demo ? '（演示）' : '（真实计数）'}。本页只读，不触发任何真实微信动作，按钮均不可用。
      </div>
      <div className="kpi-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, pending.rows.length)}, minmax(0,1fr))` }}>
        {pending.rows.map((r) => (
          <div key={r.key} className="kpi">
            <div className="label">{r.label}</div>
            <div className="value">{r.value}</div>
            <div className={'delta' + (r.value ? ' warn' : ' muted')}>{r.value ? '待人工确认' : '无'}</div>
          </div>
        ))}
      </div>
      {pending.drafts.length > 0 ? (
        <div className="pending-list" style={{ marginTop: 16 }}>
          {pending.drafts.map((d) => (
            <div key={d.key} className="pending-card">
              <div>
                <div className="h">
                  <span className="mono">{d.taskLabel}</span>
                  <span className="dim">· @{d.instName}</span>
                </div>
                <div className="body">{d.redacted}</div>
              </div>
              <div className="acts">
                <button className="btn primary sm" disabled title="后续接人审 API；当前不触发真实微信动作">通过并发送</button>
                <button className="btn sm" disabled title="后续接人审 API；当前不触发真实微信动作">编辑后通过</button>
                <button className="btn danger sm" disabled title="后续接人审 API；当前不触发真实微信动作">驳回</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="safe-note" style={{ marginTop: 16 }}>当前没有等待确认的动作 🎉</div>
      )}
    </>
  );
}

// ==================== 运行记录 ====================
function RunLog({ runs, demo }: { runs: RunVM[]; demo: boolean }) {
  if (runs.length === 0) return <div className="safe-note">暂无运行记录。</div>;
  return (
    <div className="card">
      <div className="card-h"><span className="title">运行记录 · 时间线</span><span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>只读脱敏摘要{demo ? ' · 演示' : ''}</span></div>
      <div className="card-b">
        <div className="timeline">
          {runs.map((r) => (
            <div key={r.key} className="ti">
              <div className="d"><div className="dotline" /><div className={'p ' + r.status.cls} /></div>
              <div className="body">
                <div className="w"><b>{r.emp}</b> {r.act} <span className="dim">@{r.instName}</span></div>
                <div className="t">
                  <span className={'dot ' + r.status.cls} /> {r.status.t}
                  {r.summary && <span>· {r.summary}</span>}
                  {r.ago && <span>· {r.ago}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== 工具与工作流 ====================
// 吸收设计稿「工具库 + 工作流画布」信息架构，但全部由 WOC 安全字段派生：
//   - 工具库 = AI 员工能力 allowlist 键（与权限 / 审批策略键一致），启用态由可见员工的
//     permission/memory/approval keys 派生；「配置」为占位（后端写路径接入后启用）。
//   - 工作流 = 消息接入 → 意图路由 → 检索知识库 → 起草回复 → 行为边界检查 → 待确认 / 自动发送，
//     各节点计数来自安全的 knowledge/guardrail/pending，不含任何聊天正文 / 回复原文 / token。
type ToolRisk = 'low' | 'medium' | 'high';
interface ToolDef {
  key: string;
  label: string;
  desc: string;
  risk: ToolRisk;
}
const TOOL_DEFS: ToolDef[] = [
  { key: 'knowledge_read', label: '检索知识库', desc: '按客户问题检索已切片的商品 / 售后 / 话术知识，作为回复依据。', risk: 'low' },
  { key: 'reply', label: '起草回复', desc: '为客户消息生成回复草稿，正文脱敏进入待确认队列。', risk: 'low' },
  { key: 'memory_write', label: '写入记忆', desc: '把客户偏好 / 关键事实沉淀为长期记忆，供后续跟进复用。', risk: 'low' },
  { key: 'profile_update', label: '更新画像', desc: '刷新客户阶段 / 意向 / 风险标签，只写安全字段。', risk: 'low' },
  { key: 'contact_remark', label: '修改备注', desc: '按画像更新联系人备注标签，需人工确认后执行。', risk: 'medium' },
  { key: 'auto_reply', label: '自动回复', desc: '对低风险咨询自动发送，命中人审触发词转人工。', risk: 'medium' },
  { key: 'send_message', label: '主动发送', desc: '向客户主动外发消息 / 卡片 / 文件，属敏感外发动作。', risk: 'high' },
  { key: 'group_operation', label: '群操作', desc: '群公告 / 成员变更等影响面大的操作，需人工确认。', risk: 'high' },
];
const TOOL_RISK_LABEL: Record<ToolRisk, string> = { low: '低风险', medium: '需确认', high: '高风险' };
const toolRiskCls = (r: ToolRisk): string => (r === 'high' ? 'st-off' : r === 'medium' ? 'st-warn' : 'st-on');

function ToolsPanel({ vm, demo }: { vm: CenterVM; demo: boolean }) {
  // 可见员工授予过的能力键集合（权限 / 记忆 / 审批），据此判断工具是否已在某个员工上启用。
  const enabledKeys = new Set<string>();
  const approvalKeys = new Set<string>();
  for (const e of vm.employees) {
    e.permKeys.forEach((k) => enabledKeys.add(k));
    e.memoryKeys.forEach((k) => enabledKeys.add(k));
    e.approvalKeys.forEach((k) => approvalKeys.add(k));
  }
  const activeCount = TOOL_DEFS.filter((t) => enabledKeys.has(t.key)).length;

  // 工作流节点计数（安全派生）。
  const kbDocs = vm.knowledge.docCount;
  const guardCount = GUARDRAILS.length;
  const pendingTotal = vm.pending.total;
  const steps: { key: string; kind: string; title: string; detail: string }[] = [
    { key: 'ingest', kind: 'trigger', title: '接入客户消息', detail: 'OCR / 消息入库 · wechat.message.created' },
    { key: 'route', kind: 'llm', title: '意图识别与路由', detail: '识别意图 → 分配到售前 / 售后 / 复购 / 群运营岗位' },
    { key: 'kb', kind: 'tool', title: '检索知识库', detail: `knowledge_read · ${kbDocs} 文档命中作为回复依据` },
    { key: 'draft', kind: 'llm', title: '起草回复', detail: '按人格与知识库生成回复草稿（正文脱敏）' },
    { key: 'boundary', kind: 'cond', title: '行为边界检查', detail: `命中 ${guardCount} 类人审触发词 → 强制转人工确认` },
    { key: 'approve', kind: 'approve', title: '待确认 / 自动发送', detail: pendingTotal ? `${pendingTotal} 个动作待人工确认后落地` : '敏感动作进待确认队列，人工确认后执行' },
  ];

  const riskChipCls: Record<ToolRisk, string> = { low: 'brand', medium: 'warn', high: 'danger' };
  return (
    <>
      <div className="safe-note">
        工具库与工作流展示 AI 员工在授权微信实例内可调用的能力与处理链路。全部由安全字段派生（能力键 / 计数），
        不含聊天正文 / 回复原文 / token。「配置」为占位，后端写路径接入后启用。
        {demo && ' 当前为演示数据。'}
      </div>

      <div className="card">
        <div className="card-h">
          <span className="title">工具库</span>
          <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{activeCount} / {TOOL_DEFS.length} 已在员工上启用</span>
        </div>
        <div className="card-b">
          <div className="tool-grid">
            {TOOL_DEFS.map((t) => {
              const on = enabledKeys.has(t.key);
              const needApproval = t.risk !== 'low' || approvalKeys.has(t.key);
              return (
                <div key={t.key} className="tool-card" style={on ? undefined : { opacity: 0.7 }}>
                  <div className="row1">
                    <span className="name">wechat.{t.key}</span>
                    <span className={'chip ' + riskChipCls[t.risk]}>{TOOL_RISK_LABEL[t.risk]}</span>
                  </div>
                  <p className="desc">{t.desc}</p>
                  <div className="row1">
                    <span className="row" style={{ gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                      <span className={'dot ' + (on ? 'st-on' : 'st-off')} />
                      {on ? '已启用' : '未授权'}
                      {needApproval && <span className="chip warn" style={{ fontSize: 10, padding: '1px 6px' }}>需人工确认</span>}
                    </span>
                    <button className="btn ghost sm" disabled title="工具配置写路径后端接入后启用">配置</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <span className="title">处理工作流</span>
          <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>消息接入 → 路由 → 知识库 → 起草 → 边界 → 待确认</span>
        </div>
        <div className="card-b">
          <div className="timeline">
            {steps.map((s, i) => {
              const cls = s.kind === 'cond' ? 'warn' : s.kind === 'approve' ? 'danger' : s.kind === 'tool' ? 'st-busy' : 'brand';
              return (
                <div key={s.key} className="ti">
                  <div className="d"><div className="dotline" /><div className={'p ' + cls} /></div>
                  <div className="body">
                    <div className="w"><b>{i + 1}. {s.title}</b></div>
                    <div className="t">{s.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
            工作流为运行链路的只读示意；真实发送 / 改备注 / 群操作由后端二次 gating，本页不触发任何真实微信动作。
          </div>
        </div>
      </div>
    </>
  );
}

// ==================== 运营设置 ====================
// 吸收设计稿 settings 分组表单，但如实反映 WOC 现状：数据源状态 / 安全合规姿态 / 内置人审触发词
// 为真实只读信息；模型路由 / 预算 / Webhook 等无后端能力的项统一 disabled 占位并标注「后端接入后启用」，
// 绝不假装已生效。实例管理仍走 /admin，不在此新造账号 / 授权。
function SettingsPanel({
  resp,
  real,
  vm,
  instanceCount,
  isAdmin,
}: {
  resp: AiEmployeeConsoleResponse | null;
  real: boolean;
  vm: CenterVM;
  instanceCount: number;
  isAdmin: boolean;
}) {
  const nav = useNavigate();
  const demoReason =
    resp && resp.mode === 'demo_fallback'
      ? resp.reason === 'cannot_enforce_instance_filter'
        ? '无法按实例过滤，已对子账号回退'
        : resp.reason === 'unavailable'
          ? '数据源子进程不可用，已回退'
          : '尚未配置数据源'
      : '';
  return (
    <>
      <div className="safe-note">
        运营设置展示 AI 员工数据源与安全策略现状。实例 / 账号 / 授权仍在
        <button className="btn ghost sm" style={{ margin: '0 4px', height: 22 }} onClick={() => nav('/admin')}>系统设置</button>
        管理，本页不新造租户或授权。
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* 数据源与运行 */}
        <div className="card">
          <div className="card-h"><span className="title">数据源与运行</span></div>
          <div className="card-b">
            <div className="item"><span>接入状态</span><span className="v"><span className={'dot ' + (real ? 'st-on' : 'st-warn')} /> {real ? '已接入真实数据（只读代理）' : '演示回退'}</span></div>
            <div className="item"><span>数据来源</span><span className="v mono">ai-wechat-employee · management_api_v1</span></div>
            <div className="item"><span>可见实例</span><span className="v">{instanceCount} 个（AI 员工可操作范围）</span></div>
            <div className="item"><span>在岗员工</span><span className="v">{vm.employees.filter((e) => e.statusKind === 'on').length} / {vm.employees.length}</span></div>
            {!real && demoReason && <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>当前：{demoReason}。字段 allowlist 与按实例过滤在数据源就绪后自动启用。</div>}
          </div>
        </div>

        {/* 安全与合规 */}
        <div className="card">
          <div className="card-h"><span className="title">安全与合规</span></div>
          <div className="card-b">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
              <li><b>只读代理 + 字段 allowlist：</b>后台只展示 hash / suffix / 计数 / 状态 / 脱敏摘要。</li>
              <li><b>按可见实例过滤（RBAC）：</b>子账号只看被授权实例，管理员看全部。</li>
              <li><b>高风险动作人工确认：</b>发送 / 改备注 / 群操作进待确认队列，人工确认后才落地。</li>
              <li><b>不外泄敏感原文：</b>不展示聊天正文 / 回复原文 / token / 绑定串明文（二维码除外）。</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 内置人审触发词（只读 allowlist） */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <span className="title">内置强制人审触发词</span>
          <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>命中即转人工确认 · 可在员工「自动回复策略」中按需调整</span>
        </div>
        <div className="card-b">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {GUARDRAILS.map((g) => (
              <span key={g.key} className="chip danger">{g.label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 高级设置：无后端能力，占位不假成功 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <span className="title">高级设置</span>
          <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>后端接入后启用 · 当前仅展示占位，不影响真实运行</span>
        </div>
        <div className="card-b col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <label className="form-field grow">
              <span>主模型路由</span>
              <select className="select" disabled defaultValue="">
                <option value="">后端接入后配置</option>
              </select>
            </label>
            <label className="form-field grow">
              <span>每月预算</span>
              <input className="input" disabled placeholder="后端接入后配置" />
            </label>
          </div>
          <label className="form-field">
            <span>Webhook 推送地址</span>
            <input className="input mono" disabled placeholder="后端接入后配置（https://your.domain/hook）" />
          </label>
          <div className="dim" style={{ fontSize: 11 }}>
            {isAdmin
              ? '这些能力依赖 ai-wechat-employee 的写路径，尚未部署；接入后此处将可保存并下发，届时不再是占位。'
              : '模型路由 / 预算 / Webhook 为管理员配置项，且需后端写路径接入后启用。'}
          </div>
        </div>
      </div>
    </>
  );
}

// ==================== 绑定秘书 ====================
function BindPanel({ real }: { real: AiConsolePayload | null }) {
  const bp = real?.bind_panel ?? null;
  const canBind = !!real;
  const [payload, setPayload] = useState<AiBindPayloadResponse | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const createBind = async () => {
    setBusy(true);
    setErr('');
    setQrUrl('');
    try {
      const r = await api.createAiEmployeeBind();
      setPayload(r);
      // 一次性绑定串仅用于生成二维码，不在页面以文本 / <code> 形式展示。
      setQrUrl(await QRCode.toDataURL(r.bind_payload_text, { margin: 1, width: 196 }));
    } catch (e: any) {
      setErr(e?.message || '生成失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-h"><span className="title">扫码绑定秘书</span></div>
      <div className="card-b">
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          生成一次性绑定 payload，给控制端 / 二维码使用。后端只保存 token hash；原始绑定串只编码进二维码，不以明文展示。
          {!canBind && ' 当前未接入真实数据源，绑定在配置数据源后可用。'}
        </p>
        {bp && bp.channel_count > 0 ? (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="t">
              <thead>
                <tr>
                  <th>通道</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>已绑定 token</th>
                  <th>绑定时间</th>
                </tr>
              </thead>
              <tbody>
                {bp.channels.map((ch) => (
                  <tr key={ch.channel_id}>
                    <td className="mono">#{ch.channel_id}</td>
                    <td>{ch.channel_type}</td>
                    <td>
                      <span className={'dot ' + (ch.bind_status === 'active' ? 'st-on' : ch.bind_status === 'pending' ? 'st-warn' : 'st-off')} />{' '}
                      {ch.bind_status}
                    </td>
                    <td>{ch.has_bind_token ? '是' : '否'}</td>
                    <td className="dim">{ch.bound_at ? timeAgo(ch.bound_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="safe-note">暂无控制通道。</div>
        )}
        <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy || !canBind} onClick={createBind}>
            {busy ? '生成中…' : '生成绑定码'}
          </button>
          <span className="dim" style={{ fontSize: 12 }}>管理员生成；子账号无权生成</span>
        </div>
        {err && <div className="src-note demo" style={{ marginTop: 12, marginBottom: 0 }}><span className="d" /> {err}</div>}
        {payload && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h"><span className="title">一次性绑定二维码</span></div>
            <div className="card-b col" style={{ gap: 10, alignItems: 'flex-start' }}>
              {qrUrl ? (
                <img src={qrUrl} alt="扫码绑定秘书二维码" style={{ width: 196, height: 196, borderRadius: 12, border: '1px solid var(--line)', background: '#fff', padding: 6 }} />
              ) : (
                <div style={{ width: 196, height: 196, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, border: '1px solid var(--line)' }}>生成中</div>
              )}
              <div className="dim" style={{ fontSize: 12 }}>扫码即绑定；原始绑定串只编码进上方二维码，不在页面以明文展示。</div>
              <div className="dim mono" style={{ fontSize: 11 }}>
                channel #{payload.channel_id} · payload hash {payload.bind_payload_hash} · token hash {payload.bind_token_hash}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 空态 ====================
function EmptyBinds({ isAdmin, onManage }: { isAdmin: boolean; onManage: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-blob">🤖</div>
      <div className="empty-title">{isAdmin ? '还没有可绑定的实例' : '暂无被授权实例'}</div>
      <div className="empty-sub">
        {isAdmin
          ? 'AI 员工需要绑定到云微信实例才能工作，先去「管理」新建一个实例。'
          : '请联系管理员为你分配实例，AI 员工的可操作范围即为你被授权的实例。'}
      </div>
      {isAdmin && (
        <div className="empty-action">
          <button className="btn primary" onClick={onManage}>
            去管理页新建实例
          </button>
        </div>
      )}
    </div>
  );
}
