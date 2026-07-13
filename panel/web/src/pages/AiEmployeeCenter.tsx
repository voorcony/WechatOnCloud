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
  type AiBindPayloadResponse,
  type AiKnowledgeImportResponse,
  type AiPersonaDraft,
  type AiAutoReplyDraft,
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

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

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
  chunks: number;
  status: string;
  ago: string;
}
interface KnowledgeVM {
  docCount: number;
  chunkCount: number;
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
interface CenterVM {
  employees: EmployeeVM[];
  customers: CustomerVM[];
  runs: RunVM[];
  knowledge: KnowledgeVM;
  pending: PendingVM;
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
  };
}

function kbVMFromReal(k: AiKnowledgeSummary | null): KnowledgeVM {
  if (!k) return { docCount: 0, chunkCount: 0, docs: [] };
  return {
    docCount: k.document_count,
    chunkCount: k.chunk_count,
    docs: k.documents.map((d) => ({
      key: String(d.document_id),
      label: d.title_suffix ? `文档 ···${d.title_suffix}` : `文档 ${d.title_hash.slice(0, 8)}`,
      titleHash: d.title_hash,
      chunks: d.chunk_count,
      status: d.chunk_count > 0 ? '已切片' : '待切片',
      ago: timeAgo(d.updated_at),
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
    docs: Array.from({ length: n }, (_, i) => ({
      key: 'kb' + i,
      label: kbTitles[i % kbTitles.length],
      titleHash: fakeHash('kb' + i),
      chunks: 4 + (seedOf('kb' + i) % 10),
      status: '已切片',
      ago: `${1 + (seedOf('kb' + i) % 12)} 小时前`,
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

  return { employees, customers: allCustomers, runs: allRuns, knowledge, pending };
}

// ==================== Tab 结构 ====================
type Seg = 'overview' | 'customers' | 'knowledge' | 'pending' | 'bind' | 'runs';
const SEGMENTS: { key: Seg; label: string }[] = [
  { key: 'overview', label: '员工总览' },
  { key: 'customers', label: '客户画像' },
  { key: 'knowledge', label: '知识库' },
  { key: 'pending', label: '待确认' },
  { key: 'bind', label: '绑定秘书' },
  { key: 'runs', label: '运行记录' },
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
    <div className="ws-page ai-page-wrap">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">AI 员工中心</span>
        <span className={'tag' + (isAdmin ? '' : ' tag-muted')} style={{ marginLeft: 'auto' }}>
          {isAdmin ? '管理员 · 全部实例' : '子账号 · 授权实例'}
        </span>
      </header>

      <div className="content ai-page">
        <section className="ai-hero">
          <div className="ai-hero-title">AI 员工管理中心 · 像管理团队一样管理 AI</div>
          <div className="ai-hero-flow">身份人格 → 权限边界 → 负责微信 → 负责客户 → 知识库 → 运行记录</div>
          <div className="ai-hero-scope">
            每个 AI 员工的可操作范围 = 当前账号在云微已有授权下可见的实例。管理员隐式拥有全部实例；子账号只看到被授权实例。
          </div>
        </section>

        {probed &&
          (real ? (
            <div className="ai-srcbar ai-srcbar-real">
              <span className="ai-srcdot" /> 已接入真实 AI 员工数据 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）
            </div>
          ) : (
            <div className="ai-warn">
              当前未配置 AI 员工数据源
              {resp && resp.mode === 'demo_fallback' && resp.reason === 'cannot_enforce_instance_filter'
                ? '（无法按实例过滤，已对子账号回退）'
                : ''}
              ，正在展示本地演示数据。实例名称与在线状态为真实值，员工 / 客户 / 运行为占位演示。
            </div>
          ))}

        <div className="ai-action-grid">
          <button className="ai-action-card primary" onClick={() => setSeg('bind')}>
            <span className="ai-action-ic">📲</span>
            <b>扫码绑定秘书</b>
            <span>生成一次性绑定码，把大秘书接入云微信实例</span>
          </button>
          <button className="ai-action-card" onClick={() => setSeg('knowledge')}>
            <span className="ai-action-ic">📚</span>
            <b>导入知识库</b>
            <span>商品、售后、优惠话术变成 AI 员工可检索知识</span>
          </button>
          <button className="ai-action-card" onClick={() => setSeg('customers')}>
            <span className="ai-action-ic">👥</span>
            <b>查看客户画像</b>
            <span>按会话沉淀阶段、风险、意向和记忆计数</span>
          </button>
        </div>

        <div className="ai-kpis">
          {kpis.map((k) => (
            <div key={k.label} className={'ai-kpi' + (k.tone ? ' ai-kpi-' + k.tone : '')}>
              <span className="ai-kpi-val">{k.value}</span>
              <span className="ai-kpi-lbl">{k.label}</span>
            </div>
          ))}
        </div>

        <div className="ai-tabs" role="tablist">
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={seg === s.key}
              className={'ai-tab' + (seg === s.key ? ' on' : '')}
              onClick={() => setSeg(s.key)}
            >
              {s.label}
              {s.key === 'pending' && vm.pending.total > 0 && <span className="ai-tab-badge">{vm.pending.total}</span>}
            </button>
          ))}
        </div>

        {empty ? (
          <EmptyBinds isAdmin={isAdmin} onManage={() => nav('/admin')} />
        ) : !ready ? (
          <div className="ai-loading">加载可见实例…</div>
        ) : (
          <div className="ai-panel">
            {seg === 'overview' && (
              <EmployeeWorkspace vm={vm} demo={!real} onOpenInstance={(id) => nav(`/i/${id}`)} onGotoTab={setSeg} />
            )}
            {seg === 'customers' && <CustomerBoard customers={vm.customers} demo={!real} />}
            {seg === 'knowledge' && <KnowledgePanel real={real} knowledge={vm.knowledge} onImported={loadConsole} />}
            {seg === 'pending' && <PendingBoard pending={vm.pending} demo={!real} />}
            {seg === 'bind' && <BindPanel real={real} />}
            {seg === 'runs' && <RunLog runs={vm.runs} demo={!real} />}
          </div>
        )}
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
    return <div className="ai-note">当前可见实例上暂无已绑定的 AI 员工。请先在「绑定秘书」生成绑定码接入大秘书。</div>;
  }
  return (
    <div className="ai-ws">
      <div className="ai-ws-list">
        <div className="ai-ws-listhead">
          AI 员工名册 <span>{vm.employees.length}</span>
        </div>
        {vm.employees.map((e) => (
          <button
            key={e.key}
            className={'ai-emp-item' + (selected && e.key === selected.key ? ' on' : '')}
            onClick={() => setSelKey(e.key)}
          >
            <span className={'ai-emp-av ai-av-' + e.roleCn}>{ROLE_GLYPH[e.roleCn] ?? '🤖'}</span>
            <span className="ai-emp-main">
              <span className="ai-emp-top">
                <span className="ai-emp-name">{e.displayName}</span>
                <span className={'ai-status ai-status-' + e.statusKind}>{e.statusText}</span>
              </span>
              <span className="ai-emp-metrics">
                <span className={'ai-role ai-role-' + e.roleCn}>{e.roleCn}</span>
                <span className="ai-emp-metric">微信 {e.instances.length}</span>
                <span className="ai-emp-metric">客户 {e.customers.length}</span>
                {e.tasksWaiting > 0 && <span className="ai-emp-metric warn">待确认 {e.tasksWaiting}</span>}
              </span>
            </span>
            <span className="enter-arrow">›</span>
          </button>
        ))}
      </div>

      {selected && (
        <EmployeeDetail emp={selected} knowledge={vm.knowledge} demo={demo} onOpenInstance={onOpenInstance} onGotoTab={onGotoTab} />
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
    <div className="ai-emp-detail">
      {/* 身份人格 */}
      <div className="ai-persona">
        <span className={'ai-persona-av ai-av-' + emp.roleCn}>{ROLE_GLYPH[emp.roleCn] ?? '🤖'}</span>
        <div className="ai-persona-id">
          <div className="ai-persona-name">
            {emp.displayName}
            <span className={'ai-status ai-status-' + emp.statusKind}>{emp.statusText}</span>
          </div>
          <div className="ai-persona-role">
            <span className={'ai-role ai-role-' + emp.roleCn}>{emp.roleCn}岗</span>
            <span className="ai-persona-sub">name ···{emp.nameSuffix || '——'} · hash {emp.nameHash.slice(0, 8)}</span>
          </div>
        </div>
        <div className="ai-persona-quick">
          <div><b>{emp.instances.length}</b><span>负责微信</span></div>
          <div><b>{emp.customers.length}</b><span>负责客户</span></div>
          <div><b>{emp.totalRuns}</b><span>运行</span></div>
          <div className={emp.tasksWaiting ? 'warn' : ''}><b>{emp.tasksWaiting}</b><span>待确认</span></div>
        </div>
      </div>

      <div className="ai-sec">
        <div className="ai-sec-title">AI 行为边界</div>
        <p className="ai-sec-boundary">{roleBoundary(emp.roleCn)}</p>
        <div className="ai-sec-meta">
          职责摘要：{emp.respLen} 字 · hash {emp.respHash.slice(0, 12)}
          <span className="ai-card-sep">·</span> 原始职责与姓名不在后台展示，仅保留长度与指纹
        </div>
      </div>

      {/* 权限策略 */}
      <div className="ai-sec">
        <div className="ai-sec-title">
          权限策略
          <span className="ai-sec-count">审批 {emp.approvalCount} · 记忆 {emp.memoryCount} · 操作 {emp.permCount}</span>
        </div>
        <div className="ai-fieldgrid">
          <ChipField title="审批策略" keys={emp.approvalKeys} empty="继承默认：敏感动作需人工确认" />
          <ChipField title="记忆策略" keys={emp.memoryKeys} empty="继承默认记忆策略" />
          <ChipField title="操作权限" keys={emp.permKeys} empty="未授予额外操作权限" />
        </div>
      </div>

      {/* 人格配置 + 自动回复策略（PR5：可编辑） */}
      <PersonaPolicyEditor emp={emp} demo={demo} />

      {/* 负责微信 */}
      <div className="ai-sec">
        <div className="ai-sec-title">
          负责微信 <span className="ai-sec-count">{emp.instances.length} 个实例</span>
        </div>
        {emp.instances.length === 0 ? (
          <div className="ai-note">尚未绑定任何可见微信实例。</div>
        ) : (
          <div className="ai-wxgrid">
            {emp.instances.map((ins) => {
              const inner = (
                <>
                  <div className="ai-card-head">
                    <span className="ai-card-av">
                      {ins.woc ? (
                        <InstanceIcon icon={ins.woc.icon} appType={ins.woc.appType} size={36} radius={10} />
                      ) : (
                        <span className="ai-card-hashav">···{ins.suffix}</span>
                      )}
                    </span>
                    <div className="ai-card-id">
                      <div className="ai-card-name">{ins.name}</div>
                      <div className="ai-card-sub">
                        {ins.statusCls && <span className={'ai-dot ' + ins.statusCls} />} {ins.statusText} · {ins.appLabel}
                      </div>
                    </div>
                    {ins.woc && <span className="enter-arrow">›</span>}
                  </div>
                  <div className="ai-card-stats">
                    任务 {ins.tasks}
                    <span className="ai-card-sep">·</span> 运行 {ins.runs}
                    {ins.permissionCount > 0 && (
                      <>
                        <span className="ai-card-sep">·</span> 权限 {ins.permissionCount}
                      </>
                    )}
                    {Object.keys(ins.bindingScopes).length > 0 && (
                      <>
                        <span className="ai-card-sep">·</span> 范围{' '}
                        {Object.entries(ins.bindingScopes)
                          .map(([k, v]) => `${keyLabel(k)}:${v}`)
                          .join(' / ')}
                      </>
                    )}
                  </div>
                </>
              );
              return ins.woc ? (
                <button key={ins.key} className="ai-card ai-card-btn" onClick={() => onOpenInstance(ins.woc!.id)}>
                  {inner}
                </button>
              ) : (
                <div key={ins.key} className="ai-card">
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 负责客户 */}
      <div className="ai-sec">
        <div className="ai-sec-title">
          负责客户 <span className="ai-sec-count">{emp.customers.length} 位</span>
          {emp.customers.length > 0 && (
            <button className="btn-text ai-sec-more" onClick={() => onGotoTab('customers')}>
              全部客户画像 ›
            </button>
          )}
        </div>
        {emp.customers.length === 0 ? (
          <div className="ai-note">暂无沉淀的客户画像。</div>
        ) : (
          <div className="ai-custgrid">
            {emp.customers.slice(0, 6).map((cu) => (
              <CustomerCard key={cu.key} cu={cu} />
            ))}
          </div>
        )}
      </div>

      {/* 知识库范围 */}
      <div className="ai-sec">
        <div className="ai-sec-title">
          知识库范围（共享） <span className="ai-sec-count">{knowledge.docCount} 文档 · {knowledge.chunkCount} 切片</span>
          <button className="btn-text ai-sec-more" onClick={() => onGotoTab('knowledge')}>
            管理知识库 ›
          </button>
        </div>
        {knowledge.docs.length === 0 ? (
          <div className="ai-note">暂无知识库。可在「知识库」tab 导入 Markdown。</div>
        ) : (
          <div className="ai-kbchips">
            {knowledge.docs.slice(0, 6).map((d) => (
              <div key={d.key} className="ai-kbchip">
                <span className="ai-kbchip-name">{d.label}</span>
                <span className="ai-kbchip-meta">{d.chunks} 切片 · {d.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 运行记录 */}
      <div className="ai-sec">
        <div className="ai-sec-title">
          运行记录 <span className="ai-sec-count">最近 {emp.runs.length}</span>
          {emp.runs.length > 0 && (
            <button className="btn-text ai-sec-more" onClick={() => onGotoTab('runs')}>
              全部运行记录 ›
            </button>
          )}
        </div>
        {emp.runs.length === 0 ? (
          <div className="ai-note">暂无运行记录。</div>
        ) : (
          <ul className="ai-timeline">
            {emp.runs.slice(0, 6).map((r) => (
              <li key={r.key} className="ai-tl-item">
                <span className={'ai-tl-dot ' + r.status.cls} />
                <div className="ai-tl-body">
                  <div className="ai-tl-main">
                    {r.act}
                    <span className="ai-tl-inst">@{r.instName}</span>
                  </div>
                  <div className="ai-tl-meta">
                    <span className={'ai-dot ' + r.status.cls} /> {r.status.t}
                    {r.summary && <> · {r.summary}</>}
                    {r.ago && <> · {r.ago}</>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {demo && <div className="ai-note">以上为演示数据（deterministic 占位）。接入真实数据源后，此处为该 AI 员工的真实身份 / 权限 / 客户 / 运行。</div>}
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
      {/* 1. 人格配置区 */}
      <div className="ai-sec">
        <div className="ai-sec-title">
          人格配置
          <span className="ai-sec-count">显示名 · 业务域 · 岗位 · 语气 · 目标 · 禁止承诺</span>
          <button className="btn-text ai-sec-more" disabled={busy !== ''} onClick={applyTemplate}>
            应用游戏代练客服模板 ›
          </button>
        </div>
        <div className="ai-note" style={{ marginBottom: 12 }}>
          当前后端仅下发人格指纹（name ···{emp.nameSuffix || '——'} · hash {emp.nameHash.slice(0, 8)} · 职责 {emp.respLen} 字），
          未开放明文编辑快照。以下表单可基于模板填充并提交到新 API 下发；不展示任何聊天正文 / 原始职责原文。
        </div>
        <div className="ai-form-grid">
          <label className="ai-form-field">
            <span className="ai-form-label">显示名 / 客服名</span>
            <input className="input" value={persona.displayName} maxLength={60}
              onChange={(e) => setPersona((p) => ({ ...p, displayName: e.target.value }))} placeholder="如：代练客服小助手" />
          </label>
          <label className="ai-form-field">
            <span className="ai-form-label">业务域</span>
            <input className="input" value={persona.serviceDomain} maxLength={60}
              onChange={(e) => setPersona((p) => ({ ...p, serviceDomain: e.target.value }))} placeholder="如：游戏代练客服" />
          </label>
        </div>
        <div className="ai-form-field" style={{ marginTop: 12 }}>
          <span className="ai-form-label">岗位</span>
          <div className="ai-choice-row">
            {PERSONA_POSTS.map((p) => (
              <button key={p.key} className={'ai-choice' + (persona.post === p.key ? ' on' : '')} onClick={() => setPost(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ai-form-field" style={{ marginTop: 12 }}>
          <span className="ai-form-label">语气</span>
          <div className="ai-choice-row">
            {PERSONA_TONES.map((t) => (
              <button key={t.key} className={'ai-choice' + (persona.tones.includes(t.key) ? ' on' : '')} onClick={() => toggleTone(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <label className="ai-form-field" style={{ marginTop: 12 }}>
          <span className="ai-form-label">目标（引导收集的信息）</span>
          <textarea className="input ai-form-textarea" value={persona.goals} maxLength={2000}
            onChange={(e) => setPersona((p) => ({ ...p, goals: e.target.value }))}
            placeholder="如：收集游戏 / 区服 / 段位 / 目标段位 / 预算 / 时限，并沉淀客户画像" />
        </label>
        <label className="ai-form-field" style={{ marginTop: 12 }}>
          <span className="ai-form-label">禁止承诺 / 红线</span>
          <textarea className="input ai-form-textarea" value={persona.forbidden} maxLength={2000}
            onChange={(e) => setPersona((p) => ({ ...p, forbidden: e.target.value }))}
            placeholder="如：不承诺 100% 不封号；不提供违规外挂；不诱导索取账号 / 支付密码 / 验证码" />
        </label>
      </div>

      {/* 2. 自动回复策略区 */}
      <div className="ai-sec">
        <div className="ai-sec-title">
          自动回复策略
          <span className={'ai-mode-badge ai-mode-' + ar.mode}>{AUTO_MODE_LABELS[ar.mode]}</span>
        </div>

        <div className="ai-toggle-row">
          <button
            className={'ai-switch' + (enabled ? ' on' : '')}
            role="switch"
            aria-checked={enabled}
            onClick={toggleEnabled}
          >
            <span className="ai-switch-knob" />
          </button>
          <div className="ai-toggle-text">
            <b>自动回复测试模式</b>
            <span>关闭后 AI 只沉淀画像、不生成自动回复；开启后按下方模式处理。</span>
          </div>
        </div>

        {enabled && (
          <div className="ai-form-field" style={{ marginTop: 14 }}>
            <span className="ai-form-label">模式</span>
            <div className="ai-radio-row">
              <button className={'ai-radio' + (ar.mode === 'suggest_only' ? ' on' : '')} onClick={() => setMode('suggest_only')}>
                <span className="ai-radio-dot" />
                <span className="ai-radio-body">
                  <b>只生成建议</b>
                  <span>AI 起草回复进入待确认队列，人工确认后才发送（推荐）。</span>
                </span>
              </button>
              <button className={'ai-radio' + (autoSend ? ' on' : '')} onClick={() => setMode('auto_send_test')}>
                <span className="ai-radio-dot" />
                <span className="ai-radio-body">
                  <b>测试自动发送</b>
                  <span>仅对低风险咨询自动发送，命中人审触发词的仍转人工。</span>
                </span>
              </button>
            </div>
          </div>
        )}

        {autoSend && (
          <div className="ai-risk-banner">
            <span className="ai-risk-ic">⚠️</span>
            <div>
              <b>测试自动发送已开启 · 请谨慎</b>
              <ul>
                <li>仅对<b>测试实例 / 白名单会话 / 低风险咨询</b>自动发送，高风险一律转人工确认。</li>
                <li>付款 / 退款 / 封号 / 外挂 / 外部链接 / 大额订单 / 投诉等命中人审触发词的消息进入待确认队列。</li>
                <li>所有自动 / 人工动作都会写入 audit 审计；真实发送由后端二次 gating，前端不直接触发微信动作。</li>
                <li>后端未就绪时不会真正开启，本页只保存策略草稿、不假装生效。</li>
              </ul>
            </div>
          </div>
        )}

        {enabled && (
          <>
            <div className="ai-form-field" style={{ marginTop: 14 }}>
              <span className="ai-form-label">生效范围</span>
              <div className="ai-choice-row">
                {SCOPE_OPTIONS.map((s) => (
                  <button key={s.key} className={'ai-choice' + (ar.scope === s.key ? ' on' : '')} title={s.hint}
                    onClick={() => setAr((a) => ({ ...a, scope: s.key }))}>
                    {s.label}
                  </button>
                ))}
              </div>
              <span className="ai-form-hint">{SCOPE_OPTIONS.find((s) => s.key === ar.scope)?.hint}</span>
            </div>

            <div className="ai-form-grid" style={{ marginTop: 14 }}>
              <label className="ai-form-field">
                <span className="ai-form-label">频率限制 · 时间窗（秒）</span>
                <input className="input" type="number" min={0} max={3600} value={ar.rateLimitSeconds}
                  onChange={(e) => setAr((a) => ({ ...a, rateLimitSeconds: Math.max(0, Math.min(3600, Math.floor(Number(e.target.value) || 0))) }))} />
              </label>
              <label className="ai-form-field">
                <span className="ai-form-label">频率限制 · 最多条数</span>
                <input className="input" type="number" min={1} max={100} value={ar.rateLimitCount}
                  onChange={(e) => setAr((a) => ({ ...a, rateLimitCount: Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))) }))} />
              </label>
            </div>
            <span className="ai-form-hint">每客户每 {ar.rateLimitSeconds} 秒最多自动发送 {ar.rateLimitCount} 条。</span>
          </>
        )}

        <div className="ai-form-field" style={{ marginTop: 14 }}>
          <span className="ai-form-label">强制人审触发（命中即转人工确认）</span>
          <div className="ai-choice-row">
            {GUARDRAILS.map((g) => (
              <button key={g.key} className={'ai-choice ai-guard' + (ar.guardrails.includes(g.key) ? ' on' : '')} onClick={() => toggleGuardrail(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* 安全文案 */}
        <div className="ai-safety">
          <b>安全说明</b>
          <ul>
            <li>自动发送只对低风险咨询生效；付款 / 退款 / 封号 / 外挂 / 链接等进入待确认。</li>
            <li>所有动作写入 audit 审计；真实发送由后端 gating，本页不直接触发真实微信动作。</li>
            <li>无真实后端能力时不假装开启成功，仅保存本地策略草稿。</li>
          </ul>
        </div>

        {/* 试运行判断 */}
        <div className="ai-form-field" style={{ marginTop: 14 }}>
          <span className="ai-form-label">试运行判断（输入一条示例咨询，看会自动发送还是转人工）</span>
          <textarea className="input ai-form-textarea" value={sample} maxLength={500}
            onChange={(e) => setSample(e.target.value)}
            placeholder="如：王者荣耀想从黄金上到钻石，大概多少钱多久？" />
        </div>
        {testResult && (
          <div className="ai-test-result">
            <span className={'ai-dot ' + (TEST_DECISION_LABELS[testResult.decision]?.cls ?? 'st-warn')} />
            <b>{TEST_DECISION_LABELS[testResult.decision]?.t ?? testResult.decision}</b>
            <span className="ai-card-sep">·</span> 风险 {RISK_LABEL[riskOf(testResult.risk)]}
            {testResult.matched.length > 0 && (
              <>
                <span className="ai-card-sep">·</span> 命中人审：
                {testResult.matched.map((k) => GUARDRAILS.find((g) => g.key === k)?.label ?? k).join(' / ')}
              </>
            )}
            {testResult.summary && <div className="ai-note" style={{ marginTop: 6 }}>{testResult.summary}</div>}
          </div>
        )}

        {notice && (
          <div className={notice.tone === 'ok' ? 'ai-ok' : notice.tone === 'err' ? 'ai-warn' : 'ai-warn'} style={{ marginTop: 12 }}>
            {notice.text}
          </div>
        )}

        <div className="ai-bind-actions">
          <button className="btn btn-primary" disabled={busy !== ''} onClick={savePolicy}>
            {busy === 'save' ? '保存中…' : '保存策略'}
          </button>
          <button className="btn" disabled={busy !== ''} onClick={applyTemplate}>
            {busy === 'template' ? '应用中…' : '应用游戏代练客服模板'}
          </button>
          <button className="btn" disabled={busy !== '' || employeeId == null || !sample.trim()} onClick={runTest}
            title={employeeId == null ? '接入真实数据源后可试运行' : ''}>
            {busy === 'test' ? '判断中…' : '试运行判断'}
          </button>
          {employeeId == null && <span className="ai-bind-hint">演示模式：接入真实 AI 员工数据源后可保存 / 试运行</span>}
        </div>
      </div>
    </>
  );
}

function ChipField({ title, keys, empty }: { title: string; keys: string[]; empty: string }) {
  return (
    <div className="ai-field">
      <div className="ai-field-title">{title}</div>
      {keys.length === 0 ? (
        <div className="ai-field-empty">{empty}</div>
      ) : (
        <div className="ai-chips">
          {keys.map((k) => (
            <span key={k} className="ai-chip">
              {keyLabel(k)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerCard({ cu }: { cu: CustomerVM }) {
  return (
    <div className="ai-card">
      <div className="ai-card-head">
        <span className={'ai-cust-av risk-' + cu.risk}>{cu.code.slice(0, 2)}</span>
        <div className="ai-card-id">
          <div className="ai-card-name">客户 {cu.code}</div>
          <div className="ai-card-sub">@{cu.instName} · {cu.ago || '—'}</div>
        </div>
        <span className={'ai-dot ' + riskDotCls(cu.risk)} title={RISK_LABEL[cu.risk]} />
      </div>
      <div className="ai-card-stats">
        <span className={'ai-role ai-role-stage'}>{stageLabel(cu.stage)}</span>
        <span className="ai-card-sep">·</span> 意向 {cu.intent ?? '—'}
        <span className="ai-card-sep">·</span> 消息 {cu.messages}
        <span className="ai-card-sep">·</span> 记忆 {cu.memActive}/{cu.memCandidate}
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
        <div className="ai-crosslink">
          <span>需要按客户维度筛选 / 查看画像与 AI 建议？</span>
          <button className="btn-text" onClick={() => nav('/customers')}>打开客户 CRM ›</button>
        </div>
        <div className="ai-note">暂无客户画像。请先启动 OCR 历史补全并运行记忆 / 画像抽取。</div>
      </>
    );
  const counts = {
    high: customers.filter((c) => c.risk === 'high').length,
    medium: customers.filter((c) => c.risk === 'medium').length,
  };
  return (
    <>
      <div className="ai-crosslink">
        <span>需要按客户维度管理、看 AI 跟进建议与所属微信？</span>
        <button className="btn-text" onClick={() => nav('/customers')}>打开客户 CRM ›</button>
      </div>
      <div className="ai-note">
        客户画像来自 OCR 入库消息 + 记忆 / 画像抽取。只展示 hash、阶段、意向、风险与记忆计数，不显示聊天正文。
        {demo && ' 当前为演示数据。'}
      </div>
      <div className="ai-filterbar">
        {(['all', 'high', 'medium', 'low'] as const).map((r) => (
          <button key={r} className={'ai-filter' + (risk === r ? ' on' : '')} onClick={() => setRisk(r)}>
            {r === 'all' ? '全部' : RISK_LABEL[r]}
            {r === 'high' && counts.high > 0 && <span className="ai-tab-badge">{counts.high}</span>}
            {r === 'medium' && counts.medium > 0 && <span className="ai-tab-badge">{counts.medium}</span>}
          </button>
        ))}
      </div>
      <div className="ai-custgrid">
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
      <div className="ai-kb-import">
        <div className="ai-bind-title">导入知识库</div>
        <p className="ai-bind-desc">
          上传 Markdown 到 AI 员工知识库，服务端写入私有目录并重建检索切片。后台只显示 hash / 计数，不展示正文与原始标题。
          {!canImport && ' 当前未接入真实数据源，导入功能在配置数据源后可用。'}
        </p>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文档标题" />
        <textarea
          className="input ai-kb-textarea"
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          placeholder={'# 退换货政策\n\n把商家话术 / 商品知识粘贴到这里'}
        />
        <div className="ai-bind-actions">
          <button className="btn btn-primary" disabled={busy || !markdown.trim() || !canImport} onClick={submit}>
            {busy ? '导入中…' : '导入 Markdown'}
          </button>
          {result && <span className="ai-bind-hint">已导入 {result.document_count} 文档 / {result.chunk_count} 切片</span>}
        </div>
        {err && <div className="ai-warn" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <div className="ai-kpis">
        <div className="ai-kpi">
          <span className="ai-kpi-val">{knowledge.docCount}</span>
          <span className="ai-kpi-lbl">知识文档</span>
        </div>
        <div className="ai-kpi">
          <span className="ai-kpi-val">{knowledge.chunkCount}</span>
          <span className="ai-kpi-lbl">检索切片</span>
        </div>
      </div>
      {knowledge.docs.length === 0 ? (
        <div className="ai-note">暂无知识库。可在上方粘贴 Markdown 导入。</div>
      ) : (
        <table className="ai-table">
          <thead>
            <tr>
              <th>文档</th>
              <th>切片</th>
              <th>状态</th>
              <th>内容 hash</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {knowledge.docs.map((d) => (
              <tr key={d.key}>
                <td>
                  <b>{d.label}</b>
                  <div className="ai-cell-sub">title hash · {d.titleHash}</div>
                </td>
                <td>{d.chunks}</td>
                <td>
                  <span className={'ai-dot ' + (d.status === '已切片' ? 'st-on' : 'st-warn')} /> {d.status}
                </td>
                <td className="ai-mono">{d.titleHash.slice(0, 12)}</td>
                <td className="ai-cell-sub">{d.ago}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ==================== 待确认 ====================
function PendingBoard({ pending, demo }: { pending: PendingVM; demo: boolean }) {
  const nav = useNavigate();
  return (
    <>
      <div className="ai-crosslink">
        <span>需要按风险 / 类型分流处理待确认动作队列？</span>
        <button className="btn-text" onClick={() => nav('/approvals')}>打开待确认中心 ›</button>
      </div>
      <div className="ai-warn">
        以下为等待人工确认 / 计划中的动作汇总{demo ? '（演示）' : '（真实计数）'}。<b>本页只读，不触发任何真实微信动作</b>，按钮均不可用。
      </div>
      <div className="ai-kpis" style={{ marginTop: 12 }}>
        {pending.rows.map((r) => (
          <div key={r.key} className={'ai-kpi' + (r.value ? ' ai-kpi-warn' : '')}>
            <span className="ai-kpi-val">{r.value}</span>
            <span className="ai-kpi-lbl">{r.label}</span>
          </div>
        ))}
      </div>
      {pending.drafts.length > 0 ? (
        <div className="ai-pending" style={{ marginTop: 12 }}>
          {pending.drafts.map((d) => (
            <div key={d.key} className="ai-pending-item">
              <div className="ai-pending-head">
                <span className="ai-mono">{d.taskLabel}</span>
                <span className="ai-card-sep">·</span> @{d.instName}
              </div>
              <div className="ai-pending-draft">{d.redacted}</div>
              <div className="ai-pending-actions">
                <button className="btn btn-primary" disabled title="后续接人审 API；当前不触发真实微信动作">
                  通过并发送
                </button>
                <button className="btn" disabled title="后续接人审 API；当前不触发真实微信动作">
                  编辑后通过
                </button>
                <button className="btn btn-danger" disabled title="后续接人审 API；当前不触发真实微信动作">
                  驳回
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ai-note" style={{ marginTop: 12 }}>当前没有等待确认的动作 🎉</div>
      )}
    </>
  );
}

// ==================== 运行记录 ====================
function RunLog({ runs, demo }: { runs: RunVM[]; demo: boolean }) {
  if (runs.length === 0) return <div className="ai-note">暂无运行记录。</div>;
  return (
    <>
      <div className="ai-note">AI 员工的运行时间线（只读脱敏摘要）。{demo && ' 当前为演示数据。'}</div>
      <ul className="ai-timeline">
        {runs.map((r) => (
          <li key={r.key} className="ai-tl-item">
            <span className={'ai-tl-dot ' + r.status.cls} />
            <div className="ai-tl-body">
              <div className="ai-tl-main">
                <b>{r.emp}</b> {r.act}
                <span className="ai-tl-inst">@{r.instName}</span>
              </div>
              <div className="ai-tl-meta">
                <span className={'ai-dot ' + r.status.cls} /> {r.status.t}
                {r.summary && <> · {r.summary}</>}
                {r.ago && <> · {r.ago}</>}
              </div>
            </div>
          </li>
        ))}
      </ul>
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
    <div className="ai-bind">
      <div className="ai-bind-title">扫码绑定秘书</div>
      <p className="ai-bind-desc">
        生成一次性绑定 payload，给控制机器人 / 二维码使用。后端只保存 token hash；原始绑定串只编码进二维码，不以明文展示。
        {!canBind && ' 当前未接入真实数据源，绑定在配置数据源后可用。'}
      </p>
      {bp && bp.channel_count > 0 ? (
        <table className="ai-table" style={{ marginTop: 10 }}>
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
                <td className="ai-mono">#{ch.channel_id}</td>
                <td>{ch.channel_type}</td>
                <td>
                  <span
                    className={'ai-dot ' + (ch.bind_status === 'active' ? 'st-on' : ch.bind_status === 'pending' ? 'st-warn' : 'st-off')}
                  />{' '}
                  {ch.bind_status}
                </td>
                <td>{ch.has_bind_token ? '是' : '否'}</td>
                <td className="ai-cell-sub">{ch.bound_at ? timeAgo(ch.bound_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="ai-note" style={{ marginTop: 10 }}>暂无控制通道。</div>
      )}
      <div className="ai-bind-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy || !canBind} onClick={createBind}>
          {busy ? '生成中…' : '生成绑定码'}
        </button>
        <span className="ai-bind-hint">管理员生成；子账号无权生成</span>
      </div>
      {err && <div className="ai-warn" style={{ marginTop: 10 }}>{err}</div>}
      {payload && (
        <div className="ai-bind-payload">
          <div className="ai-bind-title">一次性绑定二维码</div>
          {qrUrl ? <img className="ai-qrbox" src={qrUrl} alt="扫码绑定秘书二维码" /> : <div className="ai-qrbox">生成中</div>}
          <div className="ai-note">扫码即绑定；原始绑定串只编码进上方二维码，不在页面以明文展示。</div>
          <div className="ai-note">
            channel #{payload.channel_id} · payload hash {payload.bind_payload_hash} · token hash {payload.bind_token_hash}
          </div>
        </div>
      )}
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
          <button className="btn btn-primary" onClick={onManage}>
            去管理页新建实例
          </button>
        </div>
      )}
    </div>
  );
}
