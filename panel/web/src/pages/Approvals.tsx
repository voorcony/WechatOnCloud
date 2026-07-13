import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../AppShell';
import { useAiConsoleModel, riskDotCls, RISK_LABEL, type ApprovalAction, type Risk } from './aiConsoleModel';

// 待确认中心（/approvals）
// 定位：像 Gorgias macros approval / 风控队列一样处理 AI 起草的敏感动作——队列 + 选中动作详情 +
//   风险理由 / 关联员工 / 所属微信 / 审计提示。本页只读：批准 / 修改 / 拒绝为占位（真实写操作 API 后续接入），
//   接管实例复用已有控制权入口。数据脱敏（见 doc/AI员工二开后台.md）。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

type FilterKey = 'all' | 'reply_jobs_needs_human' | 'employee_tasks_waiting_approval' | 'send_actions_planned' | 'contact_remark_actions_planned' | 'group_operation_actions_planned';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'reply_jobs_needs_human', label: '回复待人工' },
  { key: 'employee_tasks_waiting_approval', label: '员工任务' },
  { key: 'send_actions_planned', label: '计划发送' },
  { key: 'contact_remark_actions_planned', label: '改备注' },
  { key: 'group_operation_actions_planned', label: '群操作' },
];

const riskWord: Record<Risk, string> = { high: '高', medium: '中', low: '低' };

export default function Approvals({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selKey, setSelKey] = useState<string | null>(null);

  const filtered = useMemo(() => (filter === 'all' ? m.actions : m.actions.filter((a) => a.type === filter)), [m.actions, filter]);
  const selected = filtered.find((a) => a.key === selKey) ?? filtered[0] ?? m.actions[0] ?? null;

  const c = m.pendingCounts;
  const kpis = [
    { key: 'total', label: '总待确认', value: m.pendingTotal, tone: m.pendingTotal ? ('warn' as const) : ('ok' as const) },
    { key: 'reply', label: '回复待人工', value: c.reply_jobs_needs_human ?? 0, tone: undefined },
    { key: 'send', label: '计划发送', value: c.send_actions_planned ?? 0, tone: (c.send_actions_planned ?? 0) ? ('danger' as const) : undefined },
    { key: 'remark', label: '改备注', value: c.contact_remark_actions_planned ?? 0, tone: undefined },
    { key: 'group', label: '群操作', value: c.group_operation_actions_planned ?? 0, tone: (c.group_operation_actions_planned ?? 0) ? ('danger' as const) : undefined },
  ];

  const empty = m.loaded && m.instances.length === 0;
  const ready = m.loaded && m.probed;
  const typeCount = (f: FilterKey) => (f === 'all' ? m.actions.length : m.actions.filter((a) => a.type === f).length);

  return (
    <div className="ws-page con-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">待确认中心</span>
        <ThemeToggle />
      </header>

      <div className="content console">
        <section className="con-hero apr-hero">
          <div className="con-hero-main">
            <div className="con-hero-eyebrow">Approval Queue</div>
            <h1 className="con-hero-title">待确认中心</h1>
            <p className="con-hero-sub">
              AI 起草的回复、主动发送、改备注、群操作等敏感动作在此排队，按风险与类型分流，等待人工确认后才落地。本页只读，不触发任何真实微信动作。
            </p>
          </div>
          <div className="con-hero-side">
            <div className="con-hero-stat">
              <b className={m.pendingTotal ? '' : 'ok'}>{m.pendingTotal}</b>
              <span>待确认动作</span>
            </div>
          </div>
        </section>

        {m.probed &&
          (m.real ? (
            <div className="con-src con-src-real">
              <span className="con-src-dot" /> 已接入真实待确认计数 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）
            </div>
          ) : (
            <div className="con-src con-src-demo">
              <span className="con-src-dot" /> 演示数据：尚未配置 AI 员工数据源。待确认为 deterministic 占位队列，仅展示聚合计数。
            </div>
          ))}

        <div className="ai-warn">
          当前仅展示<b>聚合待确认动作</b>的安全视图，队列正文均已脱敏。批准 / 修改 / 拒绝为占位按钮，<b>真实审批写操作 API 后续接入</b>；「接管实例」复用已有控制权入口。
        </div>

        <div className="con-kpis apr-kpis">
          {kpis.map((k) => (
            <div key={k.key} className={'con-kpi' + (k.tone ? ' con-kpi-' + k.tone : '')}>
              <span className="con-kpi-val">{k.value}</span>
              <span className="con-kpi-lbl">{k.label}</span>
            </div>
          ))}
        </div>

        {empty ? (
          <div className="empty-state">
            <div className="empty-blob">✅</div>
            <div className="empty-title">暂无可见实例</div>
            <div className="empty-sub">待确认动作来自被授权微信实例上的 AI 运行。请先在「系统设置」创建实例或联系管理员分配。</div>
          </div>
        ) : !ready ? (
          <div className="con-loading">加载待确认队列…</div>
        ) : m.actions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-blob">🎉</div>
            <div className="empty-title">当前没有等待确认的动作</div>
            <div className="empty-sub">AI 员工正常运行，暂无敏感动作需要你确认。新动作产生后会自动排入队列。</div>
          </div>
        ) : (
          <div className="apr-grid">
            {/* 左：动作队列（深色工作队列面板） */}
            <div className="apr-queue-card">
              <div className="con-panel-head con-panel-head-dark">
                <span className="con-panel-title">动作队列</span>
                <span className="con-live">
                  <i /> {filtered.length} 待处理
                </span>
              </div>
              <div className="apr-filterbar">
                {FILTERS.map((f) => (
                  <button key={f.key} className={'apr-filter' + (filter === f.key ? ' on' : '')} onClick={() => setFilter(f.key)}>
                    {f.label}
                    {typeCount(f.key) > 0 && <span className="apr-filter-n">{typeCount(f.key)}</span>}
                  </button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <div className="con-hollow con-hollow-dark">该类型下暂无待确认动作。</div>
              ) : (
                <ul className="apr-queue">
                  {filtered.map((a) => (
                    <li key={a.key}>
                      <button className={'apr-row' + (selected && a.key === selected.key ? ' on' : '')} onClick={() => setSelKey(a.key)}>
                        <span className={'apr-row-risk risk-' + a.risk} title={'风险 ' + riskWord[a.risk]} />
                        <span className="apr-row-main">
                          <span className="apr-row-top">
                            <span className="apr-row-type">{a.typeLabel}</span>
                            <span className={'apr-row-badge risk-' + a.risk}>风险 {riskWord[a.risk]}</span>
                          </span>
                          <span className="apr-row-sub">
                            @{a.instName} · {a.employeeName} · {a.ago}
                          </span>
                        </span>
                        <span className="apr-row-status">{a.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 右：选中动作详情 */}
            <aside className="apr-detail">
              {selected ? <ActionDetail action={selected} onTakeover={(id) => nav(`/i/${id}`)} /> : <div className="ai-note">选择一个动作查看详情。</div>}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionDetail({ action, onTakeover }: { action: ApprovalAction; onTakeover: (id: string) => void }) {
  return (
    <div className="apr-detail-card">
      <div className="apr-detail-head">
        <span className={'apr-detail-ic risk-' + action.risk}>{action.risk === 'high' ? '⚠️' : action.risk === 'medium' ? '🔶' : '📝'}</span>
        <div className="apr-detail-id">
          <div className="apr-detail-type">{action.typeLabel}</div>
          <div className="apr-detail-meta">
            <span className={'ai-dot ' + riskDotCls(action.risk)} /> {RISK_LABEL[action.risk]} · {action.status}
          </div>
        </div>
      </div>

      <div className="apr-detail-redacted">{action.redacted}</div>

      <div className="crm-fieldgrid apr-fieldgrid">
        <div className="crm-field">
          <span className="crm-field-k">动作类型</span>
          <span className="crm-field-v">{action.typeLabel}</span>
        </div>
        <div className="crm-field">
          <span className="crm-field-k">风险等级</span>
          <span className="crm-field-v">{RISK_LABEL[action.risk]}</span>
        </div>
        <div className="crm-field">
          <span className="crm-field-k">关联员工</span>
          <span className="crm-field-v">{action.employeeName}</span>
        </div>
        <div className="crm-field">
          <span className="crm-field-k">所属微信</span>
          <span className="crm-field-v">{action.instName}</span>
        </div>
        <div className="crm-field">
          <span className="crm-field-k">发起时间</span>
          <span className="crm-field-v">{action.ago}</span>
        </div>
        <div className="crm-field">
          <span className="crm-field-k">状态</span>
          <span className="crm-field-v">{action.status}</span>
        </div>
      </div>

      <div className="apr-reason">
        <div className="apr-reason-head">风险理由</div>
        <p className="apr-reason-body">{action.riskReason}</p>
      </div>

      <div className="apr-actions">
        <button className="btn btn-primary" disabled title="真实审批写操作 API 后续接入；本页不触发真实微信动作">
          批准
        </button>
        <button className="btn" disabled title="真实审批写操作 API 后续接入；本页不触发真实微信动作">
          修改
        </button>
        <button className="btn btn-danger" disabled title="真实审批写操作 API 后续接入；本页不触发真实微信动作">
          拒绝
        </button>
        {action.instId ? (
          <button className="btn apr-takeover" onClick={() => onTakeover(action.instId!)}>
            接管实例 ›
          </button>
        ) : (
          <button className="btn" disabled title="该动作所属实例不在你的可见范围内">
            实例不可见
          </button>
        )}
      </div>

      <div className="apr-audit">
        审计提示：本页仅展示聚合待确认动作的脱敏视图。批准 / 修改 / 拒绝需接入真实人审 API 后才会执行；任何真实发送 / 改备注 / 群操作都会留痕并要求人工确认。
      </div>
    </div>
  );
}
