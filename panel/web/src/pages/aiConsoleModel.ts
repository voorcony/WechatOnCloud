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

// 权限键 → 中文（与 AI 员工中心一致的 allowlist 键名，非原始职责文案）。
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
export const permKeyLabel = (k: string): string => KEY_LABELS[k] ?? k;

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

// 单实例绑定的 AI 员工（按可见实例 id 归一化，供监控墙 tile / 单实例工作台复用）。
export interface InstanceEmployee {
  bound: boolean;
  name: string; // 岗位助理 ···suffix（脱敏，非员工原始姓名）
  role: string; // 售前 / 售后 / 复购 / 群运营 或 ''
  glyph: string;
  statusText: string;
  statusCls: string; // st-on / st-warn / st-off
  permissionKeys: string[]; // allowlist 键（安全），供渲染中文 chips
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
  instanceEmployees: Record<string, InstanceEmployee>; // 按可见实例 id
}

interface Core {
  customers: CrmCustomer[];
  pendingCounts: Record<string, number>;
  pendingTotal: number;
  actions: ApprovalAction[];
  instanceEmployees: Record<string, InstanceEmployee>;
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

  // 单实例 → 绑定员工（仅命中可见实例的绑定，键为 WOC 实例 id）。
  const instanceEmployees: Record<string, InstanceEmployee> = {};
  for (const ic of c.instance_cards) {
    const woc = ic.woc_instance_id ? wocById.get(ic.woc_instance_id) ?? null : null;
    if (!woc) continue;
    const empId = ic.bound_employee_ids[0];
    const emp = empId != null ? c.employee_cards.find((e) => e.employee_id === empId) : undefined;
    const roleCn = emp ? label(ROLE_LABELS, emp.role) : '';
    instanceEmployees[woc.id] = {
      bound: !!emp,
      role: roleCn,
      glyph: ROLE_GLYPH[roleCn] ?? '🤖',
      name: emp ? `${roleCn}助理${emp.name_suffix ? ' ···' + emp.name_suffix : ''}` : '未分配',
      statusText: emp ? (emp.status === 'active' ? '在岗' : emp.status === 'paused' ? '暂停' : emp.status) : '未绑定',
      statusCls: emp ? (emp.status === 'active' ? 'st-on' : emp.status === 'paused' ? 'st-warn' : 'st-off') : 'st-off',
      permissionKeys: ic.permission_keys ?? [],
    };
  }
  return { customers, pendingCounts, pendingTotal, actions, instanceEmployees };
}

const DEMO_PERMS = ['read_history', 'auto_reply', 'send_message', 'contact_remark', 'group_operation', 'memory_write', 'profile_update'];

function buildDemo(instances: InstanceWithStatus[]): Core {
  const customers: CrmCustomer[] = [];
  const slots: Slot[] = [];
  const instanceEmployees: Record<string, InstanceEmployee> = {};
  instances.forEach((inst, i) => {
    const role = ROLES[i % ROLES.length];
    const empName = `${role}助理`;
    slots.push({ instName: inst.name, instId: inst.id, empName });
    const bound = seedOf(inst.id + ':ai') % 10 >= 2; // ~80% 绑定，deterministic
    const online = inst.runtime === 'running' && inst.wechat.installed && inst.proxyEnabled !== false;
    instanceEmployees[inst.id] = {
      bound,
      role: bound ? role : '',
      glyph: bound ? ROLE_GLYPH[role] ?? '🤖' : '🤖',
      name: bound ? empName : '未分配',
      statusText: bound ? (online ? '在岗' : '待岗') : '未绑定',
      statusCls: bound ? (online ? 'st-on' : 'st-warn') : 'st-off',
      permissionKeys: bound ? DEMO_PERMS.slice(0, 2 + (seedOf(inst.id + ':perm') % 4)) : [],
    };
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
  return { customers, pendingCounts, pendingTotal, actions, instanceEmployees };
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

// ==================== 单实例派生视图（监控墙 tile / 单实例工作台复用） ====================
// 全部只读、安全：从共享模型按实例 id 过滤客户 / 待确认，按实例状态派生风险 / 时间线 / AI 判断文案，
// 绝不产出聊天正文、回复原文、token。

export function getInstanceEmployee(m: AiConsoleModel, instId: string | null | undefined): InstanceEmployee | null {
  return instId ? m.instanceEmployees[instId] ?? null : null;
}
export function getInstanceCustomers(m: AiConsoleModel, instId: string | null | undefined): CrmCustomer[] {
  if (!instId) return [];
  return m.customers.filter((c) => c.instId === instId).sort((a, b) => (b.intent ?? 0) - (a.intent ?? 0));
}
export function getInstanceApprovals(m: AiConsoleModel, instId: string | null | undefined): ApprovalAction[] {
  if (!instId) return [];
  return m.actions.filter((a) => a.instId === instId);
}

export function instanceAbnormal(inst: InstanceWithStatus): boolean {
  return inst.runtime !== 'running' || !inst.wechat.installed || inst.wechat.phase === 'error' || inst.proxyEnabled === false;
}
export function instanceOnline(inst: InstanceWithStatus): boolean {
  return inst.runtime === 'running' && inst.wechat.installed && inst.proxyEnabled !== false;
}
// 未读：deterministic 占位（安全 fallback），实例不可用时恒为 0。
export function getInstanceUnread(inst: InstanceWithStatus): number {
  if (!instanceOnline(inst)) return 0;
  const n = seedOf(inst.id + ':unread') % 7;
  return n > 4 ? n - 4 : 0;
}

export interface InstanceBadge {
  key: string;
  label: string;
  tone: 'ok' | 'warn' | 'danger';
}
export interface InstanceRiskSummary {
  customers: number;
  highRisk: number;
  highIntent: number;
  pending: number;
  unread: number;
  abnormal: boolean;
  needsTakeover: boolean;
  badges: InstanceBadge[];
}
export function getInstanceRiskSummary(m: AiConsoleModel, inst: InstanceWithStatus): InstanceRiskSummary {
  const custs = getInstanceCustomers(m, inst.id);
  const highRisk = custs.filter((c) => c.risk === 'high').length;
  const highIntent = custs.filter((c) => c.highIntent).length;
  const pending = getInstanceApprovals(m, inst.id).length;
  const unread = getInstanceUnread(inst);
  const abnormal = instanceAbnormal(inst);
  const badges: InstanceBadge[] = [
    inst.proxyEnabled === false
      ? { key: 'proxy', label: '代理未启用', tone: 'danger' }
      : { key: 'proxy', label: '代理正常', tone: 'ok' },
    inst.wechat.installed
      ? { key: 'app', label: '应用就绪', tone: 'ok' }
      : { key: 'app', label: inst.wechat.phase === 'error' ? '安装异常' : '待安装', tone: inst.wechat.phase === 'error' ? 'danger' : 'warn' },
    inst.runtime === 'running'
      ? { key: 'run', label: '运行中', tone: 'ok' }
      : { key: 'run', label: inst.runtime === 'missing' ? '未创建' : '已停止', tone: 'danger' },
  ];
  return { customers: custs.length, highRisk, highIntent, pending, unread, abnormal, needsTakeover: abnormal || highRisk > 0 || pending > 0, badges };
}

function deriveInstanceDecision(inst: InstanceWithStatus, top: CrmCustomer | null, risk: InstanceRiskSummary): string {
  if (instanceAbnormal(inst)) {
    if (inst.proxyEnabled === false) return '实例未启用代理，AI 已暂停自动动作；请先在「系统设置」配置代理并重启后再接管。';
    if (inst.runtime !== 'running') return '实例未在运行，AI 值守已暂停；启动实例后可恢复接待。';
    return '实例状态异常，AI 暂缓自动外发，建议人工检查后再恢复。';
  }
  if (risk.highRisk > 0) return `检测到 ${risk.highRisk} 位高风险客户，建议人工优先介入安抚，敏感动作转人工确认。`;
  if (risk.pending > 0) return `有 ${risk.pending} 个待确认动作等待人工复核，确认后 AI 才会落地执行。`;
  if (top && top.highIntent) return '存在高意向客户，建议 24 小时内跟进报价 / 促成；报价与承诺口径转人工确认。';
  return 'AI 正常值守，持续接待并沉淀客户画像；敏感动作会进入待确认队列等待你确认。';
}

export interface InstanceTimelineStep {
  key: string;
  label: string;
  detail: string;
  cls: string; // st-on / st-busy / st-warn / ''
}
export function getInstanceTimeline(m: AiConsoleModel, inst: InstanceWithStatus): InstanceTimelineStep[] {
  const online = instanceOnline(inst);
  const custs = getInstanceCustomers(m, inst.id);
  const risk = getInstanceRiskSummary(m, inst);
  return [
    { key: 'ocr', label: 'OCR 历史补全', detail: online ? '已同步聊天窗口截图，抽取安全字段' : '实例就绪后开始补全', cls: online ? 'st-on' : '' },
    { key: 'profile', label: '客户画像抽取', detail: custs.length ? `已沉淀 ${custs.length} 位客户画像` : '暂无客户画像', cls: custs.length ? 'st-on' : '' },
    { key: 'draft', label: '起草回复', detail: online ? 'AI 起草回复草稿，敏感内容转人工确认' : '待实例上线后起草', cls: online ? 'st-busy' : '' },
    { key: 'approval', label: '待确认', detail: risk.pending ? `${risk.pending} 个动作等待人工确认` : '暂无待确认动作', cls: risk.pending ? 'st-warn' : 'st-on' },
    { key: 'takeover', label: '人工接管', detail: risk.needsTakeover ? '建议人工接管处理' : 'AI 值守中，可随时接管', cls: risk.needsTakeover ? 'st-warn' : '' },
  ];
}

export interface InstanceAiContext {
  employee: InstanceEmployee | null;
  topCustomer: CrmCustomer | null;
  customerCount: number;
  risk: InstanceRiskSummary;
  decision: string;
  timeline: InstanceTimelineStep[];
}
export function getInstanceAiContext(m: AiConsoleModel, inst: InstanceWithStatus): InstanceAiContext {
  const employee = getInstanceEmployee(m, inst.id);
  const custs = getInstanceCustomers(m, inst.id);
  const topCustomer = custs[0] ?? null;
  const risk = getInstanceRiskSummary(m, inst);
  return {
    employee,
    topCustomer,
    customerCount: custs.length,
    risk,
    decision: deriveInstanceDecision(inst, topCustomer, risk),
    timeline: getInstanceTimeline(m, inst),
  };
}
