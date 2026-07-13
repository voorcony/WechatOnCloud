import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAiConsoleModel,
  stageLabel,
  RISK_LABEL,
  ROLE_GLYPH,
  type CrmCustomer,
  type Risk,
} from './aiConsoleModel';

// 客户画像 CRM（/customers）—— 对标产品模板「客户」页：page-h + KPI + 客户表格（table.t）。
// 定位：像 SCRM / Intercom 一样按「客户」而不是聊天窗口管理私域——阶段、意向、风险、主理员工、
//   互动计数、AI 跟进建议一屏可见。点击行在下方以 kvgrid 展示该客户脱敏画像详情。
// 数据只读、脱敏：只展示 code/hash / 阶段 / 意向 / 风险 / 计数 / AI 建议，绝不产出真实姓名、聊天正文、token。

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

const riskChip: Record<Risk, string> = { high: 'danger', medium: 'warn', low: 'brand' };

export default function Customers(_props: { onOpenMenu?: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [selKey, setSelKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return m.customers.filter(
      (c) =>
        matchFilter(c, filter) &&
        (!q || c.code.toLowerCase().includes(q) || c.instName.toLowerCase().includes(q) || stageLabel(c.stage).includes(q)),
    );
  }, [m.customers, filter, query]);
  const selected = filtered.find((c) => c.key === selKey) ?? null;

  const highIntent = m.customers.filter((c) => c.highIntent).length;
  const highRisk = m.customers.filter((c) => c.risk === 'high').length;
  const autonomous = m.customers.filter((c) => c.risk !== 'high').length;
  const autoRate = m.customers.length ? Math.round((autonomous / m.customers.length) * 100) : 0;

  const empty = m.loaded && m.instances.length === 0;
  const ready = m.loaded && m.probed;
  const filterCount = (f: FilterKey) => m.customers.filter((c) => matchFilter(c, f)).length;

  return (
    <div>
      <div className="page-h">
        <div>
          <h1>客户</h1>
          <p>统一的客户视图：阶段、意向、风险、主理员工与互动计数一屏可见，AI 给出安全的跟进建议，真实身份与聊天正文始终脱敏。</p>
        </div>
        <div className="act">
          <div className="row">
            <input
              className="input"
              placeholder="搜索客户 code / 所属微信 / 阶段"
              style={{ width: 240 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="select" style={{ width: 140 }} value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
              {FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                  {f.key !== 'all' ? `（${filterCount(f.key)}）` : ''}
                </option>
              ))}
            </select>
            <button className="btn primary" disabled title="客户由 AI 会话沉淀自动产生，手动新建后续接入">
              新建客户
            </button>
          </div>
        </div>
      </div>

      {m.probed &&
        (m.real ? (
          <div className="src-note real">
            <span className="d" /> 已接入真实客户画像 · 来源 ai-wechat-employee（只读，已按你可见实例过滤）
          </div>
        ) : (
          <div className="src-note demo">
            <span className="d" /> 演示数据：尚未配置 AI 员工数据源。实例为真实可见实例，客户画像为 deterministic 占位演示。
          </div>
        ))}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">客户总数</div>
          <div className="value">{m.customers.length}</div>
          <div className="delta muted">跨可见实例沉淀画像</div>
        </div>
        <div className="kpi">
          <div className="label">高意向</div>
          <div className="value">{highIntent}</div>
          <div className={'delta' + (highIntent ? '' : ' muted')}>{highIntent ? '建议优先跟进' : '暂无高意向'}</div>
        </div>
        <div className="kpi">
          <div className="label">高风险</div>
          <div className="value">{highRisk}</div>
          <div className={'delta' + (highRisk ? ' down' : ' muted')}>{highRisk ? '需重点关注' : '暂无高风险'}</div>
        </div>
        <div className="kpi">
          <div className="label">AI 自主率</div>
          <div className="value">{autoRate}%</div>
          <div className="delta muted">非高风险客户占比</div>
        </div>
      </div>

      {empty ? (
        <div className="empty-state" style={{ marginTop: 16 }}>
          <div className="empty-blob">👤</div>
          <div className="empty-title">暂无可见实例</div>
          <div className="empty-sub">客户画像来自被授权微信实例上的会话沉淀。请先在「实例·账号管理」创建实例或联系管理员分配。</div>
        </div>
      ) : !ready ? (
        <div className="loading">加载客户画像…</div>
      ) : m.customers.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 16 }}>
          <div className="empty-blob">👤</div>
          <div className="empty-title">暂无客户画像</div>
          <div className="empty-sub">启动 OCR 历史补全并运行记忆 / 画像抽取后，客户会在此按阶段、意向、风险沉淀。</div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
            <table className="t">
              <thead>
                <tr>
                  <th>客户</th>
                  <th>阶段</th>
                  <th>意向</th>
                  <th>风险</th>
                  <th>主理员工</th>
                  <th>互动</th>
                  <th>最近</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="dim" style={{ textAlign: 'center', padding: 24 }}>
                      该筛选 / 搜索下暂无客户。
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr
                      key={c.key}
                      onClick={() => setSelKey(selKey === c.key ? null : c.key)}
                      style={{ cursor: 'pointer', background: selected && c.key === selected.key ? 'var(--bg-hover)' : undefined }}
                    >
                      <td>
                        <div className="row">
                          <div className={'avatar ' + (c.risk === 'high' ? 'warn' : c.highIntent ? 'brand' : 'accent')}>{c.code.slice(0, 2)}</div>
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              客户 {c.code}
                              {c.highIntent && (
                                <span className="chip brand" style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px' }}>
                                  高意向
                                </span>
                              )}
                            </div>
                            <div className="dim mono" style={{ fontSize: 11 }}>{c.instName}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="chip outline">{stageLabel(c.stage)}</span>
                      </td>
                      <td className="mono">{c.intent ?? '—'}</td>
                      <td>
                        <span className={'chip ' + riskChip[c.risk]}>{RISK_LABEL[c.risk]}</span>
                      </td>
                      <td>
                        {ROLE_GLYPH[c.employeeRole] ?? '🤖'} {c.employeeName}
                      </td>
                      <td className="mono">
                        {c.messages}
                        <span className="dim" style={{ fontSize: 11 }}> （收 {c.incoming} / 发 {c.outgoing}）</span>
                      </td>
                      <td>
                        <span className="dim">{c.ago}</span>
                      </td>
                      <td>
                        <button
                          className="btn sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelKey(c.key);
                          }}
                        >
                          查看画像
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selected && <CustomerDetail c={selected} onClose={() => setSelKey(null)} onTakeover={(id) => nav(`/i/${id}`)} />}
        </>
      )}
    </div>
  );
}

function CustomerDetail({ c, onClose, onTakeover }: { c: CrmCustomer; onClose: () => void; onTakeover: (id: string) => void }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-h">
        <div className={'avatar ' + (c.risk === 'high' ? 'warn' : c.highIntent ? 'brand' : 'accent')}>{c.code.slice(0, 2)}</div>
        <span className="title">客户 {c.code}</span>
        <span className={'chip ' + riskChip[c.risk]}>{RISK_LABEL[c.risk]}</span>
        {c.highIntent && <span className="chip brand">高意向</span>}
        <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
          收起
        </button>
      </div>
      <div className="card-b">
        <div className="kvgrid">
          <div className="kv">
            <span className="k">客户 hash</span>
            <span className="v mono">{c.key.slice(0, 18) + (c.key.length > 18 ? '…' : '')}</span>
          </div>
          <div className="kv">
            <span className="k">阶段</span>
            <span className="v">{stageLabel(c.stage)}</span>
          </div>
          <div className="kv">
            <span className="k">意向分</span>
            <span className="v">{c.intent != null ? String(c.intent) : '—'}</span>
          </div>
          <div className="kv">
            <span className="k">风险</span>
            <span className="v">{RISK_LABEL[c.risk]}</span>
          </div>
          <div className="kv">
            <span className="k">消息数</span>
            <span className="v">{c.messages}（收 {c.incoming} / 发 {c.outgoing}）</span>
          </div>
          <div className="kv">
            <span className="k">记忆</span>
            <span className="v">活跃 {c.memActive} · 候选 {c.memCandidate}</span>
          </div>
          <div className="kv">
            <span className="k">主理 AI 员工</span>
            <span className="v">{ROLE_GLYPH[c.employeeRole] ?? '🤖'} {c.employeeName}</span>
          </div>
          <div className="kv">
            <span className="k">所属微信</span>
            <span className="v">{c.instName}{c.instSuffix ? ` · ···${c.instSuffix}` : ''}</span>
          </div>
          <div className="kv">
            <span className="k">最近观察</span>
            <span className="v">{c.ago}{c.recent ? ' · 近 24h 有互动' : ' · 近期沉默'}</span>
          </div>
        </div>

        <div className="safe-note" style={{ marginTop: 14, marginBottom: 0 }}>
          <div className="row" style={{ gap: 6, marginBottom: 4 }}>
            <span>✳️</span>
            <b>AI 跟进建议</b>
          </div>
          {c.suggestion}
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            建议由阶段 / 意向 / 风险派生，仅供人工参考；不引用聊天正文，敏感动作仍需人工确认。
          </div>
        </div>

        <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
          {c.instId ? (
            <button className="btn" onClick={() => onTakeover(c.instId!)}>
              接管实例 ›
            </button>
          ) : (
            <button className="btn" disabled title="该客户所属实例不在你的可见范围内">
              实例不可见
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
