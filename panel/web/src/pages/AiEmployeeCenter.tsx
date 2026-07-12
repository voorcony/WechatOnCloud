import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useInstances, statusOf } from '../AppShell';
import { appProfile, type InstanceWithStatus } from '../api';
import { InstanceIcon } from '../AppIcon';

// AI 员工中心（UI MVP）
// 定位：云微信实例之上的 AI 私域员工总控台。
//   大秘书 → AI 员工 → 云微信实例 → 任务 → 时间线 → 待确认
// 严格约束（见 doc/AI员工中心.md）：
//   - 复用云微已有登录态 / admin·sub 角色 / 子账号体系 / 实例访问授权。
//   - 不调用新的后端 API、不生成真实 token、不触发任何发送/审批/绑定真实动作。
//   - 员工/任务/时间线/待确认均为演示占位；实例 id/name/appType/status 来自用户本就可见的实例。

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

type Seg = 'overview' | 'employees' | 'instances' | 'tasks' | 'timeline' | 'pending' | 'bind';
const SEGMENTS: { key: Seg; label: string }[] = [
  { key: 'overview', label: '总控台' },
  { key: 'employees', label: 'AI 员工' },
  { key: 'instances', label: '微信实例' },
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

  // KPI：可见实例数为真值，其余为演示派生
  const abnormal = instances.filter((i) => i.runtime !== 'running' || !i.wechat.installed).length;
  const employeeCount = instances.length === 0 ? 0 : Math.max(4, instances.length);
  const todayMsgs = instances.reduce((sum, i) => sum + 40 + (seedOf(i.id) % 160), 0);
  const pendingCount = instances.length === 0 ? 0 : (seedOf(instances.map((i) => i.id).join()) % 5) + 1;

  const kpis = [
    { label: '可见实例', value: instances.length, tone: '' },
    { label: 'AI 员工', value: employeeCount, tone: '' },
    { label: '今日消息', value: todayMsgs, tone: 'demo' },
    { label: '待确认', value: pendingCount, tone: pendingCount ? 'warn' : '' },
    { label: '异常', value: abnormal, tone: abnormal ? 'danger' : '' },
  ];

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
        ) : !loaded ? (
          <div className="ai-loading">加载可见实例…</div>
        ) : (
          <div className="ai-panel">
            {seg === 'overview' && <Overview binds={binds} isAdmin={isAdmin} />}
            {seg === 'employees' && <Employees binds={binds} />}
            {seg === 'instances' && <InstancesTab binds={binds} onOpen={(id) => nav(`/i/${id}`)} />}
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
