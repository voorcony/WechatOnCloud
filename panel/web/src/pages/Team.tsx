import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances } from '../AppShell';
import { ThemeToggle } from '../AppShell';
import { api, type PanelUser } from '../api';

// 团队与权限（/team）
// 复用 WOC 现有 auth / RBAC 语义，不新造租户：管理员看真实成员（用户名 / 角色 / 授权实例范围），
// 子账号看自己的授权范围。成员的增删改 / 实例授权仍在「系统设置 → 用户」(/admin) 完成，本页只读概览 +
// 跳转，绝不展示密码 / token / 明文凭据。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const TeamIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8.5" cy="8" r="3" /><path d="M2.5 19a6 6 0 0 1 12 0" />
    <path d="M15.5 5.3a3 3 0 0 1 0 5.4" /><path d="M17 13.2a5.5 5.5 0 0 1 4 5.3" />
  </svg>
);

const roleMeta = (role: PanelUser['role']): { label: string; cls: string } =>
  role === 'admin' ? { label: '超级管理员', cls: 'role-super' } : { label: '运营（子账号）', cls: 'role-op' };

export default function Team({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { instances } = useInstances();
  const isAdmin = user?.role === 'admin';
  const [users, setUsers] = useState<PanelUser[] | null>(null);
  const [err, setErr] = useState('');

  const instName = (id: string) => instances.find((i) => i.id === id)?.name ?? `实例 ···${id.slice(-4)}`;

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    api
      .listUsers()
      .then((r) => alive && setUsers(r.users))
      .catch((e) => alive && setErr(e?.message || '加载失败'));
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const rows: PanelUser[] = isAdmin ? users ?? [] : user ? [user] : [];
  const admins = rows.filter((u) => u.role === 'admin').length;
  const subs = rows.filter((u) => u.role !== 'admin').length;

  return (
    <div className="ws-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">团队与权限</span>
        <ThemeToggle />
      </header>

      <div className="content">
        <div className="page-pad">
          <div className="ai-note">
            团队沿用系统的账号与实例授权（RBAC）：管理员可操作全部实例，子账号仅能操作被授权实例——
            这也正是 AI 员工的可操作范围边界。成员管理与实例授权在
            <button className="btn-text" style={{ padding: '0 4px' }} onClick={() => nav('/admin?tab=users')}>系统设置 → 用户</button>
            完成，本页只读。
          </div>

          <div className="ai-kpis" style={{ marginTop: 12 }}>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{isAdmin ? rows.length : '—'}</span>
              <span className="ai-kpi-lbl">成员总数</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{isAdmin ? admins : '—'}</span>
              <span className="ai-kpi-lbl">管理员</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{isAdmin ? subs : '—'}</span>
              <span className="ai-kpi-lbl">子账号</span>
            </div>
            <div className="ai-kpi">
              <span className="ai-kpi-val">{instances.length}</span>
              <span className="ai-kpi-lbl">{isAdmin ? '可授权实例' : '我的授权实例'}</span>
            </div>
          </div>

          {!isAdmin ? (
            <div className="ai-sec" style={{ marginTop: 14 }}>
              <div className="ai-sec-title">我的权限范围</div>
              <div className="team-row">
                <span className="team-av">{(user?.username ?? '?').slice(0, 1).toUpperCase()}</span>
                <div className="team-id">
                  <span className="team-name">{user?.username}</span>
                  <span className="team-scope">{instances.length} 个被授权实例 · AI 员工仅在这些实例内动作</span>
                </div>
                <span className="ai-chip role-op">运营（子账号）</span>
              </div>
              <div className="ai-choice-row" style={{ marginTop: 10 }}>
                {instances.length === 0 ? (
                  <span className="ai-note" style={{ margin: 0 }}>暂无被授权实例，请联系管理员分配。</span>
                ) : (
                  instances.map((i) => <span key={i.id} className="ai-choice on" style={{ cursor: 'default' }}>{i.name}</span>)
                )}
              </div>
              <div className="ai-set-hint">如需调整授权范围或新增成员，请联系管理员在「系统设置」中操作。</div>
            </div>
          ) : (
            <div className="ai-sec" style={{ marginTop: 14 }}>
              <div className="ai-sec-title">
                成员
                <button className="btn-text ai-sec-more" onClick={() => nav('/admin?tab=users')}>在系统设置管理 ›</button>
              </div>
              {err && <div className="ai-warn">{err}</div>}
              {users === null && !err ? (
                <div className="ai-note">加载成员…</div>
              ) : rows.length === 0 ? (
                <div className="ai-note">暂无成员。</div>
              ) : (
                <div className="team-list">
                  {rows.map((u) => {
                    const rm = roleMeta(u.role);
                    const scoped = u.role === 'admin' ? instances.map((i) => i.id) : u.allowedInstances;
                    return (
                      <div key={u.id} className="team-row">
                        <span className={'team-av ' + rm.cls}>{u.username.slice(0, 1).toUpperCase()}</span>
                        <div className="team-id">
                          <span className="team-name">
                            {u.username}
                            {u.disabled && <span className="ai-chip role-off">已停用</span>}
                            {u.mustChangePassword && <span className="ai-chip risk-medium">默认密码</span>}
                          </span>
                          <span className="team-scope">
                            {u.role === 'admin' ? '全部实例（隐式授权）' : `${scoped.length} 个授权实例`}
                          </span>
                        </div>
                        <div className="team-insts">
                          {scoped.slice(0, 4).map((id) => (
                            <span key={id} className="ai-chip role-inst">{instName(id)}</span>
                          ))}
                          {scoped.length > 4 && <span className="ai-chip role-inst">+{scoped.length - 4}</span>}
                        </div>
                        <span className={'ai-chip ' + rm.cls}>{rm.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="ai-set-hint">
                展示用户名 / 角色 / 授权实例范围（安全字段）；不展示密码 / token。增删改与授权在系统设置完成。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
