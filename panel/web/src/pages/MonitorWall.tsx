import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInstances, statusOf } from '../AppShell';
import { api, appProfile, type InstanceWithStatus } from '../api';
import { InstanceIcon } from '../AppIcon';

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

type Filter = 'all' | 'online' | 'abnormal' | 'unread' | 'ai';
type Layout = 'auto' | '2' | '3' | '4';

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function desktopUrl(id: string) {
  return `/desktop/${id}/vnc/index.html?autoconnect=1&path=desktop/${id}/websockify&resize=remote&view_only=true&reconnect=true&reconnect_delay=2000`;
}

function aiRole(inst: InstanceWithStatus): string {
  const roles = ['售前 AI', '售后 AI', '复购 AI', '群运营 AI'];
  return roles[seedOf(inst.id) % roles.length];
}

function unreadCount(inst: InstanceWithStatus): number {
  const n = seedOf(inst.id + ':unread') % 7;
  if (inst.runtime !== 'running' || !inst.wechat.installed) return 0;
  return n > 4 ? n - 4 : 0;
}

function hasAiEmployee(inst: InstanceWithStatus): boolean {
  return (seedOf(inst.id + ':ai') % 10) >= 2;
}

function isAbnormal(inst: InstanceWithStatus): boolean {
  return inst.runtime !== 'running' || !inst.wechat.installed || inst.wechat.phase === 'error' || inst.proxyEnabled === false;
}

export default function MonitorWall({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const { instances, loaded, reload } = useInstances();
  const [filter, setFilter] = useState<Filter>('all');
  const [layout, setLayout] = useState<Layout>('auto');

  const stats = useMemo(
    () => ({
      total: instances.length,
      online: instances.filter((i) => statusOf(i).cls === 'st-on').length,
      abnormal: instances.filter(isAbnormal).length,
      unread: instances.filter((i) => unreadCount(i) > 0).length,
      ai: instances.filter(hasAiEmployee).length,
    }),
    [instances],
  );

  const filtered = useMemo(
    () =>
      instances.filter((inst) => {
        if (filter === 'online') return statusOf(inst).cls === 'st-on';
        if (filter === 'abnormal') return isAbnormal(inst);
        if (filter === 'unread') return unreadCount(inst) > 0;
        if (filter === 'ai') return hasAiEmployee(inst);
        return true;
      }),
    [instances, filter],
  );

  const gridClass = layout === 'auto' ? 'monitor-grid auto' : `monitor-grid cols-${layout}`;

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
            <h2>云微信实例实时监控</h2>
            <p>统一查看 VNC 画面、运行状态、AI 员工绑定和待处理风险；监控墙只展示状态与计数，不展示聊天正文或 token。</p>
          </div>
          <div className="monitor-kpis">
            <b>{stats.total}</b><span>实例</span>
            <b>{stats.online}</b><span>在线</span>
            <b className={stats.abnormal ? 'danger' : ''}>{stats.abnormal}</b><span>异常</span>
            <b className={stats.unread ? 'warn' : ''}>{stats.unread}</b><span>未读</span>
          </div>
        </section>

        <div className="monitor-toolbar">
          <div className="monitor-filters" role="tablist" aria-label="筛选实例">
            {[
              ['all', `全部 ${stats.total}`],
              ['online', `在线 ${stats.online}`],
              ['abnormal', `异常 ${stats.abnormal}`],
              ['unread', `未读 ${stats.unread}`],
              ['ai', `AI员工 ${stats.ai}`],
            ].map(([k, text]) => (
              <button key={k} className={'monitor-pill' + (filter === k ? ' on' : '')} onClick={() => setFilter(k as Filter)}>
                {text}
              </button>
            ))}
          </div>
          <div className="monitor-layouts" aria-label="布局">
            {[
              ['auto', '自动'],
              ['2', '2×2'],
              ['3', '3×3'],
              ['4', '4×4'],
            ].map(([k, text]) => (
              <button key={k} className={'monitor-layout' + (layout === k ? ' on' : '')} onClick={() => setLayout(k as Layout)}>
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
            {filtered.map((inst) => {
              const st = statusOf(inst);
              const unread = unreadCount(inst);
              const abnormal = isAbnormal(inst);
              const ai = hasAiEmployee(inst);
              const canShowFrame = inst.runtime === 'running' && inst.wechat.installed && inst.proxyEnabled !== false;
              return (
                <article key={inst.id} className={'monitor-tile' + (abnormal ? ' warn' : '')}>
                  <div className="monitor-tile-head">
                    <div className="monitor-title">
                      <InstanceIcon icon={inst.icon} appType={inst.appType} size={30} radius={9} />
                      <div>
                        <b>{inst.name}</b>
                        <span>{appProfile(inst.appType).label} · {ai ? aiRole(inst) : '未绑定 AI 员工'}</span>
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
                    {unread > 0 && <span className="monitor-unread">{unread} 未读</span>}
                  </div>

                  <div className="monitor-tile-foot">
                    <button className="btn-text" onClick={() => window.open(`/desktop/${inst.id}/`, '_blank')}>新窗口</button>
                    <button className="btn-text" onClick={() => nav(`/i/${inst.id}`)}>进入实例</button>
                    <button className="btn btn-primary monitor-take" onClick={() => api.controlTake(inst.id).finally(() => nav(`/i/${inst.id}`))}>接管</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
