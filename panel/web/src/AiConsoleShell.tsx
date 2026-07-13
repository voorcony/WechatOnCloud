import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { useUI } from './ui';
import { useInstances, statusOf, ThemeToggle, ChangePassword } from './AppShell';
import { InstanceIcon } from './AppIcon';
import { useAiConsoleModel } from './pages/aiConsoleModel';
import './aiConsole.css';

import Console from './pages/Console';
import Inbox from './pages/Inbox';
import Customers from './pages/Customers';
import AiEmployeeCenter from './pages/AiEmployeeCenter';
import Knowledge from './pages/Knowledge';
import Tools from './pages/Tools';
import Approvals from './pages/Approvals';
import MonitorWall from './pages/MonitorWall';
import Team from './pages/Team';
import Settings from './pages/Settings';
import InstanceView from './pages/Desktop';

// AiConsoleShell —— AI Console 产品页面的模板化外壳（完全对标设计稿）：
//   左 248px 侧栏（品牌 + 微信实例列表 + 业务导航 + 用户区）+ 56px 顶栏 + 主区。
//   视觉自成一套（.ai-console scope），不复用云微原版 .shell/.sidebar，与 /i/:id、/admin 分流。
//   数据安全不变：实例来自真实 useInstances，AI 指标来自 useAiConsoleModel（真实优先，缺失 demo）。

// deterministic 伪随机：实例的"今日活跃"占位数字稳定不跳动（演示位，非敏感字段）。
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const I = {
  spark: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4"/></svg>),
  dashboard: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>),
  inbox: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>),
  customer: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>),
  agent: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>),
  kb: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>),
  flow: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M6 9v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9"/></svg>),
  pending: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
  monitor: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>),
  team: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="17" cy="7" r="3"/><path d="M21 21v-2a3 3 0 0 0-3-3h-1"/></svg>),
  setting: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.27 16.9l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.27l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  search: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  bell: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>),
  plus: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  menu: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>),
  logout: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>),
};

interface NavDef { path: string; label: string; icon: JSX.Element; }
const NAV: NavDef[] = [
  { path: '/', label: '总览', icon: I.dashboard },
  { path: '/inbox', label: '对话', icon: I.inbox },
  { path: '/customers', label: '客户', icon: I.customer },
  { path: '/ai-employees', label: 'AI 员工', icon: I.agent },
  { path: '/knowledge', label: '知识库', icon: I.kb },
  { path: '/tools', label: '工具与工作流', icon: I.flow },
  { path: '/approvals', label: '待确认', icon: I.pending },
  { path: '/monitor', label: '监控', icon: I.monitor },
  { path: '/team', label: '团队', icon: I.team },
  { path: '/settings', label: '系统设置', icon: I.setting },
];
const TITLE: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.path, n.label]));

// Console 触发「修改密码」弹窗用的上下文（弹窗由 shell 承载）。
const ShellCtx = createContext<{ openChangePassword: () => void }>({ openChangePassword: () => {} });
export const useAiShell = () => useContext(ShellCtx);

export default function AiConsoleShell() {
  const { user, logout, refresh } = useAuth();
  const { confirm } = useUI();
  const { instances, loaded } = useInstances();
  const model = useAiConsoleModel();
  const nav = useNavigate();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [curInst, setCurInst] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const isAdmin = user?.role === 'admin';
  const pageTitle = loc.pathname.startsWith('/i/') ? '实例工作台' : (TITLE[loc.pathname] ?? (loc.pathname.startsWith('/ai-employees') ? 'AI 员工' : '总览'));

  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    if (!curInst && instances.length) setCurInst(instances[0].id);
  }, [instances, curInst]);

  const isOn = (p: string) => (p === '/' ? loc.pathname === '/' : loc.pathname === p || loc.pathname.startsWith(p + '/'));
  const current = useMemo(() => instances.find((i) => i.id === curInst) ?? instances[0] ?? null, [instances, curInst]);
  const routeInst = useMemo(() => instances.find((i) => loc.pathname === `/i/${i.id}`) ?? null, [instances, loc.pathname]);
  const ctxInst = routeInst ?? current;
  const initial = (user?.username || '?').slice(0, 1).toUpperCase();
  const openMenu = () => setDrawer((d) => !d);

  return (
    <ShellCtx.Provider value={{ openChangePassword: () => setShowPw(true) }}>
      <div className="ai-console">
        <div className={'app' + (drawer ? ' drawer' : '')}>
          {/* ---------- 侧栏 ---------- */}
          <aside className="sb">
            <div className="brand">
              <span className="logo">{I.spark}</span>
              <span className="name">AI Console</span>
            </div>
            <div className="sb-scroll">
              <div className="sb-section">
                <div className="head">
                  <span>实例 · 微信</span>
                  {isAdmin && (
                    <button className="new" title="新建实例" onClick={() => nav('/admin')}>
                      {I.plus}
                    </button>
                  )}
                </div>
                <div className="inst-list">
                  {loaded && instances.length === 0 && <div className="sb-empty">暂无可用实例</div>}
                  {instances.map((inst) => {
                    const st = statusOf(inst);
                    const today = st.cls === 'st-on' ? 200 + (seedOf(inst.id) % 1200) : null;
                    return (
                      <button
                        key={inst.id}
                        className={'inst-row' + (ctxInst?.id === inst.id ? ' active' : '')}
                        onClick={() => {
                          setCurInst(inst.id);
                          nav(`/i/${inst.id}`);
                        }}
                        title={inst.name}
                      >
                        <span className="av">
                          <InstanceIcon icon={inst.icon} appType={inst.appType} size={28} radius={8} />
                          <span className={'stat ' + st.cls} />
                        </span>
                        <span className="meta">
                          <span className="n cut">{inst.name}</span>
                          <span className="p cut">微信 · {st.text}</span>
                        </span>
                        <span className="pill">{today != null ? today.toLocaleString() : '–'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="sb-section">
                <div className="head"><span>业务导航</span></div>
                <div className="nav">
                  {NAV.map((n) => (
                    <button key={n.path} className={'nav-item' + (isOn(n.path) ? ' active' : '')} onClick={() => nav(n.path)}>
                      <span className="ico">{n.icon}</span>
                      <span className="nav-label">{n.label}</span>
                      {n.path === '/approvals' && model.pendingTotal > 0 && <span className="badge">{model.pendingTotal}</span>}
                    </button>
                  ))}
                  {isAdmin && (
                    <button className={'nav-item' + (loc.pathname === '/admin' ? ' active' : '')} onClick={() => nav('/admin')} title="实例与账号管理（基础设施）">
                      <span className="ico">{I.setting}</span>
                      <span className="nav-label">实例·账号管理</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="user">
              <span className="avatar brand">{initial}</span>
              <div className="meta">
                <div className="n cut">{user?.username}</div>
                <div className="r">{isAdmin ? '管理员' : '子账号'}</div>
              </div>
              <div className="uact">
                <button title="系统设置" onClick={() => nav('/settings')}>{I.setting}</button>
                <button
                  title="退出登录"
                  onClick={async () => {
                    if (await confirm({ title: '退出登录？', confirmText: '退出' })) logout();
                  }}
                >
                  {I.logout}
                </button>
              </div>
            </div>
          </aside>

          {/* ---------- 顶栏 ---------- */}
          <header className="top">
            <button className="icon-btn rail-btn" title="侧栏" onClick={() => setDrawer((d) => !d)}>
              <span className="ico">{I.menu}</span>
            </button>
            <div className="crumb">
              <span>{user?.username} · 工作台</span>
              <span className="sep">/</span>
              <span className="here">{pageTitle}</span>
            </div>
            {ctxInst && (
              <span className="ctx-instance">
                <span className="ico sm">{I.agent}</span>
                {ctxInst.name} <span className="dim">·</span> ···{ctxInst.id.slice(-4)}
              </span>
            )}
            <div className="search">
              <span className="ico sm dim">{I.search}</span>
              <input placeholder="搜索客户、会话、知识库、员工…" />
              <span className="kbd">⌘ K</span>
            </div>
            <div className="actions">
              <ThemeToggle />
              <button className="icon-btn" title="通知">
                <span className="ico">{I.bell}</span>
                {model.pendingTotal > 0 && <span className="pip">{model.pendingTotal}</span>}
              </button>
              <span className="avatar brand" title={user?.username}>{initial}</span>
            </div>
          </header>

          {/* ---------- 主区 ---------- */}
          <main className="main">
            <Routes>
              <Route path="/" element={<Console />} />
              <Route path="/inbox" element={<Inbox onOpenMenu={openMenu} />} />
              <Route path="/customers" element={<Customers onOpenMenu={openMenu} />} />
              <Route path="/ai-employees" element={<AiEmployeeCenter onOpenMenu={openMenu} />} />
              <Route path="/knowledge" element={<Knowledge onOpenMenu={openMenu} />} />
              <Route path="/tools" element={<Tools onOpenMenu={openMenu} />} />
              <Route path="/approvals" element={<Approvals onOpenMenu={openMenu} />} />
              <Route path="/monitor" element={<MonitorWall onOpenMenu={openMenu} />} />
              <Route path="/team" element={<Team onOpenMenu={openMenu} />} />
              <Route path="/settings" element={<Settings onOpenMenu={openMenu} />} />
              <Route path="/i/:id" element={<InstanceView onOpenMenu={openMenu} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <div className="app-backdrop" onClick={() => setDrawer(false)} />
        </div>
      </div>
      {showPw && <ChangePassword onClose={() => setShowPw(false)} onSaved={() => refresh()} />}
    </ShellCtx.Provider>
  );
}
