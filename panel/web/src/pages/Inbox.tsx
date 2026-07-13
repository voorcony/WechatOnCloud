import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../AppShell';
import {
  useAiConsoleModel,
  stageLabel,
  RISK_LABEL,
  riskDotCls,
  permKeyLabel,
  getInstanceEmployee,
  type CrmCustomer,
} from './aiConsoleModel';

// 对话 / Inbox（/inbox）
// 复刻设计稿三栏结构（会话列表 / 消息流 / 客户画像+工具），但严守安全红线：
//   中栏「消息流」绝不展示聊天正文 / 回复原文，只呈现安全会话概览（hash / 计数 / 阶段 / 意向 / 风险 /
//   记忆计数）+ 安全阶段时间线 + 明确「正文详情待接入」占位。接管请进入实例桌面。
// 数据来自 useAiConsoleModel（真实优先，失败 deterministic 演示）。

const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const InboxIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.6L3 21l1.9-5.8A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
);

type Filter = 'all' | 'high_intent' | 'risk' | 'recent';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'high_intent', label: '高意向' },
  { key: 'risk', label: '风险' },
  { key: 'recent', label: '近期活跃' },
];

export default function Inbox({ onOpenMenu }: { onOpenMenu: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const [filter, setFilter] = useState<Filter>('all');
  const [selKey, setSelKey] = useState<string | null>(null);
  const [opened, setOpened] = useState(false); // 移动端：是否已钻入会话详情

  const list = useMemo(() => {
    const base = m.customers;
    if (filter === 'high_intent') return base.filter((c) => c.highIntent);
    if (filter === 'risk') return base.filter((c) => c.risk === 'high');
    if (filter === 'recent') return base.filter((c) => c.recent);
    return base;
  }, [m.customers, filter]);

  const selected = useMemo<CrmCustomer | null>(
    () => list.find((c) => c.key === selKey) ?? list[0] ?? null,
    [list, selKey],
  );

  const counts = {
    all: m.customers.length,
    high_intent: m.customers.filter((c) => c.highIntent).length,
    risk: m.customers.filter((c) => c.risk === 'high').length,
    recent: m.customers.filter((c) => c.recent).length,
  };

  return (
    <div className="ws-page">
      <header className="ws-head">
        <button className="ws-menu" onClick={onOpenMenu} aria-label="菜单">
          {MenuIcon}
        </button>
        <span className="ws-title">对话</span>
        <ThemeToggle />
      </header>

      <div className="content inbox-content">
        {m.probed && !m.real && (
          <div className="con-src con-src-demo inbox-banner">
            <span className="con-src-dot" /> 演示会话：尚未配置数据源。会话为占位演示，消息正文永不在控制台展示（安全红线）。
          </div>
        )}
        <div className={'inbox' + (opened ? ' show-mid' : '')}>
          {/* 左：会话列表 */}
          <aside className="inbox-col inbox-left">
            <div className="inbox-tabs">
              {FILTERS.map((f) => (
                <button key={f.key} className={'inbox-tab' + (filter === f.key ? ' on' : '')} onClick={() => setFilter(f.key)}>
                  {f.label}
                  <span className="inbox-tab-n">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <div className="inbox-conv-list">
              {list.length === 0 ? (
                <div className="ai-note" style={{ margin: 12 }}>该筛选下暂无会话。</div>
              ) : (
                list.map((c) => (
                  <button
                    key={c.key}
                    className={'inbox-conv' + (selected?.key === c.key ? ' on' : '')}
                    onClick={() => {
                      setSelKey(c.key);
                      setOpened(true);
                    }}
                  >
                    <span className={'inbox-conv-av risk-' + c.risk}>{c.code.slice(0, 2)}</span>
                    <div className="inbox-conv-main">
                      <div className="inbox-conv-top">
                        <span className="inbox-conv-name">客户 {c.code}</span>
                        <span className="inbox-conv-ago">{c.ago}</span>
                      </div>
                      <div className="inbox-conv-sub">
                        <span className={'ai-chip risk-chip risk-' + c.risk}>{RISK_LABEL[c.risk]}</span>
                        <span className="inbox-conv-stage">{stageLabel(c.stage)} · {c.instName}</span>
                      </div>
                    </div>
                    {c.incoming > 0 && <span className="inbox-conv-badge">{c.incoming}</span>}
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* 中：消息流（安全占位，无正文） */}
          <section className="inbox-col inbox-mid">
            {!selected ? (
              <div className="inbox-empty">
                <div className="empty-blob">💬</div>
                <div className="empty-title">选择一个会话</div>
                <div className="empty-sub">左侧选择会话查看安全概览。控制台不展示聊天正文。</div>
              </div>
            ) : (
              <>
                <div className="inbox-chat-head">
                  <button className="inbox-back" onClick={() => setOpened(false)} aria-label="返回会话列表">‹</button>
                  <span className={'inbox-conv-av risk-' + selected.risk}>{selected.code.slice(0, 2)}</span>
                  <div className="inbox-chat-id">
                    <span className="inbox-chat-name">客户 {selected.code}</span>
                    <span className="inbox-chat-meta">
                      {selected.instName} · 由 {selected.employeeName} 接管 · {selected.ago}
                    </span>
                  </div>
                  {selected.instId && (
                    <button className="btn btn-primary" onClick={() => nav(`/i/${selected.instId}`)}>
                      进入实例接管
                    </button>
                  )}
                </div>

                <div className="inbox-chat-body">
                  <div className="inbox-lock">
                    <span className="inbox-lock-ic">🔒</span>
                    <div>
                      <b>消息正文不在控制台展示</b>
                      <span>
                        安全红线：控制台只呈现脱敏会话概览（hash / 计数 / 阶段 / 意向 / 风险 / 记忆）。
                        需查看原文或人工接管，请进入实例桌面操作。
                      </span>
                    </div>
                  </div>

                  <div className="inbox-facts">
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">会话 hash</span>
                      <span className="inbox-fact-v ai-mono">···{selected.key.slice(0, 10)}</span>
                    </div>
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">消息总数</span>
                      <span className="inbox-fact-v">{selected.messages}</span>
                    </div>
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">来 / 去</span>
                      <span className="inbox-fact-v">{selected.incoming} 收 · {selected.outgoing} 发</span>
                    </div>
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">阶段</span>
                      <span className="inbox-fact-v">{stageLabel(selected.stage)}</span>
                    </div>
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">意向分</span>
                      <span className="inbox-fact-v">{selected.intent ?? '—'}</span>
                    </div>
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">风险</span>
                      <span className="inbox-fact-v">
                        <span className={'ai-dot ' + riskDotCls(selected.risk)} /> {RISK_LABEL[selected.risk]}
                      </span>
                    </div>
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">活跃记忆</span>
                      <span className="inbox-fact-v">{selected.memActive}</span>
                    </div>
                    <div className="inbox-fact">
                      <span className="inbox-fact-k">候选记忆</span>
                      <span className="inbox-fact-v">{selected.memCandidate}</span>
                    </div>
                  </div>

                  {/* 安全阶段时间线（非正文） */}
                  <div className="inbox-stage-tl">
                    <div className="inbox-stage-tl-title">处理阶段（安全示意）</div>
                    <ul className="ai-timeline">
                      <li className="ai-tl-item">
                        <span className="ai-tl-dot st-on" />
                        <div className="ai-tl-body">
                          <div className="ai-tl-main">OCR 入库 <span className="ai-tl-inst">@{selected.instName}</span></div>
                          <div className="ai-tl-meta">已抽取 {selected.messages} 条消息为安全字段</div>
                        </div>
                      </li>
                      <li className="ai-tl-item">
                        <span className={'ai-tl-dot ' + (selected.memActive ? 'st-on' : 'st-warn')} />
                        <div className="ai-tl-body">
                          <div className="ai-tl-main">画像 / 记忆抽取</div>
                          <div className="ai-tl-meta">{selected.memActive} 活跃 · {selected.memCandidate} 候选记忆</div>
                        </div>
                      </li>
                      <li className="ai-tl-item">
                        <span className="ai-tl-dot st-busy" />
                        <div className="ai-tl-body">
                          <div className="ai-tl-main">起草回复</div>
                          <div className="ai-tl-meta">正文脱敏，敏感内容转「待确认」</div>
                        </div>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="inbox-chat-foot">
                  <span className="ai-note" style={{ margin: 0 }}>
                    控制台为只读视图，不在此发送消息 / 触发真实微信动作；发送与接管请进入实例桌面。
                  </span>
                </div>
              </>
            )}
          </section>

          {/* 右：客户画像 + 工具 */}
          <aside className="inbox-col inbox-right">
            {selected && <RightPane c={selected} m={m} onOpenInstance={(id) => nav(`/i/${id}`)} />}
          </aside>
        </div>
      </div>
    </div>
  );
}

function RightPane({
  c,
  m,
  onOpenInstance,
}: {
  c: CrmCustomer;
  m: ReturnType<typeof useAiConsoleModel>;
  onOpenInstance: (id: string) => void;
}) {
  const emp = getInstanceEmployee(m, c.instId);
  const permKeys = emp?.permissionKeys ?? [];
  return (
    <div className="inbox-rp">
      <div className="rp-card">
        <div className="rp-card-h">客户画像</div>
        <div className="rp-kv"><span>客户</span><b>客户 {c.code}</b></div>
        <div className="rp-kv"><span>负责员工</span><b>{c.employeeName}</b></div>
        <div className="rp-kv"><span>阶段</span><b>{stageLabel(c.stage)}</b></div>
        <div className="rp-kv"><span>意向分</span><b>{c.intent ?? '—'}</b></div>
        <div className="rp-kv">
          <span>风险</span>
          <b><span className={'ai-dot ' + riskDotCls(c.risk)} /> {RISK_LABEL[c.risk]}</b>
        </div>
        <div className="rp-kv"><span>累计消息</span><b>{c.messages}</b></div>
      </div>

      <div className="rp-card">
        <div className="rp-card-h">AI 跟进建议</div>
        <p className="inbox-suggestion">{c.suggestion}</p>
      </div>

      <div className="rp-card">
        <div className="rp-card-h">员工权限（allowlist）</div>
        {permKeys.length === 0 ? (
          <div className="ai-note" style={{ margin: 0 }}>该实例未绑定员工或未授予能力键。</div>
        ) : (
          <div className="ai-choice-row">
            {permKeys.map((k) => (
              <span key={k} className="ai-choice on" style={{ cursor: 'default' }}>{permKeyLabel(k)}</span>
            ))}
          </div>
        )}
      </div>

      <div className="rp-card">
        <div className="rp-card-h">快捷操作</div>
        <div className="inbox-quick">
          {c.instId ? (
            <button className="btn btn-primary" onClick={() => onOpenInstance(c.instId!)}>进入实例接管</button>
          ) : (
            <button className="btn" disabled title="该会话未命中你可见的实例">未关联可见实例</button>
          )}
          <button className="btn" disabled title="发送 / 改备注 / 拉群等动作走待确认 + 实例桌面，本页只读">发报价单</button>
          <button className="btn" disabled title="发送 / 改备注 / 拉群等动作走待确认 + 实例桌面，本页只读">转人工</button>
        </div>
        <div className="ai-set-hint">敏感动作恒进「待确认」并在实例桌面执行，本页不触发真实微信动作。</div>
      </div>
    </div>
  );
}
