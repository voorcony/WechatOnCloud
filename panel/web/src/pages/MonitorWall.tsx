import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { statusOf, useInstances } from '../AppShell';
import { api, appProfile, type InstanceWithStatus } from '../api';
import { InstanceIcon } from '../AppIcon';
import {
  useAiConsoleModel,
  getInstanceEmployee,
  getInstanceCustomers,
  getInstanceRiskSummary,
  instanceAbnormal,
  stageLabel,
  RISK_LABEL,
  type AiConsoleModel,
  type CrmCustomer,
} from './aiConsoleModel';

// 多实例监控墙（/monitor）
// 定位：不是简单的 VNC iframe 宫格，而是「微信实例矩阵 + AI 员工状态 + 客户风险 + 待确认 + 接管入口」的
//   多实例 AI 监控墙（参考 AdsPower 多环境矩阵 / 云手机墙 / Linear 状态墙）。数据来自共享只读模型
//   useAiConsoleModel（真实优先，失败 deterministic 回退），只展示状态 / 计数 / 脱敏摘要，绝不展示聊天正文 / token。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

type Filter = 'all' | 'online' | 'abnormal' | 'unread' | 'pending' | 'highrisk' | 'ai';
type Layout = 'auto' | '2' | '3' | '4';

const FILTERS: Filter[] = ['all', 'online', 'abnormal', 'unread', 'pending', 'highrisk', 'ai'];
const FILTER_LABELS: Record<Filter, string> = {
  all: '全部',
  online: '在线',
  abnormal: '异常',
  unread: '未读',
  pending: '待确认',
  highrisk: '高风险',
  ai: '有AI员工',
};

function desktopUrl(id: string) {
  return `/desktop/${id}/vnc/index.html?autoconnect=1&path=desktop/${id}/websockify&resize=remote&view_only=true&reconnect=true&reconnect_delay=2000`;
}

function matchFilter(m: AiConsoleModel, inst: InstanceWithStatus, f: Filter): boolean {
  const r = getInstanceRiskSummary(m, inst);
  switch (f) {
    case 'online':
      return statusOf(inst).cls === 'st-on';
    case 'abnormal':
      return r.abnormal;
    case 'unread':
      return r.unread > 0;
    case 'pending':
      return r.pending > 0;
    case 'highrisk':
      return r.highRisk > 0;
    case 'ai':
      return getInstanceEmployee(m, inst.id)?.bound === true;
    default:
      return true;
  }
}

export default function MonitorWall({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const { reload } = useInstances();
  const { instances, loaded } = m;
  const [params, setParams] = useSearchParams();
  const urlFilter = params.get('filter') as Filter | null;
  const [filter, setFilter] = useState<Filter>(urlFilter && FILTERS.includes(urlFilter) ? urlFilter : 'all');
  const [layout, setLayout] = useState<Layout>('auto');

  // 支持从总控台 /monitor?filter=abnormal 等深链直达。
  useEffect(() => {
    if (urlFilter && FILTERS.includes(urlFilter)) setFilter(urlFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFilter]);
  const pickFilter = (f: Filter) => {
    setFilter(f);
    setParams(f === 'all' ? {} : { filter: f }, { replace: true });
  };

  const stats = useMemo(() => {
    let online = 0;
    let pending = 0;
    let highRisk = 0;
    let needsTakeover = 0;
    let ai = 0;
    for (const inst of instances) {
      const r = getInstanceRiskSummary(m, inst);
      if (statusOf(inst).cls === 'st-on') online++;
      pending += r.pending;
      highRisk += r.highRisk;
      if (r.needsTakeover) needsTakeover++;
      if (getInstanceEmployee(m, inst.id)?.bound) ai++;
    }
    return { total: instances.length, online, pending, highRisk, needsTakeover, ai };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, m.customers, m.actions, m.instanceEmployees]);

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of FILTERS) c[f] = instances.filter((inst) => matchFilter(m, inst, f)).length;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, m.customers, m.actions, m.instanceEmployees]);

  const filtered = useMemo(
    () => instances.filter((inst) => matchFilter(m, inst, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instances, filter, m.customers, m.actions, m.instanceEmployees],
  );

  const gridClass = layout === 'auto' ? 'monitor-grid auto' : `monitor-grid cols-${layout}`;

  const kpis: { key: string; label: string; value: number; tone?: 'ok' | 'warn' | 'danger' }[] = [
    { key: 'total', label: '总实例', value: stats.total },
    { key: 'online', label: '在线', value: stats.online, tone: stats.online ? 'ok' : undefined },
    { key: 'pending', label: '待确认', value: stats.pending, tone: stats.pending ? 'warn' : undefined },
    { key: 'risk', label: '高风险客户', value: stats.highRisk, tone: stats.highRisk ? 'danger' : undefined },
    { key: 'take', label: '需接管', value: stats.needsTakeover, tone: stats.needsTakeover ? 'danger' : undefined },
    { key: 'ai', label: 'AI 在岗', value: stats.ai, tone: stats.ai ? 'ok' : undefined },
  ];

  return (
    <div className="ws-page monitor-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">多实例监控墙</span>
        <button className="ws-action" onClick={() => reload()}>
          刷新
        </button>
      </header>

      <div className="content monitor-content">
        <section className="monitor-hero">
          <div>
            <div className="monitor-eyebrow">AI WeChat Console</div>
            <h2>云微信实例 AI 监控墙</h2>
            <p>统一查看 VNC 画面、运行状态、绑定 AI 员工、客户风险与待确认动作；一屏定位需要接管的实例。监控墙只展示状态与计数，不展示聊天正文或 token。</p>
          </div>
          <div className="monitor-kpis">
            {kpis.map((k) => (
              <div key={k.key} className="monitor-kpi">
                <b className={k.tone ?? ''}>{k.value}</b>
                <span>{k.label}</span>
              </div>
            ))}
          </div>
        </section>

        {m.probed && (
          <div className={'con-src ' + (m.real ? 'con-src-real' : 'con-src-demo')}>
            <span className="con-src-dot" />{' '}
            {m.real
              ? '已接入真实 AI 员工数据 · 客户 / 待确认 / 绑定员工来源 ai-wechat-employee（只读，已按可见实例过滤）；实例状态恒为真实。'
              : '演示数据：实例在线 / 异常状态为真实，AI 员工 / 客户 / 待确认为 deterministic 占位演示。'}
          </div>
        )}

        <div className="monitor-toolbar">
          <div className="monitor-filters" role="tablist" aria-label="筛选实例">
            {FILTERS.map((k) => (
              <button key={k} className={'monitor-pill' + (filter === k ? ' on' : '')} onClick={() => pickFilter(k)}>
                {FILTER_LABELS[k]} {counts[k]}
              </button>
            ))}
          </div>
          <div className="monitor-layouts" aria-label="布局">
            {([
              ['auto', '自动'],
              ['2', '2×2'],
              ['3', '3×3'],
              ['4', '4×4'],
            ] as [Layout, string][]).map(([k, text]) => (
              <button key={k} className={'monitor-layout' + (layout === k ? ' on' : '')} onClick={() => setLayout(k)}>
                {text}
              </button>
            ))}
          </div>
        </div>

        {!loaded ? (
          <div className="monitor-empty"><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="monitor-empty">当前筛选下没有实例</div>
        ) : (
          <div className={gridClass}>
            {filtered.map((inst) => (
              <MonitorTile key={inst.id} m={m} inst={inst} onEnter={() => nav(`/i/${inst.id}`)} onTake={() => api.controlTake(inst.id).finally(() => nav(`/i/${inst.id}`))} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MonitorTile({ m, inst, onEnter, onTake }: { m: AiConsoleModel; inst: InstanceWithStatus; onEnter: () => void; onTake: () => void }) {
  const st = statusOf(inst);
  const emp = getInstanceEmployee(m, inst.id);
  const risk = getInstanceRiskSummary(m, inst);
  const top: CrmCustomer | null = getInstanceCustomers(m, inst.id)[0] ?? null;
  const abnormal = instanceAbnormal(inst);
  const canShowFrame = inst.runtime === 'running' && inst.wechat.installed && inst.proxyEnabled !== false;

  return (
    <article className={'monitor-tile' + (abnormal ? ' warn' : '') + (risk.needsTakeover ? ' takeover' : '')}>
      <div className="monitor-tile-head">
        <div className="monitor-title">
          <InstanceIcon icon={inst.icon} appType={inst.appType} size={30} radius={9} />
          <div>
            <b>{inst.name}</b>
            <span>{appProfile(inst.appType).label} · {emp?.bound ? `${emp.name}` : '未绑定 AI 员工'}</span>
          </div>
        </div>
        <span className={'monitor-status ' + st.cls}>{st.text}</span>
      </div>

      <div className="monitor-frame-wrap">
        {canShowFrame ? (
          <iframe className="monitor-frame" src={desktopUrl(inst.id)} title={`${inst.name} 监控画面`} loading="lazy" />
        ) : (
          <div className="monitor-frame-fallback">
            <span>{abnormal ? '需要处理后再查看桌面' : '桌面暂不可用'}</span>
            <small>{inst.proxyEnabled === false ? '未配置代理' : inst.wechat.message || st.text}</small>
          </div>
        )}
        <div className="monitor-metrics">
          {risk.unread > 0 && <span className="monitor-chip danger">{risk.unread} 未读</span>}
          {risk.pending > 0 && <span className="monitor-chip warn">{risk.pending} 待确认</span>}
          {risk.highRisk > 0 && <span className="monitor-chip danger">{risk.highRisk} 高风险</span>}
        </div>
      </div>

      <div className="monitor-tile-body">
        <div className="monitor-emp">
          <span className={'monitor-emp-dot ' + (emp?.statusCls ?? 'st-off')} />
          <span className="monitor-emp-txt">{emp?.bound ? `${emp.statusText}` : '未绑定'}</span>
          {emp?.role && <span className="monitor-emp-role">{emp.glyph} {emp.role}</span>}
        </div>
        <div className="monitor-cust">
          {risk.customers > 0 && top ? (
            <>
              <span className={'monitor-cust-av risk-' + top.risk}>{top.code.slice(0, 2)}</span>
              <span className="monitor-cust-txt">
                客户 {top.code} · {stageLabel(top.stage)}
                <small>意向 {top.intent ?? '—'} · {RISK_LABEL[top.risk]} · 共 {risk.customers} 位</small>
              </span>
            </>
          ) : (
            <span className="monitor-cust-txt muted">暂无客户画像</span>
          )}
        </div>
        <div className="monitor-badges">
          {risk.badges.map((b) => (
            <span key={b.key} className={'monitor-badge ' + b.tone}>{b.label}</span>
          ))}
        </div>
      </div>

      <div className="monitor-tile-foot">
        <button className="btn-text" onClick={() => window.open(`/desktop/${inst.id}/`, '_blank')}>新窗口</button>
        <button className="btn-text" onClick={onEnter}>进入实例</button>
        <button className={'btn monitor-take ' + (risk.needsTakeover ? 'btn-primary' : '')} onClick={onTake}>接管</button>
      </div>
    </article>
  );
}
