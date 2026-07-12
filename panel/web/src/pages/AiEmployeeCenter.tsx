import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useNavigate } from 'react-router-dom';
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
  type AiTaskCard,
  type AiRunCard,
  type AiCustomerCard,
  type AiKnowledgeDocument,
  type AiBindPayloadResponse,
  type AiKnowledgeImportResponse,
} from '../api';
import { InstanceIcon } from '../AppIcon';

// AI 员工中心
// 定位：云微信实例之上的 AI 私域员工总控台。
//   大秘书 → AI 员工 → 云微信实例 → 任务 → 时间线 → 待确认
//
// PR2：UI 壳（演示占位）。PR3：接入 ai-wechat-employee 的 management_api 只读代理
//   （GET /api/ai-employees/console）。后端已按当前账号可见实例过滤并做字段 allowlist，
//   payload 只含 id/hash/suffix/计数/redacted 摘要，绝无聊天正文 / reply_text / token。
//
// 展示策略：
//   - 后端返回 mode="real" 且 console.found → 用真实 management 数据渲染各 tab。
//   - 否则（未配置数据源 / 子进程不可用 / 子账号无法过滤）→ 回退到 PR2 本地演示，并明确提示。
// 严格约束（见 doc/AI员工中心.md）：复用云微登录态 / admin·sub 角色 / 实例授权；
//   不触发任何真实发送/审批/绑定动作；不显示任何 raw unknown 对象。

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

// demo 岗位：售前/售后/复购/群运营轮询分配到可见实例
const ROLES = ['售前', '售后', '复购', '群运营'] as const;

interface DemoBind {
  inst: InstanceWithStatus;
  empId: string;
  empName: string;
  role: (typeof ROLES)[number];
}

// 稳定伪随机（按实例 id 派生），保证同一实例每次渲染 demo 数字一致、不跳动
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000;
}

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
  message_ingest: '消息接入',
  reply_suggest: '起草回复',
  approval_wait: '等待人审',
};
const TASK_STATUS: Record<string, { t: string; cls: string }> = {
  queued: { t: '排队', cls: 'st-busy' },
  routing: { t: '路由中', cls: 'st-busy' },
  running: { t: '进行中', cls: 'st-busy' },
  waiting_approval: { t: '待确认', cls: 'st-warn' },
  completed: { t: '已完成', cls: 'st-on' },
  failed: { t: '失败', cls: 'st-off' },
  cancelled: { t: '已取消', cls: '' },
};
const RUN_STATUS: Record<string, { t: string; cls: string }> = {
  running: { t: '进行中', cls: 'st-busy' },
  completed: { t: '已完成', cls: 'st-on' },
  failed: { t: '失败', cls: 'st-off' },
  skipped: { t: '跳过', cls: '' },
};
const label = (m: Record<string, string>, k: string): string => m[k] ?? k;
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

type Seg = 'overview' | 'employees' | 'instances' | 'customers' | 'knowledge' | 'tasks' | 'timeline' | 'pending' | 'bind';
const SEGMENTS: { key: Seg; label: string }[] = [
  { key: 'overview', label: '总控台' },
  { key: 'employees', label: 'AI 员工' },
  { key: 'instances', label: '微信实例' },
  { key: 'customers', label: '客户画像' },
  { key: 'knowledge', label: '知识库' },
  { key: 'tasks', label: '任务' },
  { key: 'timeline', label: '时间线' },
  { key: 'pending', label: '待确认' },
  { key: 'bind', label: '绑定入口' },
];

export default function AiEmployeeCenter({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user } = useAuth();
  const { instances, loaded } = useInstances();
  const nav = useNavigate();
  const [seg, setSeg] = useState<Seg>('overview');
  const isAdmin = user?.role === 'admin';

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

  // 可见实例 → demo 绑定卡（岗位轮询分配）。范围严格等于当前账号可见实例。
  const binds = useMemo<DemoBind[]>(
    () =>
      instances.map((inst, i) => ({
        inst,
        empId: `EMP-${String(i + 1).padStart(2, '0')}`,
        empName: `${ROLES[i % ROLES.length]}助理`,
        role: ROLES[i % ROLES.length],
      })),
    [instances],
  );

  // woc 实例 id → 实例对象，供真实模式把 instance card 还原成真实名/图标/跳转
  const wocById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);

  // KPI：可见实例数恒为真值；其余在真实模式取 management 数据，否则用演示派生
  const abnormal = instances.filter((i) => i.runtime !== 'running' || !i.wechat.installed).length;
  const kpis = real
    ? [
        { label: '可见实例', value: instances.length, tone: '' },
        { label: 'AI 员工', value: real.employee_cards.length, tone: '' },
        { label: '客户画像', value: real.customer_cards.length, tone: '' },
        { label: '知识库', value: real.knowledge_summary?.document_count ?? 0, tone: '' },
        { label: '待确认', value: real.pending?.pending_total ?? 0, tone: (real.pending?.pending_total ?? 0) ? 'warn' : '' },
        { label: '异常', value: abnormal, tone: abnormal ? 'danger' : '' },
      ]
    : demoKpis(instances, abnormal);

  const empty = loaded && instances.length === 0;

  return (
    <div className="ws-page">
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
          <div className="ai-hero-title">云微信实例之上的 AI 私域员工总控台</div>
          <div className="ai-hero-flow">大秘书 → AI 员工 → 云微信实例 → 任务 → 时间线 → 待确认</div>
          <div className="ai-hero-scope">
            AI 员工可操作范围 = 当前账号在云微已有授权下可见的实例。管理员隐式拥有全部实例；子账号只看到被授权实例。
          </div>
        </section>

        {/* 数据源状态：真实 vs 本地演示 */}
        {probed &&
          (real ? (
            <div className="ai-srcbar ai-srcbar-real">
              <span className="ai-srcdot" /> 已接入真实 AI 员工数据 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）
            </div>
          ) : (
            <div className="ai-warn">
              当前未配置 AI 员工数据源{resp && resp.mode === 'demo_fallback' && resp.reason === 'cannot_enforce_instance_filter' ? '（无法按实例过滤，已对子账号回退）' : ''}，正在展示本地演示数据。
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
            <button key={s.key} role="tab" aria-selected={seg === s.key} className={'ai-tab' + (seg === s.key ? ' on' : '')} onClick={() => setSeg(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        {empty ? (
          <EmptyBinds isAdmin={isAdmin} onManage={() => nav('/admin')} />
        ) : !loaded || !probed ? (
          <div className="ai-loading">加载可见实例…</div>
        ) : real ? (
          <div className="ai-panel">
            {seg === 'overview' && <RealOverview c={real} wocById={wocById} isAdmin={isAdmin} onOpen={(id) => nav(`/i/${id}`)} />}
            {seg === 'employees' && <RealEmployees c={real} />}
            {seg === 'instances' && <RealInstances c={real} wocById={wocById} onOpen={(id) => nav(`/i/${id}`)} />}
            {seg === 'customers' && <RealCustomers c={real} wocById={wocById} />}
            {seg === 'knowledge' && <RealKnowledge c={real} onImported={loadConsole} />}
            {seg === 'tasks' && <RealTasks c={real} wocById={wocById} />}
            {seg === 'timeline' && <RealTimeline c={real} wocById={wocById} />}
            {seg === 'pending' && <RealPending c={real} wocById={wocById} />}
            {seg === 'bind' && <RealBind c={real} />}
          </div>
        ) : (
          <div className="ai-panel">
            {seg === 'overview' && <Overview binds={binds} isAdmin={isAdmin} />}
            {seg === 'employees' && <Employees binds={binds} />}
            {seg === 'instances' && <InstancesTab binds={binds} onOpen={(id) => nav(`/i/${id}`)} />}
            {seg === 'customers' && <CustomersDemo binds={binds} />}
            {seg === 'knowledge' && <KnowledgeDemo binds={binds} />}
            {seg === 'tasks' && <Tasks binds={binds} />}
            {seg === 'timeline' && <Timeline binds={binds} />}
            {seg === 'pending' && <Pending binds={binds} />}
            {seg === 'bind' && <BindEntry />}
          </div>
        )}
      </div>
    </div>
  );
}

function numOf(v: number | string | number[] | undefined): number | null {
  return typeof v === 'number' ? v : null;
}

function demoKpis(instances: InstanceWithStatus[], abnormal: number) {
  const employeeCount = instances.length === 0 ? 0 : Math.max(4, instances.length);
  const todayMsgs = instances.reduce((sum, i) => sum + 40 + (seedOf(i.id) % 160), 0);
  const pendingCount = instances.length === 0 ? 0 : (seedOf(instances.map((i) => i.id).join()) % 5) + 1;
  return [
    { label: '可见实例', value: instances.length, tone: '' },
    { label: 'AI 员工', value: employeeCount, tone: '' },
    { label: '今日消息', value: todayMsgs, tone: 'demo' },
    { label: '待确认', value: pendingCount, tone: pendingCount ? 'warn' : '' },
    { label: '异常', value: abnormal, tone: abnormal ? 'danger' : '' },
  ];
}

// 真实模式：实例卡内联展示 hash/suffix 或真实名（命中可见实例时）
function instanceLabel(card: { woc_instance_id: string | null; instance_id_suffix: string }, wocById: Map<string, InstanceWithStatus>): string {
  const inst = card.woc_instance_id ? wocById.get(card.woc_instance_id) : undefined;
  return inst ? inst.name : `实例 ···${card.instance_id_suffix}`;
}
function instanceLabelBy(hashSuffix: string | null, wocId: string | null, wocById: Map<string, InstanceWithStatus>): string {
  const inst = wocId ? wocById.get(wocId) : undefined;
  if (inst) return inst.name;
  return hashSuffix ? `实例 ···${hashSuffix}` : '（无实例）';
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + (b || 0), 0);
}

// ==================== 真实模式组件 ====================

function RealOverview({
  c,
  wocById,
  isAdmin,
  onOpen,
}: {
  c: AiConsolePayload;
  wocById: Map<string, InstanceWithStatus>;
  isAdmin: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="ai-note">
        以下为真实 AI 员工运行数据（只读）。{isAdmin ? '作为管理员，你看到全部实例。' : '范围为你被授权的实例。'}
        仅展示计数与脱敏摘要，不含任何聊天正文。
      </div>
      {c.instance_cards.length === 0 ? (
        <div className="ai-note">当前可见实例上暂无已绑定的 AI 员工数据。</div>
      ) : (
        <div className="ai-grid">
          {c.instance_cards.map((ic) => {
            const inst = ic.woc_instance_id ? wocById.get(ic.woc_instance_id) : undefined;
            const running = sumCounts(ic.run_counts);
            const tasks = sumCounts(ic.task_counts);
            const card = (
              <div className="ai-card-head">
                <span className="ai-card-av">
                  {inst ? <InstanceIcon icon={inst.icon} appType={inst.appType} size={38} radius={11} /> : <span className="ai-card-hashav">···{ic.instance_id_suffix}</span>}
                </span>
                <div className="ai-card-id">
                  <div className="ai-card-name">{instanceLabel(ic, wocById)}</div>
                  <div className="ai-card-sub">绑定员工 {ic.bound_employee_ids.length} · 活跃绑定 {ic.active_binding_count}</div>
                </div>
                {inst && <span className="enter-arrow">›</span>}
              </div>
            );
            const stats = (
              <div className="ai-card-stats">
                任务 {tasks}
                <span className="ai-card-sep">·</span> 运行 {running}
                {ic.task_counts.waiting_approval ? (
                  <>
                    <span className="ai-card-sep">·</span>
                    <span className="ai-dot st-warn" /> 待确认 {ic.task_counts.waiting_approval}
                  </>
                ) : null}
              </div>
            );
            return inst ? (
              <button key={ic.instance_id_hash} className="ai-card ai-card-btn" onClick={() => onOpen(inst.id)}>
                {card}
                {stats}
              </button>
            ) : (
              <div key={ic.instance_id_hash} className="ai-card">
                {card}
                {stats}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function RealEmployees({ c }: { c: AiConsolePayload }) {
  return (
    <table className="ai-table">
      <thead>
        <tr>
          <th>员工</th>
          <th>岗位</th>
          <th>状态</th>
          <th>绑定实例</th>
          <th>任务</th>
          <th>运行</th>
        </tr>
      </thead>
      <tbody>
        {c.employee_cards.map((e: AiEmployeeCard) => {
          const roleCn = empRoleLabel(e.role);
          return (
            <tr key={e.employee_id}>
              <td>
                <b>{roleCn}助理</b>
                <div className="ai-cell-sub">EMP-{String(e.employee_id).padStart(2, '0')}</div>
              </td>
              <td>
                <span className={'ai-role ai-role-' + roleCn}>{roleCn}</span>
              </td>
              <td>
                <span className={'ai-dot ' + (e.status === 'active' ? 'st-on' : e.status === 'paused' ? 'st-warn' : '')} /> {e.status}
              </td>
              <td>{e.instance_count}</td>
              <td>{sumCounts(e.task_counts)}</td>
              <td>{sumCounts(e.run_counts)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RealInstances({
  c,
  wocById,
  onOpen,
}: {
  c: AiConsolePayload;
  wocById: Map<string, InstanceWithStatus>;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="ai-note">这些是绑定了 AI 员工、且在你可见范围内的云微信实例。命中真实实例时可点击跳转。</div>
      <div className="ai-grid">
        {c.instance_cards.map((ic: AiInstanceCard) => {
          const inst = ic.woc_instance_id ? wocById.get(ic.woc_instance_id) : undefined;
          const st = inst ? statusOf(inst) : null;
          const prof = inst ? appProfile(inst.appType) : null;
          const head = (
            <div className="ai-card-head">
              <span className="ai-card-av">
                {inst ? <InstanceIcon icon={inst.icon} appType={inst.appType} size={38} radius={11} /> : <span className="ai-card-hashav">···{ic.instance_id_suffix}</span>}
              </span>
              <div className="ai-card-id">
                <div className="ai-card-name">{instanceLabel(ic, wocById)}</div>
                <div className="ai-card-sub">{prof ? prof.label : 'hash ···' + ic.instance_id_suffix} · 绑定 {ic.bound_employee_ids.length} 员工</div>
              </div>
              {inst && <span className="enter-arrow">›</span>}
            </div>
          );
          const stats = (
            <div className="ai-card-stats">
              {st ? (
                <>
                  <span className={'ai-dot ' + st.cls} /> {st.text}
                  <span className="ai-card-sep">·</span>
                </>
              ) : null}
              任务 {sumCounts(ic.task_counts)}
              <span className="ai-card-sep">·</span> 运行 {sumCounts(ic.run_counts)}
            </div>
          );
          return inst ? (
            <button key={ic.instance_id_hash} className="ai-card ai-card-btn" onClick={() => onOpen(inst.id)}>
              {head}
              {stats}
            </button>
          ) : (
            <div key={ic.instance_id_hash} className="ai-card">
              {head}
              {stats}
            </div>
          );
        })}
      </div>
    </>
  );
}


function stageLabel(stage: string | null): string {
  const map: Record<string, string> = { high_intent: '高意向', browsing: '了解中', after_sales: '售后', risk: '风险' };
  return stage ? map[stage] ?? stage : '未形成';
}
function riskClass(risk: string | null): string {
  if (risk === 'high') return 'st-off';
  if (risk === 'medium') return 'st-warn';
  return 'st-on';
}
function RealCustomers({ c, wocById }: { c: AiConsolePayload; wocById: Map<string, InstanceWithStatus> }) {
  if (c.customer_cards.length === 0) return <div className="ai-note">暂无客户画像。请先启动 OCR 历史补全并运行记忆/画像抽取。</div>;
  return (
    <>
      <div className="ai-note">客户画像来自 OCR 入库消息 + contact_profiles/contact_memories。此页只展示 hash、阶段、记忆计数和状态，不显示聊天正文。</div>
      <div className="ai-grid">
        {c.customer_cards.map((x: AiCustomerCard) => (
          <div key={x.conversation_key_hash} className="ai-card">
            <div className="ai-card-head">
              <span className="ai-card-hashav">{x.display_name_hash.slice(0, 4)}</span>
              <div className="ai-card-id">
                <div className="ai-card-name">客户画像 · {x.conversation_key_hash.slice(0, 8)}</div>
                <div className="ai-card-sub">@{instanceLabelBy(x.instance_id_suffix, null, wocById)} · {timeAgo(x.latest_observed_at)}</div>
              </div>
              <span className={'ai-dot ' + riskClass(x.profile_risk_level)} />
            </div>
            <div className="ai-card-stats">
              阶段 {stageLabel(x.profile_stage)}
              <span className="ai-card-sep">·</span> 消息 {x.message_count}
              <span className="ai-card-sep">·</span> 记忆 {x.active_memory_count}/{x.candidate_memory_count}
            </div>
            <div className="ai-note">意向分：{x.profile_intent_score ?? '—'} · 入/出 {x.incoming_count}/{x.outgoing_count}</div>
          </div>
        ))}
      </div>
    </>
  );
}
function RealKnowledge({ c, onImported }: { c: AiConsolePayload; onImported: () => void }) {
  const k = c.knowledge_summary;
  const [title, setTitle] = useState('销售知识库');
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiKnowledgeImportResponse | null>(null);
  const [err, setErr] = useState('');
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
        <p className="ai-bind-desc">上传 Markdown 到 AI 员工知识库，服务端写入私有目录并重建 chunk。普通后台只显示 hash/count，不展示正文。</p>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文档标题" />
        <textarea className="input ai-kb-textarea" value={markdown} onChange={(e) => setMarkdown(e.target.value)} placeholder="# 退换货政策

把商家话术/商品知识粘贴到这里" />
        <div className="ai-bind-actions">
          <button className="btn btn-primary" disabled={busy || !markdown.trim()} onClick={submit}>{busy ? '导入中…' : '导入 Markdown'}</button>
          {result && <span className="ai-bind-hint">已导入 {result.document_count} 文档 / {result.chunk_count} chunk</span>}
        </div>
        {err && <div className="ai-warn" style={{ marginTop: 10 }}>{err}</div>}
      </div>
      {!k || k.document_count === 0 ? (
        <div className="ai-note">暂无知识库。可在上方粘贴 Markdown 导入。</div>
      ) : (
        <>
          <div className="ai-kpis">
            <div className="ai-kpi"><span className="ai-kpi-val">{k.document_count}</span><span className="ai-kpi-lbl">知识文档</span></div>
            <div className="ai-kpi"><span className="ai-kpi-val">{k.chunk_count}</span><span className="ai-kpi-lbl">检索切片</span></div>
          </div>
          <table className="ai-table">
            <thead><tr><th>文档</th><th>切片</th><th>内容 hash</th><th>更新</th></tr></thead>
            <tbody>
              {k.documents.map((d: AiKnowledgeDocument) => (
                <tr key={d.document_id}>
                  <td><b>{d.title || '未命名文档'}</b><div className="ai-cell-sub">path hash · {d.source_path_hash}</div></td>
                  <td>{d.chunk_count}</td>
                  <td className="ai-mono">{d.content_hash}</td>
                  <td className="ai-cell-sub">{timeAgo(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function RealTasks({ c, wocById }: { c: AiConsolePayload; wocById: Map<string, InstanceWithStatus> }) {
  return (
    <table className="ai-table">
      <thead>
        <tr>
          <th>任务</th>
          <th>员工</th>
          <th>实例</th>
          <th>状态</th>
          <th>更新</th>
        </tr>
      </thead>
      <tbody>
        {c.recent_tasks.map((t: AiTaskCard) => {
          const stt = TASK_STATUS[t.status] ?? { t: t.status, cls: '' };
          return (
            <tr key={t.task_id}>
              <td>
                <b>{label(TASK_TYPE_LABELS, t.task_type)}</b>
                <div className="ai-cell-sub">#{t.task_id}</div>
              </td>
              <td>{empRoleLabel(roleOfEmployee(c, t.employee_id))}助理</td>
              <td>{instanceLabelBy(t.instance_id_suffix, t.woc_instance_id, wocById)}</td>
              <td>
                <span className={'ai-dot ' + stt.cls} /> {stt.t}
              </td>
              <td className="ai-cell-sub">{timeAgo(t.updated_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RealTimeline({ c, wocById }: { c: AiConsolePayload; wocById: Map<string, InstanceWithStatus> }) {
  const runs = c.recent_runs.slice().sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
  if (runs.length === 0) return <div className="ai-note">暂无运行记录。</div>;
  return (
    <ul className="ai-timeline">
      {runs.map((r: AiRunCard) => {
        const stt = RUN_STATUS[r.status] ?? { t: r.status, cls: '' };
        return (
          <li key={r.run_id} className="ai-tl-item">
            <span className="ai-tl-dot" />
            <div className="ai-tl-body">
              <div className="ai-tl-main">
                <b>{empRoleLabel(roleOfEmployee(c, r.employee_id))}助理</b> {label(RUN_TYPE_LABELS, r.run_type)}
                <span className="ai-tl-inst">@{instanceLabelBy(r.instance_id_suffix, r.woc_instance_id, wocById)}</span>
              </div>
              <div className="ai-tl-meta">
                <span className={'ai-dot ' + stt.cls} /> {stt.t}
                {r.redacted_summary ? <> · {r.redacted_summary}</> : null}
                {timeAgo(r.started_at) ? <> · {timeAgo(r.started_at)}</> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RealPending({ c, wocById }: { c: AiConsolePayload; wocById: Map<string, InstanceWithStatus> }) {
  const p = c.pending ?? {};
  const waiting = c.recent_tasks.filter((t) => t.status === 'waiting_approval');
  const rows: { label: string; value: number }[] = [
    { label: '员工任务待人审', value: p.employee_tasks_waiting_approval ?? 0 },
    { label: '回复待人工', value: p.reply_jobs_needs_human ?? 0 },
    { label: '计划发送', value: p.send_actions_planned ?? 0 },
    { label: '计划改备注', value: p.contact_remark_actions_planned ?? 0 },
    { label: '计划群操作', value: p.group_operation_actions_planned ?? 0 },
  ];
  return (
    <>
      <div className="ai-warn">
        以下为等待人工确认 / 计划中的动作汇总（真实计数）。<b>本页只读，不触发任何真实微信动作</b>，按钮均不可用。
      </div>
      <div className="ai-kpis" style={{ marginTop: 12 }}>
        {rows.map((r) => (
          <div key={r.label} className={'ai-kpi' + (r.value ? ' ai-kpi-warn' : '')}>
            <span className="ai-kpi-val">{r.value}</span>
            <span className="ai-kpi-lbl">{r.label}</span>
          </div>
        ))}
      </div>
      {waiting.length > 0 && (
        <div className="ai-pending" style={{ marginTop: 12 }}>
          {waiting.map((t) => (
            <div key={t.task_id} className="ai-pending-item">
              <div className="ai-pending-head">
                <span className="ai-mono">任务 #{t.task_id}</span>
                <span className="ai-card-sep">·</span> {label(TASK_TYPE_LABELS, t.task_type)} @{instanceLabelBy(t.instance_id_suffix, t.woc_instance_id, wocById)}
              </div>
              <div className="ai-pending-draft">{t.input_redacted || '（内容已脱敏）'}</div>
              <div className="ai-pending-actions">
                <button className="btn btn-primary" disabled title="后续接人审 API；当前不触发真实微信动作">通过并发送</button>
                <button className="btn" disabled title="后续接人审 API；当前不触发真实微信动作">编辑后通过</button>
                <button className="btn btn-danger" disabled title="后续接人审 API；当前不触发真实微信动作">驳回</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RealBind({ c }: { c: AiConsolePayload }) {
  const bp = c.bind_panel;
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
        生成一次性绑定 payload，给控制机器人/二维码使用。后端只保存 token hash；原始 payload 只在本次页面展示。
      </p>
      {bp && bp.channel_count > 0 ? (
        <table className="ai-table" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>通道</th><th>类型</th><th>状态</th><th>已绑定 token</th><th>绑定时间</th></tr>
          </thead>
          <tbody>
            {bp.channels.map((ch) => (
              <tr key={ch.channel_id}>
                <td className="ai-mono">#{ch.channel_id}</td><td>{ch.channel_type}</td>
                <td><span className={'ai-dot ' + (ch.bind_status === 'active' ? 'st-on' : ch.bind_status === 'pending' ? 'st-warn' : 'st-off')} /> {ch.bind_status}</td>
                <td>{ch.has_bind_token ? '是' : '否'}</td><td className="ai-cell-sub">{ch.bound_at ? timeAgo(ch.bound_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="ai-note" style={{ marginTop: 10 }}>暂无控制通道。</div>}
      <div className="ai-bind-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={createBind}>{busy ? '生成中…' : '生成绑定码'}</button>
        <span className="ai-bind-hint">管理员生成；子账号无权生成</span>
      </div>
      {err && <div className="ai-warn" style={{ marginTop: 10 }}>{err}</div>}
      {payload && (
        <div className="ai-bind-payload">
          <div className="ai-bind-title">一次性绑定 payload</div>
          {qrUrl ? <img className="ai-qrbox" src={qrUrl} alt="扫码绑定秘书二维码" /> : <div className="ai-qrbox">生成中</div>}
          <div className="ai-bind-code">{payload.bind_payload_text}</div>
          <div className="ai-note">channel #{payload.channel_id} · payload hash {payload.bind_payload_hash} · token hash {payload.bind_token_hash}</div>
        </div>
      )}
    </div>
  );
}

// 真实模式：employee_id → 岗位角色（用于任务/运行行的员工标签）
function roleOfEmployee(c: AiConsolePayload, employeeId: number): string {
  const e = c.employee_cards.find((x) => x.employee_id === employeeId);
  return e ? e.role : '';
}

// ==================== 演示模式组件（PR2 保留，作为 fallback） ====================

function EmptyBinds({ isAdmin, onManage }: { isAdmin: boolean; onManage: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-blob">🤖</div>
      <div className="empty-title">{isAdmin ? '还没有可绑定的实例' : '暂无被授权实例'}</div>
      <div className="empty-sub">
        {isAdmin ? 'AI 员工需要绑定到云微信实例才能工作，先去「管理」新建一个实例。' : '请联系管理员为你分配实例，AI 员工的可操作范围即为你被授权的实例。'}
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

// 总控台：绑定概览卡（每张对应一个可见实例 → demo 员工）
function Overview({ binds, isAdmin }: { binds: DemoBind[]; isAdmin: boolean }) {
  return (
    <>
      <div className="ai-note">
        下列每个 AI 员工均绑定到你可见的一个云微信实例。{isAdmin ? '作为管理员，你看到全部实例。' : '你看到的是被授权的实例。'}员工/客户/任务数据为演示占位，不含真实聊天。
      </div>
      <div className="ai-grid">
        {binds.map((b) => {
          const st = statusOf(b.inst);
          const prof = appProfile(b.inst.appType);
          const custN = 3 + (seedOf(b.inst.id) % 12);
          return (
            <div key={b.inst.id} className="ai-card">
              <div className="ai-card-head">
                <span className="ai-card-av">
                  <InstanceIcon icon={b.inst.icon} appType={b.inst.appType} size={38} radius={11} />
                </span>
                <div className="ai-card-id">
                  <div className="ai-card-name">{b.empName}</div>
                  <div className="ai-card-sub">{b.empId} · {prof.label}实例「{b.inst.name}」</div>
                </div>
                <span className={'ai-role ai-role-' + b.role}>{b.role}</span>
              </div>
              <div className="ai-card-stats">
                <span className={'ai-dot ' + st.cls} /> {st.text}
                <span className="ai-card-sep">·</span> 服务客户 {custN}
                <span className="ai-card-sep">·</span> 演示
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Employees({ binds }: { binds: DemoBind[] }) {
  return (
    <table className="ai-table">
      <thead>
        <tr>
          <th>员工</th>
          <th>岗位</th>
          <th>绑定实例</th>
          <th>状态</th>
          <th>今日会话</th>
        </tr>
      </thead>
      <tbody>
        {binds.map((b) => {
          const st = statusOf(b.inst);
          return (
            <tr key={b.inst.id}>
              <td>
                <b>{b.empName}</b>
                <div className="ai-cell-sub">{b.empId}</div>
              </td>
              <td><span className={'ai-role ai-role-' + b.role}>{b.role}</span></td>
              <td>{b.inst.name}</td>
              <td><span className={'ai-dot ' + st.cls} /> {st.text}</td>
              <td>{2 + (seedOf(b.empId + b.inst.id) % 18)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function InstancesTab({ binds, onOpen }: { binds: DemoBind[]; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="ai-note">这些是你在云微已有授权下可见的实例（真实数据）。点击可跳到对应实例页面。</div>
      <div className="ai-grid">
        {binds.map((b) => {
          const st = statusOf(b.inst);
          const prof = appProfile(b.inst.appType);
          return (
            <button key={b.inst.id} className="ai-card ai-card-btn" onClick={() => onOpen(b.inst.id)}>
              <div className="ai-card-head">
                <span className="ai-card-av">
                  <InstanceIcon icon={b.inst.icon} appType={b.inst.appType} size={38} radius={11} />
                </span>
                <div className="ai-card-id">
                  <div className="ai-card-name">{b.inst.name}</div>
                  <div className="ai-card-sub">{prof.label} · 绑定 {b.empName}</div>
                </div>
                <span className="enter-arrow">›</span>
              </div>
              <div className="ai-card-stats">
                <span className={'ai-dot ' + st.cls} /> {st.text}
                {b.inst.wechat.installed && b.inst.wechat.version && (
                  <>
                    <span className="ai-card-sep">·</span> {b.inst.wechat.version}
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}


function CustomersDemo({ binds }: { binds: DemoBind[] }) {
  return (
    <div className="ai-grid">
      {binds.slice(0, 6).map((b, i) => (
        <div key={b.inst.id + 'c'} className="ai-card">
          <div className="ai-card-name">客户画像 · 演示 #{i + 1}</div>
          <div className="ai-card-sub">{b.empName} @{b.inst.name}</div>
          <div className="ai-card-stats">阶段 高意向<span className="ai-card-sep">·</span>消息 {8 + seedOf(b.inst.id) % 30}<span className="ai-card-sep">·</span>记忆 {1 + seedOf(b.empId) % 4}</div>
        </div>
      ))}
    </div>
  );
}
function KnowledgeDemo({ binds }: { binds: DemoBind[] }) {
  const n = Math.max(1, Math.min(4, binds.length || 1));
  return (
    <>
      <div className="ai-note">演示知识库入口。真实模式会展示 ai-wechat-employee 已入库文档与 chunk 计数。</div>
      <div className="ai-kpis"><div className="ai-kpi ai-kpi-demo"><span className="ai-kpi-val">{n}</span><span className="ai-kpi-lbl">知识文档</span></div><div className="ai-kpi ai-kpi-demo"><span className="ai-kpi-val">{n * 6}</span><span className="ai-kpi-lbl">检索切片</span></div></div>
    </>
  );
}

function Tasks({ binds }: { binds: DemoBind[] }) {
  const kinds = ['首次咨询回复', '订单跟进', '售后回访', '沉默客户复购唤醒', '社群日报'];
  const states: { t: string; cls: string }[] = [
    { t: '进行中', cls: 'st-busy' },
    { t: '待确认', cls: 'st-warn' },
    { t: '已完成', cls: 'st-on' },
  ];
  return (
    <table className="ai-table">
      <thead>
        <tr>
          <th>任务</th>
          <th>负责员工</th>
          <th>客户</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {binds.flatMap((b, i) => {
          const n = 1 + (seedOf(b.inst.id) % 2);
          return Array.from({ length: n }, (_, j) => {
            const seed = seedOf(b.inst.id + j);
            const stt = states[seed % states.length];
            return (
              <tr key={b.inst.id + j}>
                <td>{kinds[(i + j) % kinds.length]}</td>
                <td>{b.empName}</td>
                <td className="ai-mono">客户 #A{10 + ((seed + j) % 89)}</td>
                <td><span className={'ai-dot ' + stt.cls} /> {stt.t}</td>
              </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}

function Timeline({ binds }: { binds: DemoBind[] }) {
  const acts = ['收到客户咨询', 'AI 起草回复（待人审）', '大秘书路由到岗位', '标记为待复购', '生成社群日报草稿'];
  const items = binds.slice(0, 8).map((b, i) => {
    const seed = seedOf(b.inst.id + i);
    return {
      key: b.inst.id + i,
      emp: b.empName,
      inst: b.inst.name,
      act: acts[seed % acts.length],
      conv: `会话 hash·${(seed * 7919).toString(16).slice(0, 6)}`,
      ago: `${1 + (seed % 58)} 分钟前`,
    };
  });
  return (
    <ul className="ai-timeline">
      {items.map((it) => (
        <li key={it.key} className="ai-tl-item">
          <span className="ai-tl-dot" />
          <div className="ai-tl-body">
            <div className="ai-tl-main">
              <b>{it.emp}</b> {it.act}
              <span className="ai-tl-inst">@{it.inst}</span>
            </div>
            <div className="ai-tl-meta">
              <span className="ai-mono">{it.conv}</span> · {it.ago} · 演示
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Pending({ binds }: { binds: DemoBind[] }) {
  const items = binds.slice(0, 5).map((b, i) => {
    const seed = seedOf(b.inst.id + 'p' + i);
    return {
      key: b.inst.id + i,
      emp: b.empName,
      inst: b.inst.name,
      cust: `客户 #A${10 + (seed % 89)}`,
      draft: ['您好，您咨询的商品现货充足，今天下单预计明天发货～', '亲，您上次买的套装有回购优惠，需要帮您留一份吗？', '收到您的售后申请，我们会在 24 小时内处理，请放心。'][seed % 3],
    };
  });
  return (
    <>
      <div className="ai-warn">
        以下为 AI 起草、等待人工确认的回复。<b>后续接人审 API；当前不触发真实微信动作</b>，按钮均不可用。
      </div>
      <div className="ai-pending">
        {items.map((it) => (
          <div key={it.key} className="ai-pending-item">
            <div className="ai-pending-head">
              <span className="ai-mono">{it.cust}</span>
              <span className="ai-card-sep">·</span> {it.emp} @{it.inst}
            </div>
            <div className="ai-pending-draft">{it.draft}</div>
            <div className="ai-pending-actions">
              <button className="btn btn-primary" disabled title="后续接人审 API；当前不触发真实微信动作">通过并发送</button>
              <button className="btn" disabled title="后续接人审 API；当前不触发真实微信动作">编辑后通过</button>
              <button className="btn btn-danger" disabled title="后续接人审 API；当前不触发真实微信动作">驳回</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BindEntry() {
  return (
    <div className="ai-bind">
      <div className="ai-bind-title">大秘书控制入口（演示）</div>
      <p className="ai-bind-desc">
        绑定流程用于把「大秘书」总控接入到你已授权的云微信实例。当前为 UI MVP：
        <b> 后续接真实绑定，不在 UI MVP 生成 token。</b>
      </p>
      <div className="ai-bind-scope">
        AI 员工可操作范围 = 当前账号在云微已有授权下可见的实例。管理员隐式拥有全部实例；子账号只看到被授权实例。
      </div>
      <div className="ai-bind-actions">
        <button className="btn btn-primary" disabled title="后续接真实绑定，不在 UI MVP 生成 token">
          生成绑定码
        </button>
        <span className="ai-bind-hint">后续接真实绑定，不在 UI MVP 生成 token</span>
      </div>
    </div>
  );
}
