import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances } from '../AppShell';
import { api, type PanelUser } from '../api';

// 团队与权限（/team）—— 完全对标模板 pageTeam：.page-h + .member-list / .member-row。
// 复用 WOC 现有 auth / RBAC 语义，不新造租户：管理员看真实成员（用户名 / 角色 / 授权实例范围），
// 子账号看自己的授权范围。成员的增删改 / 实例授权仍在「系统设置 → 用户」(/admin) 完成，本页只读概览 +
// 跳转，绝不展示密码 / token / 明文凭据。数据均为真实（api.listUsers / useAuth），故用 src-note real。

export const TeamIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8.5" cy="8" r="3" /><path d="M2.5 19a6 6 0 0 1 12 0" />
    <path d="M15.5 5.3a3 3 0 0 1 0 5.4" /><path d="M17 13.2a5.5 5.5 0 0 1 4 5.3" />
  </svg>
);

// 角色 → chip 皮肤：超管 brand / 运营（子账号）accent；只读回退 outline。
const roleMeta = (role: PanelUser['role']): { label: string; chip: string; avatar: string } =>
  role === 'admin'
    ? { label: '超级管理员', chip: 'brand', avatar: 'brand' }
    : { label: '运营（子账号）', chip: 'accent', avatar: 'accent' };

export default function Team({ onOpenMenu: _onOpenMenu }: { onOpenMenu: () => void }) {
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
  const loading = isAdmin && users === null && !err;

  return (
    <div>
      <div className="page-h">
        <div>
          <h1>团队与权限</h1>
          <p>沿用系统账号与实例授权（RBAC）：管理员可操作全部实例，子账号仅能操作被授权实例——这正是 AI 员工的可操作范围边界。</p>
        </div>
        <div className="act">
          <button className="btn" disabled title="成员管理在「系统设置 → 用户」，后续接入">邀请成员</button>
          {isAdmin && <button className="btn primary" onClick={() => nav('/admin?tab=users')}>在系统设置管理 ›</button>}
        </div>
      </div>

      <div className="src-note real">
        <span className="d" /> 已接入真实成员与授权（只读）· 来源 WOC 账号系统。展示用户名 / 角色 / 授权实例范围（安全字段），不展示密码 / token。
      </div>

      {err ? (
        <div className="empty-state">
          <div className="empty-blob">⚠️</div>
          <div className="empty-title">成员加载失败</div>
          <div className="empty-sub">{err}</div>
        </div>
      ) : loading ? (
        <div className="loading">加载成员…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-blob">👥</div>
          <div className="empty-title">暂无成员</div>
          <div className="empty-sub">成员的增删改与实例授权在「系统设置 → 用户」完成，本页为只读概览。</div>
          {isAdmin && (
            <div className="empty-action">
              <button className="btn primary" onClick={() => nav('/admin?tab=users')}>去系统设置</button>
            </div>
          )}
        </div>
      ) : (
        <div className="member-list">
          {rows.map((u) => {
            const rm = roleMeta(u.role);
            const scoped = u.role === 'admin' ? instances.map((i) => i.id) : u.allowedInstances;
            const self = u.id === user?.id;
            return (
              <div key={u.id} className="member-row">
                <span className={'avatar ' + rm.avatar}>{u.username.slice(0, 1).toUpperCase()}</span>

                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <b className="cut">{u.username}</b>
                    {self && <span className="chip outline">我</span>}
                    {u.disabled && <span className="chip danger">已停用</span>}
                    {u.mustChangePassword && <span className="chip warn">默认密码</span>}
                  </div>
                  <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                    {u.role === 'admin'
                      ? '全部实例（隐式授权）· AI 员工可在所有实例内动作'
                      : `${scoped.length} 个授权实例 · AI 员工仅在这些实例内动作`}
                  </div>
                </div>

                <div className="col-inst">
                  {scoped.length === 0 ? (
                    <span className="chip outline">未授权</span>
                  ) : (
                    <>
                      {scoped.slice(0, 3).map((id) => (
                        <span key={id} className="chip">{instName(id)}</span>
                      ))}
                      {scoped.length > 3 && <span className="chip outline">+{scoped.length - 3}</span>}
                    </>
                  )}
                </div>

                <div className="col-role">
                  <span className={'chip ' + rm.chip}>{rm.label}</span>
                </div>

                <div className="act">
                  <button className="btn sm ghost" disabled title="成员编辑在「系统设置 → 用户」，后续接入">编辑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
