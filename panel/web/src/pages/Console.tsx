import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances, statusOf, ThemeToggle } from '../AppShell';
import { api, appProfile, type InstanceWithStatus, type AiConsolePayload, type AiEmployeeConsoleResponse } from '../api';
import { InstanceIcon } from '../AppIcon';

// 总控台（AI WeChat Console 首页）
// 定位：打开 /wechat/woc/ 第一眼就是「AI 私域员工运营后台」，而不是云微信实例面板。
// 回答五个问题：今天 AI 员工干了什么 / 哪些微信在线 / 哪些客户要处理 / 哪些动作等我确认 / 哪里要接管。
//
// 数据来源：
//   - useInstances()：真实可见实例（在线 / 异常 / 健康概览恒为真值）。
//   - /api/ai-employees/console：真实只读快照（已按可见实例过滤 + 字段 allowlist），失败回退演示。
//   - 演示数据全部 deterministic（seedOf 派生），保证不跳动。
// 安全：只展示计数 / 脱敏摘要 / hash；绝不显示聊天正文、token、reply 原文、知识库原始标题。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

// 侧栏同款「总控台」图标，供 AppShell 复用。
export const ConsoleIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="8" height="9" rx="2" />
    <rect x="13" y="3" width="8" height="5" rx="2" />
    <rect x="13" y="11" width="8" height="10" rx="2" />
    <rect x="3" y="15" width="8" height="6" rx="2" />
  </svg>
);

// deterministic 伪随机（按字符串派生），保证演示数字稳定不跳动
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

interface Kpi {
  key: string;
  label: string;
  value: number | string;
  hint: string;
  tone?: 'accent' | 'warn' | 'danger' | 'ok';
}

interface TimelineItem {
  key: string;
  emp: string;
  act: string;
  inst: string;
  summary: string;
  status: { t: string; cls: string };
  ago: string;
}

interface EmpRow {
  key: string;
  name: string;
  role: string;
  statusText: string;
  statusCls: string;
  tasks: number;
  runs: number;
}

interface CustomerRow {
  key: string;
  code: string;
  inst: string;
  stage: string;
  intent: number | null;
  risk: 'high' | 'medium' | 'low';
  messages: number;
  ago: string;
}

interface PendingRow {
  key: string;
  label: string;
  value: number;
}

function stageLabel(stage: string | null): string {
  const map: Record<string, string> = { high_intent: '高意向', browsing: '了解中', after_sales: '售后', risk: '风险' };
  return stage ? map[stage] ?? stage : '待培育';
}
function riskOf(risk: string | null): 'high' | 'medium' | 'low' {
  if (risk === 'high') return 'high';
  if (risk === 'medium') return 'medium';
  return 'low';
}

export default function Console({ onOpenMenu, onChangePassword }: { onOpenMenu: () => void; onChangePassword: () => void }) {
  const { user } = useAuth();
  const { instances, loaded } = useInstances();
  const nav = useNavigate();
  const isAdmin = user?.role === 'admin';

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

  // ---- 实例维度（恒为真值）----
  const online = instances.filter((i) => statusOf(i).cls === 'st-on').length;
  const abnormalInsts = instances.filter((i) => i.runtime !== 'running' || !i.wechat.installed || i.wechat.phase === 'error' || i.proxyEnabled === false);
  const abnormal = abnormalInsts.length;

  // ---- KPI / 各面板数据：真实优先，否则 deterministic 演示 ----
  const model = useMemo(
    () => (real ? buildReal(real, wocById, instances) : buildDemo(instances)),
    [real, wocById, instances],
  );

  const kpis: Kpi[] = [
    { key: 'msg', label: '今日消息', value: model.messages, hint: '客户往来消息量', tone: 'accent' },
    { key: 'ai', label: 'AI 处理', value: model.handled, hint: 'AI 员工自动完成的运行', tone: 'ok' },
    { key: 'pending', label: '待确认', value: model.pendingTotal, hint: '等待你确认的动作', tone: model.pendingTotal ? 'warn' : undefined },
    { key: 'online', label: '在线微信', value: `${online}/${instances.length}`, hint: '在线 / 可见实例', tone: online ? 'ok' : undefined },
    { key: 'hi', label: '高意向客户', value: model.highIntent, hint: '需优先跟进的客户', tone: model.highIntent ? 'accent' : undefined },
    { key: 'risk', label: '异常', value: abnormal, hint: '需要接管的实例', tone: abnormal ? 'danger' : undefined },
  ];

  const empty = loaded && instances.length === 0;
  const dataReady = loaded && probed;

  return (
    <div className="ws-page con-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">总控台</span>
        <ThemeToggle />
      </header>

      <div className="content console">
        <section className="con-hero">
          <div className="con-hero-main">
            <div className="con-hero-eyebrow">AI WeChat Console</div>
            <h1 className="con-hero-title">24/7 私域 AI 员工团队</h1>
            <p className="con-hero-sub">
              你好，<b>{user?.username}</b>
              {isAdmin && <span className="con-hero-tag">管理员</span>}
              ｜ AI 员工正在你授权的微信实例上接待客户、沉淀画像、起草回复，重要动作留给你确认。
            </p>
          </div>
          <div className="con-hero-side">
            <div className="con-hero-stat">
              <b>{model.activeEmployees}</b>
              <span>AI 员工在岗</span>
            </div>
            <div className="con-hero-divider" />
            <div className="con-hero-stat">
              <b className={online ? 'ok' : ''}>{online}</b>
              <span>微信在线</span>
            </div>
          </div>
        </section>

        {probed &&
          (real ? (
            <div className="con-src con-src-real">
              <span className="con-src-dot" /> 已接入真实 AI 员工数据 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）
            </div>
          ) : (
            <div className="con-src con-src-demo">
              <span className="con-src-dot" /> 演示数据：尚未配置 AI 员工数据源。实例在线 / 异常 / 健康概览为真实状态，其余为占位演示。
            </div>
          ))}

        {user?.mustChangePassword && (
          <button className="warn-banner" onClick={onChangePassword}>
            <span className="warn-icon">!</span>
            <span className="warn-text">
              <b>你还在使用默认密码</b>
              <span>该系统登录着你的微信，请立即修改密码 ›</span>
            </span>
          </button>
        )}

        <div className="con-kpis">
          {kpis.map((k) => (
            <div key={k.key} className={'con-kpi' + (k.tone ? ' con-kpi-' + k.tone : '')}>
              <span className="con-kpi-val">{k.value}</span>
              <span className="con-kpi-lbl">{k.label}</span>
              <span className="con-kpi-hint">{k.hint}</span>
            </div>
          ))}
        </div>

        {empty ? (
          <ConsoleEmpty isAdmin={isAdmin} onManage={() => nav('/admin')} />
        ) : !dataReady ? (
          <div className="con-loading">加载总控台…</div>
        ) : (
          <>
            <div className="con-grid">
              {/* 左：AI 员工在岗 + 今日任务 */}
              <div className="con-col">
                <PanelCard
                  title="AI 员工在岗"
                  action={{ text: '进入 AI 员工中心 ›', onClick: () => nav('/ai-employees') }}
                >
                  {model.employees.length === 0 ? (
                    <div className="con-hollow">暂无 AI 员工。绑定大秘书后即可为实例分配岗位。</div>
                  ) : (
                    <div className="con-emp-list">
                      {model.employees.slice(0, 6).map((e) => (
                        <div key={e.key} className="con-emp">
                          <span className={'con-emp-dot ' + e.statusCls} />
                          <div className="con-emp-id">
                            <span className="con-emp-name">{e.name}</span>
                            <span className={'ai-role ai-role-' + e.role}>{e.role}</span>
                          </div>
                          <div className="con-emp-stat">
                            <span>{e.statusText}</span>
                            <small>任务 {e.tasks} · 运行 {e.runs}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </PanelCard>

                <PanelCard title="今日任务">
                  {model.taskBuckets.length === 0 ? (
                    <div className="con-hollow">今日暂无任务记录。</div>
                  ) : (
                    <div className="con-task-list">
                      {model.taskBuckets.map((t) => (
                        <div key={t.key} className="con-task">
                          <span className={'ai-dot ' + t.cls} />
                          <span className="con-task-name">{t.label}</span>
                          <span className="con-task-count">{t.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </PanelCard>
              </div>

              {/* 中：实时运营时间线 + 待确认动作 */}
              <div className="con-col">
                <div className="con-timeline-card">
                  <div className="con-panel-head con-panel-head-dark">
                    <span className="con-panel-title">实时运营时间线</span>
                    <span className="con-live"><i /> LIVE</span>
                  </div>
                  {model.timeline.length === 0 ? (
                    <div className="con-hollow con-hollow-dark">暂无运行记录。</div>
                  ) : (
                    <ul className="con-timeline">
                      {model.timeline.slice(0, 7).map((it) => (
                        <li key={it.key} className="con-tl">
                          <span className={'con-tl-dot ' + it.status.cls} />
                          <div className="con-tl-body">
                            <div className="con-tl-main">
                              <b>{it.emp}</b> {it.act}
                              <span className="con-tl-inst">@{it.inst}</span>
                            </div>
                            <div className="con-tl-meta">
                              <span className={'con-tl-badge ' + it.status.cls}>{it.status.t}</span>
                              {it.summary && <span className="con-tl-sum">{it.summary}</span>}
                              {it.ago && <span className="con-tl-ago">{it.ago}</span>}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <PanelCard
                  title="待确认动作"
                  action={{ text: '前往处理 ›', onClick: () => nav('/approvals') }}
                >
                  <div className="con-note">AI 起草的发送 / 改备注 / 群操作等敏感动作会在此排队，需你确认后才执行。总控台只读，不触发真实微信动作。</div>
                  {model.pending.length === 0 || model.pendingTotal === 0 ? (
                    <div className="con-hollow con-ok">当前没有等待确认的动作 🎉</div>
                  ) : (
                    <div className="con-pending">
                      {model.pending.filter((p) => p.value > 0).map((p) => (
                        <div key={p.key} className="con-pending-row">
                          <span className="con-pending-lbl">{p.label}</span>
                          <span className="con-pending-val">{p.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </PanelCard>
              </div>

              {/* 右：高意向客户 + 风险提醒 + 快捷入口 */}
              <div className="con-col">
                <PanelCard
                  title="高意向客户"
                  action={{ text: '查看全部 ›', onClick: () => nav('/customers') }}
                >
                  {model.customers.length === 0 ? (
                    <div className="con-hollow">暂无高意向客户画像。</div>
                  ) : (
                    <div className="con-cust-list">
                      {model.customers.slice(0, 4).map((c) => (
                        <div key={c.key} className="con-cust">
                          <span className={'con-cust-av risk-' + c.risk}>{c.code.slice(0, 2)}</span>
                          <div className="con-cust-id">
                            <span className="con-cust-name">客户 {c.code}</span>
                            <span className="con-cust-sub">{stageLabel(c.stage)} · {c.inst} · {c.ago}</span>
                          </div>
                          <div className="con-cust-intent">
                            <b>{c.intent ?? '—'}</b>
                            <small>意向</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </PanelCard>

                <PanelCard title="风险提醒">
                  {abnormal === 0 && model.riskCustomers === 0 ? (
                    <div className="con-hollow con-ok">一切正常，无需接管。</div>
                  ) : (
                    <div className="con-risk-list">
                      {abnormalInsts.slice(0, 4).map((i) => (
                        <button key={i.id} className="con-risk" onClick={() => nav(`/i/${i.id}`)}>
                          <span className="con-risk-dot" />
                          <div className="con-risk-id">
                            <span className="con-risk-name">{i.name}</span>
                            <span className="con-risk-sub">{riskReason(i)}</span>
                          </div>
                          <span className="con-risk-take">接管 ›</span>
                        </button>
                      ))}
                      {model.riskCustomers > 0 && (
                        <button className="con-risk" onClick={() => nav('/customers')}>
                          <span className="con-risk-dot warn" />
                          <div className="con-risk-id">
                            <span className="con-risk-name">{model.riskCustomers} 位客户标记风险</span>
                            <span className="con-risk-sub">建议人工介入跟进</span>
                          </div>
                          <span className="con-risk-take">查看 ›</span>
                        </button>
                      )}
                    </div>
                  )}
                </PanelCard>

                <PanelCard title="快捷入口">
                  <div className="con-quick">
                    <button className="con-quick-btn" onClick={() => nav('/ai-employees?tab=bind')}>
                      <span className="con-quick-ic">📲</span>绑定秘书
                    </button>
                    <button className="con-quick-btn" onClick={() => nav('/knowledge')}>
                      <span className="con-quick-ic">📚</span>导入知识库
                    </button>
                    <button className="con-quick-btn" onClick={() => nav('/tools')}>
                      <span className="con-quick-ic">🧩</span>工具与工作流
                    </button>
                    <button className="con-quick-btn" onClick={() => nav('/inbox')}>
                      <span className="con-quick-ic">💬</span>对话
                    </button>
                  </div>
                </PanelCard>
              </div>
            </div>

            {/* 底部：微信实例健康概览（底座能力，不再是主视觉）*/}
            <section className="con-base">
              <div className="con-base-head">
                <span className="con-base-title">微信实例健康概览</span>
                <span className="con-base-sub">AI 员工的底座 · {instances.length} 个实例 · {online} 在线{abnormal ? ` · ${abnormal} 异常` : ''}</span>
                <button className="btn-text" onClick={() => nav(abnormal ? '/monitor?filter=abnormal' : '/monitor')}>
                  {abnormal ? '监控墙看异常 ›' : '监控墙 ›'}
                </button>
                {isAdmin && (
                  <button className="btn-text" onClick={() => nav('/admin')}>
                    管理实例 ›
                  </button>
                )}
              </div>
              <div className="con-base-grid">
                {instances.map((inst) => {
                  const st = statusOf(inst);
                  const prof = appProfile(inst.appType);
                  const meta = inst.wechat.installed
                    ? `${prof.label} ${inst.wechat.version || ''}`.trim()
                    : inst.runtime === 'running' && prof.needsInstall
                      ? `待安装${prof.label}`
                      : prof.label;
                  return (
                    <button key={inst.id} className="con-inst" onClick={() => nav(`/i/${inst.id}`)}>
                      <span className="con-inst-av">
                        <InstanceIcon icon={inst.icon} appType={inst.appType} size={36} radius={10} />
                        <span className={'con-inst-dot ' + st.cls} />
                      </span>
                      <span className="con-inst-main">
                        <span className="con-inst-name">{inst.name}</span>
                        <span className="con-inst-meta">
                          <span className={'con-inst-st ' + st.cls}>{st.text}</span>
                          <span className="con-inst-ver">{meta}</span>
                        </span>
                      </span>
                      <span className="enter-arrow">›</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function PanelCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: { text: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="con-panel">
      <div className="con-panel-head">
        <span className="con-panel-title">{title}</span>
        {action && (
          <button className="btn-text" onClick={action.onClick}>
            {action.text}
          </button>
        )}
      </div>
      {children}
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
          ? 'AI 员工需要绑定到云微信实例才能开始工作，先去「系统设置」新建一个实例。'
          : '请联系管理员为你分配实例，AI 员工的可操作范围即为你被授权的实例。'}
      </div>
      {isAdmin && (
        <div className="empty-action">
          <button className="btn btn-primary" onClick={onManage}>
            去新建实例
          </button>
        </div>
      )}
    </div>
  );
}

function riskReason(i: InstanceWithStatus): string {
  if (i.runtime !== 'running') return i.runtime === 'missing' ? '实例未创建' : '实例已停止';
  if (i.proxyEnabled === false) return '未配置代理，无法进入';
  if (i.wechat.phase === 'error') return '安装/运行异常';
  if (!i.wechat.installed) return '待安装应用';
  return '需要检查';
}

// ==================== 数据建模 ====================

interface ConsoleModel {
  messages: number;
  handled: number;
  pendingTotal: number;
  highIntent: number;
  activeEmployees: number;
  riskCustomers: number;
  employees: EmpRow[];
  taskBuckets: { key: string; label: string; value: number; cls: string }[];
  timeline: TimelineItem[];
  pending: PendingRow[];
  customers: CustomerRow[];
}

function buildReal(c: AiConsolePayload, wocById: Map<string, InstanceWithStatus>, instances: InstanceWithStatus[]): ConsoleModel {
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

  const timeline: TimelineItem[] = c.recent_runs
    .slice()
    .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
    .map((r) => ({
      key: String(r.run_id),
      emp: `${roleOf(r.employee_id)}助理`,
      act: label(RUN_TYPE_LABELS, r.run_type),
      inst: instName(r.instance_id_suffix, r.woc_instance_id),
      summary: r.redacted_summary || '',
      status: RUN_STATUS[r.status] ?? { t: r.status, cls: '' },
      ago: timeAgo(r.started_at),
    }));

  // 任务按类型聚合
  const byType = new Map<string, number>();
  for (const t of c.recent_tasks) byType.set(t.task_type, (byType.get(t.task_type) || 0) + 1);
  const waitingByType = new Map<string, number>();
  for (const t of c.recent_tasks) if (t.status === 'waiting_approval') waitingByType.set(t.task_type, (waitingByType.get(t.task_type) || 0) + 1);
  const taskBuckets = [...byType.entries()].map(([k, v]) => ({
    key: k,
    label: label(TASK_TYPE_LABELS, k),
    value: v,
    cls: waitingByType.get(k) ? 'st-warn' : 'st-on',
  }));

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
  const customers: CustomerRow[] = c.customer_cards
    .slice()
    .sort((a, b) => (b.profile_intent_score ?? 0) - (a.profile_intent_score ?? 0))
    .map((x) => ({
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
    employees,
    taskBuckets,
    timeline,
    pending,
    customers,
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
  const taskBuckets = taskKinds.map((k, i) => ({
    key: k,
    label: k,
    value: instances.length ? 1 + (seedOf(k + instances.length) % 6) : 0,
    cls: i === 1 ? 'st-warn' : 'st-on',
  }));

  return {
    messages,
    handled,
    pendingTotal,
    highIntent: instances.length ? 2 + (seedOf('hi' + instances.length) % 6) : 0,
    activeEmployees: employees.filter((e) => e.statusCls === 'st-on').length,
    riskCustomers: customers.filter((c) => c.risk === 'high').length,
    employees,
    taskBuckets,
    timeline,
    pending,
    customers,
  };
}
