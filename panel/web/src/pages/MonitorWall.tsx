import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { statusOf, useInstances } from '../AppShell';
import { appProfile, type InstanceWithStatus } from '../api';
import { InstanceIcon } from '../AppIcon';
import {
  useAiConsoleModel,
  getInstanceEmployee,
  getInstanceCustomers,
  getInstanceRiskSummary,
  instanceAbnormal,
  instanceOnline,
  stageLabel,
  RISK_LABEL,
  type AiConsoleModel,
  type CrmCustomer,
} from './aiConsoleModel';

// 多实例监控墙（/monitor）—— 完全对标产品模板监控页视觉：
//   .page-h（标题 + 时间范围 / 导出占位）→ .src-note 数据来源标注 → .heat 活跃度热力图卡 →
//   .monitor-wall-grid 每个可见实例一张 .monitor-card（异常实例 .attn）→ 安全审计 .card（用现有安全派生字段）。
// 数据来自共享只读模型 useAiConsoleModel（真实优先，失败 deterministic 回退）：只展示状态 / 计数 / 风险等级 /
//   脱敏摘要 / 时间，绝不展示聊天正文 / token / 原文。

type Filter = 'all' | 'online' | 'abnormal' | 'unread' | 'pending' | 'highrisk' | 'ai';

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

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

  // 活跃度热力图（24 格 · deterministic 占位，仅用于视觉；非真实逐时数据 → demo 标注）。
  const heat = useMemo(() => {
    const base = seedOf(instances.map((i) => i.id).join('|') + ':heat');
    return Array.from({ length: 24 }, (_, h) => {
      const online = stats.online;
      const s = seedOf(String(base) + ':' + h);
      const active = online > 0 ? (s % 5) + (h >= 9 && h <= 21 ? 1 : 0) : 0;
      return Math.min(5, active);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, stats.online]);

  // 安全审计概览：从现有安全派生字段生成（无真实审计日志 → 占位标注）。
  const audit = useMemo(() => {
    return instances
      .map((inst) => {
        const r = getInstanceRiskSummary(m, inst);
        const st = statusOf(inst);
        let level: 'danger' | 'warn' | 'ok';
        let event: string;
        if (r.abnormal) {
          level = 'danger';
          event = inst.proxyEnabled === false ? '代理未启用 · AI 已暂停自动动作' : inst.runtime !== 'running' ? '实例未运行 · 值守暂停' : '实例状态异常';
        } else if (r.highRisk > 0) {
          level = 'danger';
          event = `${r.highRisk} 位高风险客户 · 建议人工介入`;
        } else if (r.pending > 0) {
          level = 'warn';
          event = `${r.pending} 个待确认动作等待复核`;
        } else if (r.unread > 0) {
          level = 'warn';
          event = `${r.unread} 条未读待处理`;
        } else {
          level = 'ok';
          event = 'AI 正常值守 · 无异常';
        }
        return { id: inst.id, name: inst.name, level, event, status: st, sortKey: level === 'danger' ? 0 : level === 'warn' ? 1 : 2 };
      })
      .sort((a, b) => a.sortKey - b.sortKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, m.customers, m.actions, m.instanceEmployees]);

  return (
    <div>
      <div className="page-h">
        <div>
          <h1>监控 · 监控墙</h1>
          <p>统一查看每个微信实例的运行状态、绑定 AI 员工、客户风险与待确认动作，一屏定位需要接管的实例。只展示状态与计数，不展示聊天正文或 token。</p>
        </div>
        <div className="act">
          <select className="btn" defaultValue="24h" aria-label="时间范围">
            <option value="1h">近 1 小时</option>
            <option value="24h">近 24 小时</option>
            <option value="7d">近 7 天</option>
          </select>
          <button className="btn" disabled title="监控快照导出即将上线">导出快照</button>
          <button className="btn" onClick={() => reload()}>刷新</button>
        </div>
      </div>

      {m.probed && (
        m.real ? (
          <div className="src-note real">
            <span className="d" /> 已接入真实 AI 员工数据 · 客户 / 待确认 / 绑定员工来源 ai-wechat-employee（只读，已按可见实例过滤）；实例状态恒为真实。
          </div>
        ) : (
          <div className="src-note demo">
            <span className="d" /> 演示数据：实例在线 / 异常状态为真实，AI 员工 / 客户 / 待确认 / 热力图为 deterministic 占位演示。
          </div>
        )
      )}

      {/* 实例概览 + 活跃度热力图 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <span className="title">实例活跃度</span>
          <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <span className="chip brand">在线 {stats.online}/{stats.total}</span>
            {stats.pending > 0 && <span className="chip warn">待确认 {stats.pending}</span>}
            {stats.highRisk > 0 && <span className="chip danger">高风险 {stats.highRisk}</span>}
            {stats.needsTakeover > 0 && <span className="chip danger">需接管 {stats.needsTakeover}</span>}
            <span className="chip outline">AI 在岗 {stats.ai}</span>
          </div>
        </div>
        <div className="card-b">
          <div className="heat">
            {heat.map((lvl, i) => (
              <span key={i} className={lvl > 0 ? 'l' + lvl : ''} title={`${String(i).padStart(2, '0')}:00 活跃度 ${lvl}/5`} />
            ))}
          </div>
          <div className="row" style={{ marginTop: 8, justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)' }}>
            <span>00:00</span>
            <span>近 24 小时 · 每格 1 小时（占位演示）</span>
            <span>23:00</span>
          </div>
        </div>
      </div>

      {/* 筛选 */}
      <div className="row" style={{ gap: 6, margin: '14px 0', flexWrap: 'wrap' }} role="tablist" aria-label="筛选实例">
        {FILTERS.map((k) => (
          <button key={k} className={'btn sm' + (filter === k ? ' primary' : '')} onClick={() => pickFilter(k)}>
            {FILTER_LABELS[k]} {counts[k]}
          </button>
        ))}
      </div>

      {/* 监控墙网格 */}
      {!loaded ? (
        <div className="loading">加载监控墙…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-blob">🖥️</div>
          <div className="empty-title">当前筛选下没有实例</div>
          <div className="empty-sub">切换上方筛选条件，或联系管理员为你分配更多微信实例。</div>
        </div>
      ) : (
        <div className="monitor-wall-grid">
          {filtered.map((inst) => (
            <MonitorCard
              key={inst.id}
              m={m}
              inst={inst}
              onEnter={() => nav(`/i/${inst.id}`)}
            />
          ))}
        </div>
      )}

      {/* 安全审计 / 告警概览 */}
      <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
        <div className="card-h">
          <span className="title">安全审计概览</span>
          <span className="chip outline" style={{ marginLeft: 'auto' }}>占位：无真实审计日志，基于安全派生字段生成</span>
        </div>
        {audit.length === 0 ? (
          <div className="card-b"><div className="dim">暂无实例可审计。</div></div>
        ) : (
          <table className="t">
            <thead><tr><th>实例</th><th>状态</th><th>安全事件</th><th>级别</th><th></th></tr></thead>
            <tbody>
              {audit.slice(0, 8).map((a) => (
                <tr key={a.id}>
                  <td><b>{a.name}</b></td>
                  <td><span className="row" style={{ gap: 6 }}><span className={'dot ' + a.status.cls} /> {a.status.text}</span></td>
                  <td><span className="dim">{a.event}</span></td>
                  <td>
                    <span className={'chip ' + (a.level === 'danger' ? 'danger' : a.level === 'warn' ? 'warn' : 'brand')}>
                      {a.level === 'danger' ? '严重' : a.level === 'warn' ? '关注' : '正常'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm ghost" onClick={() => nav(`/i/${a.id}`)}>查看 ›</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MonitorCard({ m, inst, onEnter }: { m: AiConsoleModel; inst: InstanceWithStatus; onEnter: () => void }) {
  const st = statusOf(inst);
  const emp = getInstanceEmployee(m, inst.id);
  const risk = getInstanceRiskSummary(m, inst);
  const top: CrmCustomer | null = getInstanceCustomers(m, inst.id)[0] ?? null;
  const abnormal = instanceAbnormal(inst);
  const online = instanceOnline(inst);

  // 风险分布分段条：高风险 / 关注(待确认+未读) / 正常。
  const total = Math.max(1, risk.customers);
  const dangerPct = Math.round((risk.highRisk / total) * 100);
  const warnPct = Math.round((Math.min(total - risk.highRisk, risk.pending + risk.unread) / total) * 100);
  const brandPct = Math.max(0, 100 - dangerPct - warnPct);

  return (
    <article className={'monitor-card' + (abnormal ? ' attn' : '')}>
      <div className="monitor-head">
        <InstanceIcon icon={inst.icon} appType={inst.appType} size={34} radius={9} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: 'block' }}>{inst.name}</b>
          <span className="dim" style={{ fontSize: 12 }}>
            {appProfile(inst.appType).label} · {emp?.bound ? emp.name : '未绑定 AI 员工'}
          </span>
        </div>
        <span className={'chip ' + (st.cls === 'st-on' ? 'brand' : st.cls === 'st-warn' ? 'warn' : 'danger')}>
          <span className={'dot ' + st.cls} /> {st.text}
        </span>
      </div>

      <div className="monitor-body">
        <div className="monitor-rows">
          <div className="monitor-row">
            <span className="lbl">客户数</span>
            <span className="v"><b>{risk.customers}</b></span>
            <span className="lbl" style={{ width: 'auto' }}>高意向</span>
            <span className="v" style={{ flex: 0 }}>
              <span className={'chip ' + (risk.highIntent ? 'accent' : 'outline')}>{risk.highIntent}</span>
            </span>
          </div>
          <div className="monitor-row">
            <span className="lbl">待确认</span>
            <span className="v">
              <span className={'chip ' + (risk.pending ? 'warn' : 'outline')}>{risk.pending}</span>
            </span>
            <span className="lbl" style={{ width: 'auto' }}>未读</span>
            <span className="v" style={{ flex: 0 }}>
              <span className={'chip ' + (risk.unread ? 'danger' : 'outline')}>{risk.unread}</span>
            </span>
          </div>
          <div className="monitor-row">
            <span className="lbl">风险分布</span>
            <span className="risk-bar" title={`高风险 ${risk.highRisk} · 关注 ${risk.pending + risk.unread} · 正常`}>
              {dangerPct > 0 && <span className="seg danger" style={{ width: dangerPct + '%' }} />}
              {warnPct > 0 && <span className="seg warn" style={{ width: warnPct + '%' }} />}
              <span className="seg brand" style={{ width: brandPct + '%' }} />
            </span>
          </div>
          <div className="monitor-row">
            <span className="lbl">客户</span>
            <span className="v dim">
              {risk.customers > 0 && top
                ? <>{top.code} · {stageLabel(top.stage)} · {RISK_LABEL[top.risk]}{top.intent != null ? ` · 意向 ${top.intent}` : ''}</>
                : online ? '暂无客户画像' : '实例离线 · 暂无数据'}
            </span>
          </div>
        </div>

        <div className="monitor-acts">
          <button className="btn sm ghost" onClick={onEnter}>查看</button>
          <button className={'btn sm ' + (risk.needsTakeover ? 'brand' : '')} onClick={onEnter}>
            {risk.needsTakeover ? '接管处理' : '接管'}
          </button>
        </div>
      </div>
    </article>
  );
}
