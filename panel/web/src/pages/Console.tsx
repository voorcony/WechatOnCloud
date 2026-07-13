import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances, statusOf } from '../AppShell';
import { api, type InstanceWithStatus, type AiConsolePayload, type AiEmployeeConsoleResponse } from '../api';

// 总览（AI Console 首页）—— 完全对标模板 Dashboard：
//   4 KPI 卡 + (消息吞吐图 · 实例健康矩阵) + (待确认 · 今日任务 · 事件流) + AI 员工在岗。
// 数据来源：useInstances 真实实例 + /api/ai-employees/console 真实只读快照（失败回退 deterministic 演示）。
// 安全：只展示计数 / 脱敏摘要 / hash；不显示聊天正文、token、reply 原文、知识库原始标题。

// 侧栏同款「总览」图标，供 AppShell 旧侧栏复用。
export const ConsoleIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="8" height="9" rx="2" />
    <rect x="13" y="3" width="8" height="5" rx="2" />
    <rect x="13" y="11" width="8" height="10" rx="2" />
    <rect x="3" y="15" width="8" height="6" rx="2" />
  </svg>
);

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + (b || 0), 0);
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

const ROLE_LABELS: Record<string, string> = { pre_sales: '售前', after_sales: '售后', retention: '复购', group_ops: '群运营' };
const RUN_TYPE_LABELS: Record<string, string> = { message_ingest: '接入客户消息', reply_suggest: '起草回复', approval_wait: '等待人工确认' };
const TASK_TYPE_LABELS: Record<string, string> = { high_intent_summary: '高意向汇总', reply_customer: '回复客户', daily_report: '生成日报' };
const RUN_STATUS: Record<string, { t: string; cls: string }> = {
  running: { t: '进行中', cls: 'st-busy' },
  completed: { t: '已完成', cls: 'st-on' },
  failed: { t: '失败', cls: 'st-off' },
  skipped: { t: '跳过', cls: '' },
};
const label = (m: Record<string, string>, k: string): string => m[k] ?? k;
const ROLES = ['售前', '售后', '复购', '群运营'] as const;

interface TimelineItem { key: string; emp: string; act: string; inst: string; summary: string; status: { t: string; cls: string }; ago: string; }
interface EmpRow { key: string; name: string; role: string; statusText: string; statusCls: string; tasks: number; runs: number; }
interface CustomerRow { key: string; code: string; inst: string; stage: string; intent: number | null; risk: 'high' | 'medium' | 'low'; messages: number; ago: string; }
interface PendingRow { key: string; label: string; value: number; }

function stageLabel(stage: string | null): string {
  const map: Record<string, string> = { high_intent: '高意向', browsing: '了解中', after_sales: '售后', risk: '风险' };
  return stage ? map[stage] ?? stage : '待培育';
}
function riskOf(risk: string | null): 'high' | 'medium' | 'low' {
  if (risk === 'high') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}

// 生成一条填充折线（模板消息吞吐图）。points 为 0..100 高度序列。
function areaPath(points: number[], w: number, h: number, pad: number): { area: string; line: string } {
  const step = (w - pad * 2) / (points.length - 1);
  const y = (v: number) => h - 6 - (v / 100) * (h - 18);
  let line = `M ${pad} ${y(points[0])}`;
  for (let i = 1; i < points.length; i++) line += ` L ${pad + step * i} ${y(points[i])}`;
  const area = `${line} L ${pad + step * (points.length - 1)} ${h} L ${pad} ${h} Z`;
  return { area, line };
}

export default function Console({ onChangePassword }: { onOpenMenu?: () => void; onChangePassword?: () => void }) {
  const { user } = useAuth();
  const { instances, loaded } = useInstances();
  const nav = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [resp, setResp] = useState<AiEmployeeConsoleResponse | null>(null);
  const [probed, setProbed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.aiEmployeeConsole().then((r) => alive && setResp(r)).catch(() => alive && setResp(null)).finally(() => alive && setProbed(true));
    return () => { alive = false; };
  }, []);

  const real = resp?.mode === 'real' && resp.console.found ? resp.console : null;
  const wocById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);
  const online = instances.filter((i) => statusOf(i).cls === 'st-on').length;
  const abnormalInsts = instances.filter((i) => i.runtime !== 'running' || !i.wechat.installed || i.wechat.phase === 'error' || i.proxyEnabled === false);
  const abnormal = abnormalInsts.length;
  const model = useMemo(() => (real ? buildReal(real, wocById) : buildDemo(instances)), [real, wocById, instances]);

  const empty = loaded && instances.length === 0;
  const dataReady = loaded && probed;
  const autoRate = model.messages ? Math.round((model.handled / model.messages) * 100) : 0;
  const chart = areaPath([28, 40, 44, 52, 60, 78, 92], 600, 180, 18);
  const chart2 = areaPath([16, 26, 30, 40, 46, 58, 70], 600, 180, 18);

  return (
    <div>
      <div className="page-h">
        <div>
          <h1>总览</h1>
          <p>所有微信实例、AI 员工、待办与成本的实时概览。</p>
        </div>
        <div className="act">
          <button className="btn" disabled title="报表导出即将上线">导出报表</button>
          {isAdmin && <button className="btn primary" onClick={() => nav('/admin')}>+ 新建实例</button>}
        </div>
      </div>

      {probed && (
        real ? (
          <div className="src-note real"><span className="d" /> 已接入真实 AI 员工数据 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）</div>
        ) : (
          <div className="src-note demo"><span className="d" /> 演示数据：尚未配置 AI 员工数据源。实例在线 / 异常为真实状态，其余为占位演示。</div>
        )
      )}

      {user?.mustChangePassword && (
        <button className="warn-banner" onClick={() => onChangePassword?.()}>
          <span className="warn-icon">!</span>
          <span className="warn-text">
            <b>你还在使用默认密码</b>
            <span>该系统登录着你的微信，请立即修改密码 ›</span>
          </span>
        </button>
      )}

      {empty ? (
        <ConsoleEmpty isAdmin={isAdmin} onManage={() => nav('/admin')} />
      ) : !dataReady ? (
        <div className="loading">加载总览…</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="label">微信实例</div>
              <div className="value">{online}/{instances.length}</div>
              <div className={'delta' + (online ? '' : ' muted')}>已挂载 {model.activeEmployees} 个 AI 员工</div>
            </div>
            <div className="kpi">
              <div className="label">今日消息吞吐</div>
              <div className="value">{model.messages.toLocaleString()}</div>
              <div className="delta">AI 已自动处理 {model.handled.toLocaleString()} 条</div>
            </div>
            <div className="kpi">
              <div className="label">AI 自治回复率</div>
              <div className="value">{autoRate}%</div>
              <div className="delta">高意向客户 {model.highIntent} 位</div>
            </div>
            <div className="kpi">
              <div className="label">待确认 / 异常</div>
              <div className="value">{model.pendingTotal}</div>
              <div className={'delta' + (abnormal ? ' down' : '')}>{abnormal ? `${abnormal} 个实例需接管` : '需人工审核的动作'}</div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-h">
                <span className="title">最近 7 天消息吞吐</span>
                <div className="row" style={{ marginLeft: 'auto', gap: 4 }}>
                  <span className="chip brand">AI 自动回复</span>
                  <span className="chip outline">人工回复</span>
                </div>
              </div>
              <div className="card-b">
                <svg viewBox="0 0 600 180" width="100%" height="180" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="acg1" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity=".35" />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={chart.area} fill="url(#acg1)" />
                  <path d={chart.line} fill="none" stroke="var(--brand)" strokeWidth="2" />
                  <path d={chart2.line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 4" />
                  <line x1="0" y1="180" x2="600" y2="180" stroke="var(--line)" />
                  {[1, 2, 3, 4, 5, 6, 7].map((d, i) => (
                    <text key={d} x={18 + i * ((600 - 36) / 6)} y="176" textAnchor="middle" fontSize="10" fill="var(--text-3)">D{d}</text>
                  ))}
                </svg>
              </div>
            </div>
            <div className="card">
              <div className="card-h"><span className="title">实例健康矩阵</span></div>
              <div className="card-b tight">
                {instances.length === 0 ? (
                  <div className="dim" style={{ padding: 8 }}>暂无实例</div>
                ) : instances.map((inst) => {
                  const st = statusOf(inst);
                  const pct = st.cls === 'st-on' ? 62 + (seedOf(inst.id) % 36) : st.cls === 'st-warn' ? 40 : 6;
                  return (
                    <button key={inst.id} className="bar-row" style={{ width: '100%', background: 'transparent', border: 0, cursor: 'pointer' }} onClick={() => nav(`/i/${inst.id}`)}>
                      <span className="lbl cut">{inst.name}</span>
                      <div className="bar"><div className={'fill' + (st.cls === 'st-off' ? ' off' : '')} style={{ width: pct + '%' }} /></div>
                      <span className="val"><span className={'dot ' + st.cls} /> {st.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid-3">
            <CardList title="待确认动作" action={{ text: '前往处理 ›', onClick: () => nav('/approvals') }}>
              {model.pendingTotal === 0 ? (
                <div className="dim" style={{ padding: 8 }}>当前没有等待确认的动作 🎉</div>
              ) : model.pending.filter((p) => p.value > 0).map((p) => (
                <div key={p.key} className="bar-row">
                  <span className="risk-dot" style={{ width: 6, height: 6, borderRadius: 50, background: 'var(--warn)' }} />
                  <div className="grow"><div style={{ fontSize: 13 }}>{p.label}</div></div>
                  <span className="chip warn">{p.value}</span>
                </div>
              ))}
            </CardList>

            <CardList title="今日任务" action={{ text: 'AI 员工中心 ›', onClick: () => nav('/ai-employees') }}>
              {model.taskBuckets.length === 0 ? (
                <div className="dim" style={{ padding: 8 }}>今日暂无任务记录。</div>
              ) : model.taskBuckets.map((t) => (
                <div key={t.key} className="bar-row">
                  <span className={'dot ' + t.cls} />
                  <div className="grow"><div style={{ fontSize: 13 }}>{t.label}</div></div>
                  <span className="chip">{t.value}</span>
                </div>
              ))}
            </CardList>

            <CardList title="事件流">
              {model.timeline.length === 0 ? (
                <div className="dim" style={{ padding: 8 }}>暂无运行记录。</div>
              ) : (
                <div className="timeline">
                  {model.timeline.slice(0, 6).map((it) => (
                    <div key={it.key} className="ti">
                      <div className="d"><div className="dotline" /><div className={'p ' + it.status.cls} /></div>
                      <div className="body">
                        <div className="w"><b>{it.emp}</b> {it.act} <span className="dim">@{it.inst}</span></div>
                        <div className="t">
                          <span className={'chip ' + (it.status.cls === 'st-warn' ? 'warn' : it.status.cls === 'st-off' ? 'danger' : 'brand')}>{it.status.t}</span>
                          {it.ago && <span>{it.ago}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardList>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h">
              <span className="title">AI 员工在岗</span>
              <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => nav('/ai-employees')}>进入 AI 员工中心 ›</button>
            </div>
            <div className="card-b">
              {model.employees.length === 0 ? (
                <div className="dim">暂无 AI 员工。绑定大秘书后即可为实例分配岗位。</div>
              ) : (
                <div className="agent-grid">
                  {model.employees.slice(0, 6).map((e) => (
                    <div key={e.key} className="agent-card" onClick={() => nav('/ai-employees')}>
                      <div className="row1">
                        <div className="emoji">🤖</div>
                        <div className="info">
                          <div className="name">{e.name}</div>
                          <div className="role">{e.role || 'AI 员工'}</div>
                        </div>
                        <span className={'chip ' + (e.statusCls === 'st-on' ? 'brand' : 'warn')} style={{ marginLeft: 'auto' }}>
                          <span className={'dot ' + e.statusCls} /> {e.statusText}
                        </span>
                      </div>
                      <div className="row2">
                        <span className="chip outline">任务 {e.tasks}</span>
                        <span className="chip outline">运行 {e.runs}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {model.customers.length > 0 && (
            <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
              <div className="card-h">
                <span className="title">高意向客户</span>
                <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => nav('/customers')}>查看全部 ›</button>
              </div>
              <table className="t">
                <thead><tr><th>客户</th><th>阶段</th><th>意向</th><th>风险</th><th>互动</th><th>最近</th></tr></thead>
                <tbody>
                  {model.customers.slice(0, 5).map((c) => (
                    <tr key={c.key}>
                      <td><div className="row"><span className="avatar accent">{c.code.slice(0, 2)}</span><b>客户 {c.code}</b></div></td>
                      <td>{stageLabel(c.stage)}</td>
                      <td className="mono">{c.intent ?? '—'}</td>
                      <td><span className={'chip ' + (c.risk === 'high' ? 'danger' : c.risk === 'medium' ? 'warn' : 'brand')}>{c.risk === 'high' ? '高' : c.risk === 'medium' ? '中' : '低'}</span></td>
                      <td className="mono">{c.messages}</td>
                      <td><span className="dim">{c.ago}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardList({ title, action, children }: { title: string; action?: { text: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="title">{title}</span>
        {action && <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={action.onClick}>{action.text}</button>}
      </div>
      <div className="card-b tight">{children}</div>
    </div>
  );
}

function ConsoleEmpty({ isAdmin, onManage }: { isAdmin: boolean; onManage: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-blob">🤖</div>
      <div className="empty-title">{isAdmin ? '还没有微信实例' : '暂无被授权实例'}</div>
      <div className="empty-sub">
        {isAdmin
          ? 'AI 员工需要绑定到云微信实例才能开始工作，先去「实例·账号管理」新建一个实例。'
          : '请联系管理员为你分配实例，AI 员工的可操作范围即为你被授权的实例。'}
      </div>
      {isAdmin && <div className="empty-action"><button className="btn primary" onClick={onManage}>去新建实例</button></div>}
    </div>
  );
}

// ==================== 数据建模（安全字段） ====================
interface ConsoleModel {
  messages: number; handled: number; pendingTotal: number; highIntent: number; activeEmployees: number; riskCustomers: number;
  employees: EmpRow[]; taskBuckets: { key: string; label: string; value: number; cls: string }[]; timeline: TimelineItem[]; pending: PendingRow[]; customers: CustomerRow[];
}

function buildReal(c: AiConsolePayload, wocById: Map<string, InstanceWithStatus>): ConsoleModel {
  const instName = (hashSuffix: string | null, wocId: string | null): string => {
    const inst = wocId ? wocById.get(wocId) : undefined;
    if (inst) return inst.name;
    return hashSuffix ? `···${hashSuffix}` : '未关联';
  };
  const roleOf = (id: number): string => {
    const e = c.employee_cards.find((x) => x.employee_id === id);
    return e ? label(ROLE_LABELS, e.role) : '';
  };
  const employees: EmpRow[] = c.employee_cards.map((e) => ({
    key: String(e.employee_id),
    name: `${label(ROLE_LABELS, e.role)}助理${e.name_suffix ? ' ···' + e.name_suffix : ''}`,
    role: label(ROLE_LABELS, e.role),
    statusText: e.status === 'active' ? '在岗' : e.status === 'paused' ? '暂停' : e.status,
    statusCls: e.status === 'active' ? 'st-on' : e.status === 'paused' ? 'st-warn' : 'st-off',
    tasks: sumCounts(e.task_counts),
    runs: sumCounts(e.run_counts),
  }));
  const timeline: TimelineItem[] = c.recent_runs.slice().sort((a, b) => (b.started_at || '').localeCompare(a.started_at || '')).map((r) => ({
    key: String(r.run_id),
    emp: `${roleOf(r.employee_id)}助理`,
    act: label(RUN_TYPE_LABELS, r.run_type),
    inst: instName(r.instance_id_suffix, r.woc_instance_id),
    summary: r.redacted_summary || '',
    status: RUN_STATUS[r.status] ?? { t: r.status, cls: '' },
    ago: timeAgo(r.started_at),
  }));
  const byType = new Map<string, number>();
  for (const t of c.recent_tasks) byType.set(t.task_type, (byType.get(t.task_type) || 0) + 1);
  const waitingByType = new Map<string, number>();
  for (const t of c.recent_tasks) if (t.status === 'waiting_approval') waitingByType.set(t.task_type, (waitingByType.get(t.task_type) || 0) + 1);
  const taskBuckets = [...byType.entries()].map(([k, v]) => ({ key: k, label: label(TASK_TYPE_LABELS, k), value: v, cls: waitingByType.get(k) ? 'st-warn' : 'st-on' }));
  const p = c.pending ?? {};
  const pending: PendingRow[] = [
    { key: 'reply', label: '回复待人工', value: p.reply_jobs_needs_human ?? 0 },
    { key: 'task', label: '员工任务待人审', value: p.employee_tasks_waiting_approval ?? 0 },
    { key: 'send', label: '计划发送', value: p.send_actions_planned ?? 0 },
    { key: 'remark', label: '计划改备注', value: p.contact_remark_actions_planned ?? 0 },
    { key: 'group', label: '计划群操作', value: p.group_operation_actions_planned ?? 0 },
  ];
  const pendingTotal = p.pending_total ?? pending.reduce((s, r) => s + r.value, 0);
  const highIntentCards = c.customer_cards.filter((x) => x.profile_stage === 'high_intent' || (x.profile_intent_score ?? 0) >= 70);
  const customers: CustomerRow[] = c.customer_cards.slice().sort((a, b) => (b.profile_intent_score ?? 0) - (a.profile_intent_score ?? 0)).map((x) => ({
    key: x.conversation_key_hash,
    code: x.conversation_key_hash.slice(0, 6),
    inst: instName(x.instance_id_suffix, null),
    stage: x.profile_stage ?? '',
    intent: x.profile_intent_score,
    risk: riskOf(x.profile_risk_level),
    messages: x.message_count,
    ago: timeAgo(x.latest_observed_at),
  }));
  return {
    messages: c.customer_cards.reduce((s, x) => s + x.message_count, 0),
    handled: c.employee_cards.reduce((s, e) => s + sumCounts(e.run_counts), 0),
    pendingTotal,
    highIntent: highIntentCards.length,
    activeEmployees: c.employee_cards.filter((e) => e.status === 'active').length,
    riskCustomers: c.customer_cards.filter((x) => x.profile_risk_level === 'high').length,
    employees, taskBuckets, timeline, pending, customers,
  };
}

function buildDemo(instances: InstanceWithStatus[]): ConsoleModel {
  const employees: EmpRow[] = instances.map((inst, i) => {
    const role = ROLES[i % ROLES.length];
    const st = statusOf(inst);
    return {
      key: inst.id,
      name: `${role}助理`,
      role,
      statusText: st.cls === 'st-on' ? '在岗' : st.text,
      statusCls: st.cls === 'st-on' ? 'st-on' : 'st-warn',
      tasks: 2 + (seedOf(inst.id + ':t') % 9),
      runs: 6 + (seedOf(inst.id + ':r') % 40),
    };
  });
  const acts = ['接入客户消息', '起草回复（待确认）', '路由到对应岗位', '沉淀客户画像', '生成社群日报'];
  const statuses: { t: string; cls: string }[] = [
    { t: '已完成', cls: 'st-on' },
    { t: '进行中', cls: 'st-busy' },
    { t: '待确认', cls: 'st-warn' },
  ];
  const timeline: TimelineItem[] = instances.slice(0, 8).map((inst, i) => {
    const seed = seedOf(inst.id + ':tl' + i);
    const role = ROLES[i % ROLES.length];
    return {
      key: inst.id + i,
      emp: `${role}助理`,
      act: acts[seed % acts.length],
      inst: inst.name,
      summary: `会话 ···${(seed * 7919).toString(16).slice(0, 4)}`,
      status: statuses[seed % statuses.length],
      ago: `${1 + (seed % 57)} 分钟前`,
    };
  });
  const customers: CustomerRow[] = instances.slice(0, 6).map((inst, i) => {
    const seed = seedOf(inst.id + ':c' + i);
    const risk: 'high' | 'medium' | 'low' = seed % 7 === 0 ? 'high' : seed % 3 === 0 ? 'medium' : 'low';
    return {
      key: inst.id + 'c',
      code: 'A' + (100 + (seed % 800)),
      inst: inst.name,
      stage: 'high_intent',
      intent: 62 + (seed % 38),
      risk,
      messages: 8 + (seed % 30),
      ago: `${1 + (seed % 40)} 分钟前`,
    };
  });
  customers.sort((a, b) => (b.intent ?? 0) - (a.intent ?? 0));
  const messages = instances.reduce((s, i) => s + 40 + (seedOf(i.id) % 160), 0);
  const handled = Math.round(messages * 0.72);
  const pendingTotal = instances.length ? (seedOf(instances.map((i) => i.id).join()) % 5) + 1 : 0;
  const pending: PendingRow[] = [
    { key: 'reply', label: '回复待人工', value: instances.length ? (seedOf('reply') % 3) + (pendingTotal > 2 ? 1 : 0) : 0 },
    { key: 'send', label: '计划发送', value: instances.length ? seedOf('send' + instances.length) % 2 : 0 },
    { key: 'task', label: '员工任务待人审', value: instances.length ? seedOf('task') % 2 : 0 },
  ];
  const taskKinds = ['首次咨询回复', '订单跟进', '售后回访', '复购唤醒', '社群日报'];
  const taskBuckets = taskKinds.map((k, i) => ({ key: k, label: k, value: instances.length ? 1 + (seedOf(k + instances.length) % 6) : 0, cls: i === 1 ? 'st-warn' : 'st-on' }));
  return {
    messages, handled, pendingTotal,
    highIntent: instances.length ? 2 + (seedOf('hi' + instances.length) % 6) : 0,
    activeEmployees: employees.filter((e) => e.statusCls === 'st-on').length,
    riskCustomers: customers.filter((c) => c.risk === 'high').length,
    employees, taskBuckets, timeline, pending, customers,
  };
}
