import { useEffect, useMemo, useState } from 'react';
import { useInstances } from '../AppShell';
import { api, type InstanceWithStatus, type AiConsolePayload, type AiEmployeeConsoleResponse, type AiTaskCard } from '../api';

// 客户画像 CRM（/customers）与待确认中心（/approvals）共享的只读数据模型。
// 与总控台 / AI 员工中心保持一致的安全约束：只归一化 hash / suffix / 阶段 / 意向 / 风险 /
// 计数 / 脱敏摘要，绝不产出聊天正文、回复原文、token、绑定串明文、员工原始姓名 / 职责。
// 真实模式来自 /api/ai-employees/console（allowlist + 按可见实例过滤），失败回退 deterministic 演示。

export type Risk = 'high' | 'medium' | 'low';
export const RISK_LABEL: Record<Risk, string> = { high: '高风险', medium: '关注', low: '正常' };
export const riskDotCls = (r: Risk): string => (r === 'high' ? 'st-off' : r === 'medium' ? 'st-warn' : 'st-on');

const ROLE_LABELS: Record<string, string> = { pre_sales: '售前', after_sales: '售后', retention: '复购', group_ops: '群运营' };
const ROLES = ['售前', '售后', '复购', '群运营'] as const;
export const ROLE_GLYPH: Record<string, string> = { 售前: '🛍️', 售后: '🛠️', 复购: '🔁', 群运营: '👥' };
const label = (m: Record<string, string>, k: string): string => m[k] ?? k;

// deterministic 伪随机（按字符串派生），保证演示数字稳定不跳动。
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function agoText(minutes: number): string {
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

export function stageLabel(stage: string | null): string {
  const map: Record<string, string> = { high_intent: '高意向', browsing: '了解中', after_sales: '售后', risk: '风险', new: '新客' };
  return stage ? map[stage] ?? stage : '待培育';
}
function riskOf(risk: string | null): Risk {
  if (risk === 'high') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}
function highIntentOf(stage: string | null, intent: number | null): boolean {
  return stage === 'high_intent' || (intent ?? 0) >= 70;
}

// AI 跟进建议：按 stage / risk / intent / 活跃度派生的安全产品文案，绝不引用聊天正文。
function deriveSuggestion(stage: string | null, risk: Risk, intent: number | null, recent: boolean): string {
  if (risk === 'high') return '风险偏高：建议人工介入安抚，暂缓自动外发，核对承诺口径后再跟进。';
  if (highIntentOf(stage, intent)) return '高意向：建议 24 小时内跟进报价 / 促成下单，敏感动作转人工确认。';
  if (stage === 'after_sales') return '售后阶段：建议核对订单与物流并安抚情绪，超期未解决及时升级人工。';
  if (stage === 'browsing') return '了解阶段：建议推送商品亮点 / 活动培育意向，控制打扰频率。';
  if (!recent) return '近期较沉默：建议低频唤醒 / 关怀触达，观察回应后再决定跟进力度。';
  return '持续观察：继续沉淀画像，等待明确意向信号后再主动跟进。';
}

export interface CrmCustomer {
  key: string;
  code: string;
  instName: string;
  instId: string | null; // 命中可见实例 → 可跳转接管
  instSuffix: string;
  stage: string | null;
  intent: number | null;
  risk: Risk;
  messages: number;
  incoming: number;
  outgoing: number;
  memActive: number;
  memCandidate: number;
  ago: string;
  recent: boolean; // 24h 内有观察
  highIntent: boolean;
  employeeName: string;
  employeeRole: string;
  suggestion: string;
}

// 待确认动作类型：基于 pending 计数 + recent_tasks 派生的安全动作。
interface ActionType {
  key: string;
  label: string;
  risk: Risk;
  reason: string;
  redacted: string;
  cap: number;
}
const ACTION_TYPES: ActionType[] = [
  {
    key: 'reply_jobs_needs_human',
    label: '回复待人工',
    risk: 'medium',
    reason: 'AI 起草的回复涉及报价 / 承诺口径，需人工确认后才能发送。',
    redacted: 'AI 已生成回复草稿（正文已脱敏，仅可确认 / 修改 / 拒绝）。',
    cap: 8,
  },
  {
    key: 'employee_tasks_waiting_approval',
    label: '员工任务待人审',
    risk: 'medium',
    reason: 'AI 员工任务产出需人工复核后才可落地执行。',
    redacted: 'AI 员工任务已完成产出，等待人工复核（内容已脱敏）。',
    cap: 8,
  },
  {
    key: 'send_actions_planned',
    label: '计划发送',
    risk: 'high',
    reason: '将向客户主动外发消息，属敏感外发动作，需人工确认。',
    redacted: '计划中的主动发送动作（目标与正文已脱敏，仅计数与状态可见）。',
    cap: 6,
  },
  {
    key: 'contact_remark_actions_planned',
    label: '改备注',
    risk: 'low',
    reason: '修改联系人备注会影响客户画像标签，建议人工确认。',
    redacted: '计划中的备注修改动作（原备注与目标已脱敏）。',
    cap: 6,
  },
  {
    key: 'group_operation_actions_planned',
    label: '群操作',
    risk: 'high',
    reason: '群公告 / 成员变更影响面大，需人工确认后执行。',
    redacted: '计划中的群操作动作（群与成员已脱敏，仅计数与状态可见）。',
    cap: 6,
  },
];
export const ACTION_TYPE_LABELS: Record<string, string> = Object.fromEntries(ACTION_TYPES.map((a) => [a.key, a.label]));

export interface ApprovalAction {
  key: string;
  type: string;
  typeLabel: string;
  instName: string;
  instId: string | null;
  employeeName: string;
  risk: Risk;
  riskReason: string;
  redacted: string;
  ago: string;
  status: string;
}

interface Slot {
  instName: string;
  instId: string | null;
  empName: string;
}

// 从 pending 计数展开成 deterministic 的安全占位队列；真实 recent_tasks 的脱敏摘要用于富化对应条目。
function buildActions(counts: Record<string, number>, slots: Slot[], realTasks?: AiTaskCard[]): ApprovalAction[] {
  const out: ApprovalAction[] = [];
  const slotAt = (n: number): Slot => (slots.length ? slots[n % slots.length] : { instName: '未关联实例', instId: null, empName: '未分配' });
  const realRedacted = (realTasks ?? []).map((t) => t.input_redacted).filter((s): s is string => !!s);
  let rr = 0;
  let idx = 0;
  for (const at of ACTION_TYPES) {
    const n = Math.min(counts[at.key] ?? 0, at.cap);
    for (let j = 0; j < n; j++) {
      const slot = slotAt(idx);
      const seed = seedOf(at.key + ':' + j + ':' + slot.instName);
      let redacted = at.redacted;
      if ((at.key === 'reply_jobs_needs_human' || at.key === 'employee_tasks_waiting_approval') && rr < realRedacted.length) {
        redacted = realRedacted[rr++];
      }
      out.push({
        key: `${at.key}:${j}:${idx}`,
        type: at.key,
        typeLabel: at.label,
        instName: slot.instName,
        instId: slot.instId,
        employeeName: slot.empName,
        risk: at.risk,
        riskReason: at.reason,
        redacted,
        ago: agoText(1 + (seed % 180)),
        status: '待确认',
      });
      idx++;
    }
  }
  return out;
}

export interface AiConsoleModel {
  instances: InstanceWithStatus[];
  loaded: boolean;
  probed: boolean;
  real: boolean;
  demoReason: string | null;
  customers: CrmCustomer[];
  pendingCounts: Record<string, number>;
  pendingTotal: number;
  actions: ApprovalAction[];
}

interface Core {
  customers: CrmCustomer[];
  pendingCounts: Record<string, number>;
  pendingTotal: number;
  actions: ApprovalAction[];
}

function buildReal(c: AiConsolePayload, wocById: Map<string, InstanceWithStatus>): Core {
  // instance hash → 可见实例 + 负责员工。
  const hashMeta = new Map<string, { woc: InstanceWithStatus | null; suffix: string; empName: string; empRole: string }>();
  for (const ic of c.instance_cards) {
    const woc = ic.woc_instance_id ? wocById.get(ic.woc_instance_id) ?? null : null;
    const empId = ic.bound_employee_ids[0];
    const emp = empId != null ? c.employee_cards.find((e) => e.employee_id === empId) : undefined;
    const roleCn = emp ? label(ROLE_LABELS, emp.role) : '';
    hashMeta.set(ic.instance_id_hash, {
      woc,
      suffix: ic.instance_id_suffix,
      empRole: roleCn,
      empName: emp ? `${roleCn}助理${emp.name_suffix ? ' ···' + emp.name_suffix : ''}` : '未分配',
    });
  }

  const customers: CrmCustomer[] = c.customer_cards
    .slice()
    .sort((a, b) => (b.profile_intent_score ?? 0) - (a.profile_intent_score ?? 0))
    .map((cc) => {
      const meta = hashMeta.get(cc.instance_id_hash);
      const woc = meta?.woc ?? null;
      const risk = riskOf(cc.profile_risk_level);
      const mins = minutesSince(cc.latest_observed_at);
      const recent = mins != null && mins < 1440;
      const suffix = cc.instance_id_suffix || meta?.suffix || '';
      return {
        key: cc.conversation_key_hash,
        code: cc.conversation_key_hash.slice(0, 6),
        instName: woc ? woc.name : suffix ? `实例 ···${suffix}` : '未关联实例',
        instId: woc ? woc.id : null,
        instSuffix: suffix,
        stage: cc.profile_stage,
        intent: cc.profile_intent_score,
        risk,
        messages: cc.message_count,
        incoming: cc.incoming_count,
        outgoing: cc.outgoing_count,
        memActive: cc.active_memory_count,
        memCandidate: cc.candidate_memory_count,
        ago: mins != null ? agoText(mins) : '—',
        recent,
        highIntent: highIntentOf(cc.profile_stage, cc.profile_intent_score),
        employeeName: meta?.empName ?? '未分配',
        employeeRole: meta?.empRole ?? '',
        suggestion: deriveSuggestion(cc.profile_stage, risk, cc.profile_intent_score, recent),
      };
    });

  const p = c.pending ?? {};
  const pendingCounts: Record<string, number> = {
    reply_jobs_needs_human: p.reply_jobs_needs_human ?? 0,
    employee_tasks_waiting_approval: p.employee_tasks_waiting_approval ?? 0,
    send_actions_planned: p.send_actions_planned ?? 0,
    contact_remark_actions_planned: p.contact_remark_actions_planned ?? 0,
    group_operation_actions_planned: p.group_operation_actions_planned ?? 0,
  };
  const pendingTotal = p.pending_total ?? Object.values(pendingCounts).reduce((s, v) => s + v, 0);

  const slots: Slot[] = c.instance_cards.map((ic) => {
    const meta = hashMeta.get(ic.instance_id_hash)!;
    return { instName: meta.woc ? meta.woc.name : `实例 ···${ic.instance_id_suffix}`, instId: meta.woc?.id ?? null, empName: meta.empName };
  });
  const waitingTasks = c.recent_tasks.filter((t) => t.status === 'waiting_approval');
  const actions = buildActions(pendingCounts, slots, waitingTasks);
  return { customers, pendingCounts, pendingTotal, actions };
}

function buildDemo(instances: InstanceWithStatus[]): Core {
  const customers: CrmCustomer[] = [];
  const slots: Slot[] = [];
  instances.forEach((inst, i) => {
    const role = ROLES[i % ROLES.length];
    const empName = `${role}助理`;
    slots.push({ instName: inst.name, instId: inst.id, empName });
    const n = 3 + (seedOf(inst.id + ':cn') % 5);
    for (let j = 0; j < n; j++) {
      const seed = seedOf(inst.id + ':c' + j);
      const risk: Risk = seed % 9 === 0 ? 'high' : seed % 3 === 0 ? 'medium' : 'low';
      const stage = ['high_intent', 'browsing', 'after_sales', 'risk'][seed % 4];
      const intent = 40 + (seed % 60);
      const mins = 1 + (seed % 4320);
      const recent = mins < 1440;
      customers.push({
        key: inst.id + 'c' + j,
        code: 'A' + (100 + (seed % 800)),
        instName: inst.name,
        instId: inst.id,
        instSuffix: inst.id.slice(-4),
        stage,
        intent,
        risk,
        messages: 6 + (seed % 40),
        incoming: 3 + (seed % 20),
        outgoing: 2 + (seed % 16),
        memActive: seed % 5,
        memCandidate: seed % 3,
        ago: agoText(mins),
        recent,
        highIntent: highIntentOf(stage, intent),
        employeeName: empName,
        employeeRole: role,
        suggestion: deriveSuggestion(stage, risk, intent, recent),
      });
    }
  });
  customers.sort((a, b) => (b.intent ?? 0) - (a.intent ?? 0));

  const base = instances.length;
  const pendingCounts: Record<string, number> = {
    reply_jobs_needs_human: base ? 1 + (seedOf('reply' + base) % 3) : 0,
    employee_tasks_waiting_approval: base ? seedOf('task' + base) % 2 : 0,
    send_actions_planned: base ? seedOf('send' + base) % 2 : 0,
    contact_remark_actions_planned: base ? seedOf('remark' + base) % 2 : 0,
    group_operation_actions_planned: base ? seedOf('group' + base) % 2 : 0,
  };
  const pendingTotal = Object.values(pendingCounts).reduce((s, v) => s + v, 0);
  const actions = buildActions(pendingCounts, slots);
  return { customers, pendingCounts, pendingTotal, actions };
}

export function useAiConsoleModel(): AiConsoleModel {
  const { instances, loaded } = useInstances();
  const [resp, setResp] = useState<AiEmployeeConsoleResponse | null>(null);
  const [probed, setProbed] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .aiEmployeeConsole()
      .then((r) => alive && setResp(r))
      .catch(() => alive && setResp(null))
      .finally(() => alive && setProbed(true));
    return () => {
      alive = false;
    };
  }, []);

  const real = resp?.mode === 'real' && resp.console.found ? resp.console : null;
  const wocById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);
  const core = useMemo<Core>(() => (real ? buildReal(real, wocById) : buildDemo(instances)), [real, wocById, instances]);

  return {
    instances,
    loaded,
    probed,
    real: !!real,
    demoReason: resp && resp.mode === 'demo_fallback' ? resp.reason : null,
    ...core,
  };
}
