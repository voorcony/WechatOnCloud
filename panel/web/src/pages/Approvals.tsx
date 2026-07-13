import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAiConsoleModel, riskDotCls, RISK_LABEL, type ApprovalAction, type Risk } from './aiConsoleModel';

// 待确认中心（/approvals）—— 对标模板「待确认队列」：KPI + 队列（左）+ 选中动作详情（右）。
// 本页只读：批准 / 修改 / 拒绝为占位（真实写操作 API 后续接入）；接管实例复用已有控制权入口。
// 数据脱敏：只展示动作类型 / 风险 / 关联员工 / 所属微信 / 脱敏摘要，绝不产出回复原文 / 聊天正文。

type FilterKey = 'all' | 'reply_jobs_needs_human' | 'employee_tasks_waiting_approval' | 'send_actions_planned' | 'contact_remark_actions_planned' | 'group_operation_actions_planned';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'reply_jobs_needs_human', label: '回复待人工' },
  { key: 'employee_tasks_waiting_approval', label: '员工任务' },
  { key: 'send_actions_planned', label: '计划发送' },
  { key: 'contact_remark_actions_planned', label: '改备注' },
  { key: 'group_operation_actions_planned', label: '群操作' },
];
const riskChip: Record<Risk, string> = { high: 'danger', medium: 'warn', low: 'brand' };
const riskWord: Record<Risk, string> = { high: '高', medium: '中', low: '低' };

export default function Approvals(_props: { onOpenMenu?: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selKey, setSelKey] = useState<string | null>(null);

  const filtered = useMemo(() => (filter === 'all' ? m.actions : m.actions.filter((a) => a.type === filter)), [m.actions, filter]);
  const selected = filtered.find((a) => a.key === selKey) ?? filtered[0] ?? m.actions[0] ?? null;
  const c = m.pendingCounts;
  const empty = m.loaded && m.instances.length === 0;
  const ready = m.loaded && m.probed;
  const typeCount = (f: FilterKey) => (f === 'all' ? m.actions.length : m.actions.filter((a) => a.type === f).length);

  return (
    <div>
      <div className="page-h">
        <div>
          <h1>待确认队列</h1>
          <p>AI 起草的敏感动作：发送、报价、改备注、群操作等。人在环，等待人工确认后才落地。</p>
        </div>
        <div className="act">
          <span className={'chip ' + (m.pendingTotal ? 'danger' : 'brand')}>{m.pendingTotal} 条待处理</span>
          <button className="btn" disabled title="真实审批写操作 API 后续接入">全部放行</button>
        </div>
      </div>

      {m.probed && (
        m.real ? (
          <div className="src-note real"><span className="d" /> 已接入真实待确认计数 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）</div>
        ) : (
          <div className="src-note demo"><span className="d" /> 演示数据：尚未配置 AI 员工数据源。待确认为 deterministic 占位队列，仅展示聚合计数。</div>
        )
      )}

      <div className="safe-note">
        当前仅展示<b>聚合待确认动作</b>的安全视图，队列正文均已脱敏。批准 / 修改 / 拒绝为占位按钮，<b>真实审批写操作 API 后续接入</b>；「接管实例」复用已有控制权入口。
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="label">总待确认</div><div className="value">{m.pendingTotal}</div><div className={'delta' + (m.pendingTotal ? ' warn' : '')}>{m.pendingTotal ? '需人工审核' : '暂无待办 🎉'}</div></div>
        <div className="kpi"><div className="label">回复待人工</div><div className="value">{c.reply_jobs_needs_human ?? 0}</div><div className="delta muted">AI 起草回复草稿</div></div>
        <div className="kpi"><div className="label">计划发送</div><div className="value">{c.send_actions_planned ?? 0}</div><div className={'delta' + ((c.send_actions_planned ?? 0) ? ' down' : ' muted')}>主动外发动作</div></div>
        <div className="kpi"><div className="label">群操作</div><div className="value">{c.group_operation_actions_planned ?? 0}</div><div className={'delta' + ((c.group_operation_actions_planned ?? 0) ? ' down' : ' muted')}>群公告 / 成员变更</div></div>
      </div>

      {empty ? (
        <div className="empty-state" style={{ marginTop: 16 }}>
          <div className="empty-blob">✅</div>
          <div className="empty-title">暂无可见实例</div>
          <div className="empty-sub">待确认动作来自被授权微信实例上的 AI 运行。请先在「实例·账号管理」创建实例或联系管理员分配。</div>
        </div>
      ) : !ready ? (
        <div className="loading">加载待确认队列…</div>
      ) : m.actions.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 16 }}>
          <div className="empty-blob">🎉</div>
          <div className="empty-title">当前没有等待确认的动作</div>
          <div className="empty-sub">AI 员工正常运行，暂无敏感动作需要你确认。新动作产生后会自动排入队列。</div>
        </div>
      ) : (
        <div className="apr-grid" style={{ marginTop: 16 }}>
          {/* 左：动作队列 */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-h">
              <span className="title">动作队列</span>
              <span className="chip" style={{ marginLeft: 'auto' }}>{filtered.length} 待处理</span>
            </div>
            <div className="tabs">
              {FILTERS.map((f) => (
                <button key={f.key} className={'tab' + (filter === f.key ? ' active' : '')} onClick={() => setFilter(f.key)}>
                  {f.label}{typeCount(f.key) > 0 && <span className="num">{typeCount(f.key)}</span>}
                </button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <div className="dim" style={{ padding: 16 }}>该类型下暂无待确认动作。</div>
            ) : (
              <div className="conv-list">
                {filtered.map((a) => (
                  <button key={a.key} className={'conv-item' + (selected && a.key === selected.key ? ' active' : '')} onClick={() => setSelKey(a.key)}>
                    <span className="av" style={{ background: 'var(--bg-soft)' }}>
                      <span className={'risk-dot ' + a.risk} style={{ width: 8, height: 8, borderRadius: 50, background: a.risk === 'high' ? 'var(--danger)' : a.risk === 'medium' ? 'var(--warn)' : 'var(--brand)' }} />
                    </span>
                    <div className="info">
                      <div className="n">
                        <span className="name cut">{a.typeLabel}</span>
                        <span className={'chip ' + riskChip[a.risk]} style={{ fontSize: 10, padding: '1px 6px' }}>风险 {riskWord[a.risk]}</span>
                        <span className="time">{a.ago}</span>
                      </div>
                      <div className="last cut">@{a.instName} · {a.employeeName}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 右：选中动作详情 */}
          {selected ? <ActionDetail action={selected} onTakeover={(id) => nav(`/i/${id}`)} /> : <div className="card"><div className="card-b dim">选择一个动作查看详情。</div></div>}
        </div>
      )}
    </div>
  );
}

function ActionDetail({ action, onTakeover }: { action: ApprovalAction; onTakeover: (id: string) => void }) {
  return (
    <div className="apr-detail-card">
      <div className="row">
        <span className="emoji" style={{ width: 40, height: 40, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, background: 'var(--bg-soft)' }}>
          {action.risk === 'high' ? '⚠️' : action.risk === 'medium' ? '🔶' : '📝'}
        </span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{action.typeLabel}</div>
          <div className="dim" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className={'dot ' + riskDotCls(action.risk)} /> {RISK_LABEL[action.risk]} · {action.status}
          </div>
        </div>
      </div>

      <div className="apr-redacted">{action.redacted}</div>

      <div className="kvgrid">
        <div className="kv"><span className="k">动作类型</span><span className="v">{action.typeLabel}</span></div>
        <div className="kv"><span className="k">风险等级</span><span className="v">{RISK_LABEL[action.risk]}</span></div>
        <div className="kv"><span className="k">关联员工</span><span className="v">{action.employeeName}</span></div>
        <div className="kv"><span className="k">所属微信</span><span className="v">{action.instName}</span></div>
        <div className="kv"><span className="k">发起时间</span><span className="v">{action.ago}</span></div>
        <div className="kv"><span className="k">状态</span><span className="v">{action.status}</span></div>
      </div>

      <div>
        <div className="apr-reason-head">风险理由</div>
        <p className="apr-reason-body">{action.riskReason}</p>
      </div>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn brand" disabled title="真实审批写操作 API 后续接入；本页不触发真实微信动作">批准</button>
        <button className="btn" disabled title="真实审批写操作 API 后续接入；本页不触发真实微信动作">修改后发</button>
        <button className="btn danger" disabled title="真实审批写操作 API 后续接入；本页不触发真实微信动作">拒绝</button>
        {action.instId ? (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => onTakeover(action.instId!)}>接管实例 ›</button>
        ) : (
          <button className="btn" style={{ marginLeft: 'auto' }} disabled title="该动作所属实例不在你的可见范围内">实例不可见</button>
        )}
      </div>

      <div className="apr-audit">
        审计提示：本页仅展示聚合待确认动作的脱敏视图。批准 / 修改 / 拒绝需接入真实人审 API 后才会执行；任何真实发送 / 改备注 / 群操作都会留痕并要求人工确认。
      </div>
    </div>
  );
}
