import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../AppShell';
import {
  useAiConsoleModel,
  stageLabel,
  riskDotCls,
  RISK_LABEL,
  ROLE_GLYPH,
  type CrmCustomer,
  type Risk,
} from './aiConsoleModel';

// 客户画像 CRM（/customers）
// 定位：像 SCRM / Intercom 一样按「客户」管理私域运营——左侧客户列表 + 筛选，中间选中客户画像，
//   右侧 AI 建议 / 负责员工 / 所属微信 / 最近观察 / 风险提示。数据只读、脱敏（见 doc/AI员工二开后台.md）。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

type FilterKey = 'all' | 'high_intent' | 'high_risk' | 'after_sales' | 'silent';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'high_intent', label: '高意向' },
  { key: 'high_risk', label: '高风险' },
  { key: 'after_sales', label: '售后' },
  { key: 'silent', label: '沉默' },
];
function matchFilter(c: CrmCustomer, f: FilterKey): boolean {
  switch (f) {
    case 'high_intent':
      return c.highIntent;
    case 'high_risk':
      return c.risk === 'high';
    case 'after_sales':
      return c.stage === 'after_sales';
    case 'silent':
      return !c.recent;
    default:
      return true;
  }
}

export default function Customers({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selKey, setSelKey] = useState<string | null>(null);

  const filtered = useMemo(() => m.customers.filter((c) => matchFilter(c, filter)), [m.customers, filter]);
  const selected = filtered.find((c) => c.key === selKey) ?? filtered[0] ?? m.customers[0] ?? null;

  const highIntent = m.customers.filter((c) => c.highIntent).length;
  const highRisk = m.customers.filter((c) => c.risk === 'high').length;
  const todayObserved = m.customers.filter((c) => c.recent).length;
  const memories = m.customers.reduce((s, c) => s + c.memActive, 0);

  const kpis = [
    { key: 'total', label: '客户数', value: m.customers.length, tone: 'accent' as const },
    { key: 'hi', label: '高意向', value: highIntent, tone: highIntent ? ('accent' as const) : undefined },
    { key: 'risk', label: '高风险', value: highRisk, tone: highRisk ? ('danger' as const) : undefined },
    { key: 'today', label: '今日观察', value: todayObserved, tone: 'ok' as const },
    { key: 'mem', label: '记忆数', value: memories, tone: undefined },
  ];

  const empty = m.loaded && m.instances.length === 0;
  const ready = m.loaded && m.probed;
  const filterCount = (f: FilterKey) => m.customers.filter((c) => matchFilter(c, f)).length;

  return (
    <div className="ws-page con-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">客户画像 CRM</span>
        <ThemeToggle />
      </header>

      <div className="content console">
        <section className="con-hero crm-hero">
          <div className="con-hero-main">
            <div className="con-hero-eyebrow">Customer CRM</div>
            <h1 className="con-hero-title">客户画像 CRM</h1>
            <p className="con-hero-sub">
              按「客户」而不是聊天窗口管理私域：阶段、意向、风险、记忆与所属微信一屏可见，AI 给出安全的跟进建议，正文与真实身份始终脱敏。
            </p>
          </div>
          <div className="con-hero-side">
            <div className="con-hero-stat">
              <b>{m.customers.length}</b>
              <span>客户画像</span>
            </div>
            <div className="con-hero-divider" />
            <div className="con-hero-stat">
              <b className={highIntent ? 'ok' : ''}>{highIntent}</b>
              <span>高意向</span>
            </div>
          </div>
        </section>

        {m.probed &&
          (m.real ? (
            <div className="con-src con-src-real">
              <span className="con-src-dot" /> 已接入真实客户画像 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）
            </div>
          ) : (
            <div className="con-src con-src-demo">
              <span className="con-src-dot" /> 演示数据：尚未配置 AI 员工数据源。实例为真实可见实例，客户画像为 deterministic 占位演示。
            </div>
          ))}

        <div className="con-kpis crm-kpis">
          {kpis.map((k) => (
            <div key={k.key} className={'con-kpi' + (k.tone ? ' con-kpi-' + k.tone : '')}>
              <span className="con-kpi-val">{k.value}</span>
              <span className="con-kpi-lbl">{k.label}</span>
            </div>
          ))}
        </div>

        {empty ? (
          <div className="empty-state">
            <div className="empty-blob">👤</div>
            <div className="empty-title">暂无可见实例</div>
            <div className="empty-sub">客户画像来自被授权微信实例上的会话沉淀。请先在「系统设置」创建实例或联系管理员分配。</div>
          </div>
        ) : !ready ? (
          <div className="con-loading">加载客户画像…</div>
        ) : m.customers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-blob">👤</div>
            <div className="empty-title">暂无客户画像</div>
            <div className="empty-sub">启动 OCR 历史补全并运行记忆 / 画像抽取后，客户会在此按阶段、意向、风险沉淀。</div>
          </div>
        ) : (
          <div className="crm-grid">
            {/* 左：筛选 + 客户列表 */}
            <aside className="crm-list">
              <div className="crm-filterbar">
                {FILTERS.map((f) => (
                  <button key={f.key} className={'ai-filter' + (filter === f.key ? ' on' : '')} onClick={() => setFilter(f.key)}>
                    {f.label}
                    {f.key !== 'all' && filterCount(f.key) > 0 && <span className="ai-tab-badge">{filterCount(f.key)}</span>}
                  </button>
                ))}
              </div>
              <div className="crm-list-body">
                {filtered.length === 0 ? (
                  <div className="ai-note" style={{ padding: '8px 4px' }}>该筛选下暂无客户。</div>
                ) : (
                  filtered.map((c) => (
                    <button
                      key={c.key}
                      className={'crm-item' + (selected && c.key === selected.key ? ' on' : '')}
                      onClick={() => setSelKey(c.key)}
                    >
                      <span className={'ai-cust-av risk-' + c.risk}>{c.code.slice(0, 2)}</span>
                      <span className="crm-item-main">
                        <span className="crm-item-top">
                          <span className="crm-item-name">客户 {c.code}</span>
                          <span className={'ai-dot ' + riskDotCls(c.risk)} title={RISK_LABEL[c.risk]} />
                        </span>
                        <span className="crm-item-sub">
                          <span className="ai-role ai-role-stage">{stageLabel(c.stage)}</span>
                          <span className="crm-item-inst">{c.instName}</span>
                          <span className="crm-item-ago">{c.ago}</span>
                        </span>
                      </span>
                      <span className="crm-item-intent">
                        <b>{c.intent ?? '—'}</b>
                        <small>意向</small>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>

            {/* 中：选中客户画像 */}
            {selected ? (
              <>
                <section className="crm-detail">
                  <div className="crm-detail-head">
                    <span className={'ai-cust-av risk-' + selected.risk} style={{ width: 52, height: 52, borderRadius: 14, fontSize: 15 }}>
                      {selected.code.slice(0, 2)}
                    </span>
                    <div className="crm-detail-id">
                      <div className="crm-detail-name">
                        客户 {selected.code}
                        <span className={'ai-status ai-status-' + (selected.risk === 'high' ? 'off' : selected.risk === 'medium' ? 'warn' : 'on')}>
                          {RISK_LABEL[selected.risk]}
                        </span>
                        {selected.highIntent && <span className="ai-status ai-status-on">高意向</span>}
                      </div>
                      <div className="crm-detail-role">
                        <span className="ai-role ai-role-stage">{stageLabel(selected.stage)}</span>
                        <span className="crm-detail-sub">所属微信 · {selected.instName}</span>
                      </div>
                    </div>
                    <div className="crm-detail-quick">
                      <div>
                        <b className="accent">{selected.intent ?? '—'}</b>
                        <span>意向分</span>
                      </div>
                      <div>
                        <b>{selected.messages}</b>
                        <span>消息</span>
                      </div>
                      <div>
                        <b>
                          {selected.memActive}
                          <small>/{selected.memCandidate}</small>
                        </b>
                        <span>记忆</span>
                      </div>
                    </div>
                  </div>

                  <div className="crm-fieldgrid">
                    <Field label="客户 hash" mono value={selected.key.slice(0, 18) + (selected.key.length > 18 ? '…' : '')} />
                    <Field label="阶段" value={stageLabel(selected.stage)} />
                    <Field label="意向分" value={selected.intent != null ? String(selected.intent) : '—'} />
                    <Field label="风险" value={RISK_LABEL[selected.risk]} />
                    <Field label="消息数" value={`${selected.messages}（收 ${selected.incoming} / 发 ${selected.outgoing}）`} />
                    <Field label="记忆" value={`活跃 ${selected.memActive} · 候选 ${selected.memCandidate}`} />
                    <Field label="所属微信" value={`${selected.instName}${selected.instSuffix ? ` · ···${selected.instSuffix}` : ''}`} />
                    <Field label="最近观察" value={selected.ago} />
                  </div>

                  <div className="crm-suggest">
                    <div className="crm-suggest-head">
                      <span className="crm-suggest-ic">✳️</span> AI 跟进建议
                    </div>
                    <p className="crm-suggest-body">{selected.suggestion}</p>
                    <div className="crm-suggest-note">建议由阶段 / 意向 / 风险派生，仅供人工参考；不引用聊天正文，敏感动作仍需人工确认。</div>
                  </div>
                </section>

                {/* 右：AI 建议 / 负责员工 / 所属微信 / 最近观察 / 风险提示 */}
                <aside className="crm-rail">
                  <RailCard title="负责 AI 员工">
                    <div className="crm-rail-emp">
                      <span className={'ai-emp-av ai-av-' + selected.employeeRole}>{ROLE_GLYPH[selected.employeeRole] ?? '🤖'}</span>
                      <div className="crm-rail-emp-id">
                        <div className="crm-rail-emp-name">{selected.employeeName}</div>
                        <div className="crm-rail-emp-sub">{selected.employeeRole ? `${selected.employeeRole}岗` : '未分配岗位'}</div>
                      </div>
                    </div>
                  </RailCard>

                  <RailCard title="所属微信">
                    <div className="crm-rail-line">
                      <span className="crm-rail-k">实例</span>
                      <span className="crm-rail-v">{selected.instName}</span>
                    </div>
                    <div className="crm-rail-line">
                      <span className="crm-rail-k">标识</span>
                      <span className="crm-rail-v mono">···{selected.instSuffix || '——'}</span>
                    </div>
                    {selected.instId ? (
                      <button className="btn crm-rail-btn" onClick={() => nav(`/i/${selected.instId}`)}>
                        接管实例 ›
                      </button>
                    ) : (
                      <button className="btn crm-rail-btn" disabled title="该客户所属实例不在你的可见范围内">
                        实例不可见
                      </button>
                    )}
                  </RailCard>

                  <RailCard title="最近观察">
                    <div className="crm-rail-line">
                      <span className="crm-rail-k">最近活跃</span>
                      <span className="crm-rail-v">{selected.ago}</span>
                    </div>
                    <div className="crm-rail-line">
                      <span className="crm-rail-k">活跃度</span>
                      <span className="crm-rail-v">{selected.recent ? '近 24h 有互动' : '近期沉默'}</span>
                    </div>
                    <div className="crm-rail-line">
                      <span className="crm-rail-k">往来消息</span>
                      <span className="crm-rail-v">收 {selected.incoming} · 发 {selected.outgoing}</span>
                    </div>
                  </RailCard>

                  <RailCard title="风险提示" tone={selected.risk === 'high' ? 'danger' : selected.risk === 'medium' ? 'warn' : undefined}>
                    <p className="crm-rail-risk">
                      {selected.risk === 'high'
                        ? '高风险：建议人工优先介入，暂缓自动外发，避免升级投诉。'
                        : selected.risk === 'medium'
                          ? '需关注：情绪或意图存在波动，跟进时留意口径与频率。'
                          : '暂无显著风险信号，可按常规节奏跟进。'}
                    </p>
                  </RailCard>
                </aside>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="crm-field">
      <span className="crm-field-k">{label}</span>
      <span className={'crm-field-v' + (mono ? ' mono' : '')}>{value}</span>
    </div>
  );
}

function RailCard({ title, tone, children }: { title: string; tone?: 'danger' | 'warn'; children: React.ReactNode }) {
  return (
    <div className={'crm-rail-card' + (tone ? ' crm-rail-' + tone : '')}>
      <div className="crm-rail-title">{title}</div>
      {children}
    </div>
  );
}
