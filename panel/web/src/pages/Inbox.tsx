import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAiConsoleModel,
  stageLabel,
  RISK_LABEL,
  riskDotCls,
  permKeyLabel,
  getInstanceEmployee,
  type CrmCustomer,
  type Risk,
} from './aiConsoleModel';

// 对话 / Inbox（/inbox）—— 对标模板 pageInbox 三栏（会话列表 / 消息流 / 客户画像+工具）。
// 页面渲染在 AiConsoleShell 的 .main 内，根为普通 <div>，从 .page-h 开始。
// 安全红线：中栏消息流绝不展示聊天正文 / 回复原文，仅呈现脱敏安全概览（hash / 计数 / 阶段 /
//   意向 / 风险 / 记忆），气泡用 .msg .bub.redacted 占位；无后端动作按钮 disabled + title 说明。
// 这是微信（WechatOnCloud），界面措辞统一用「微信」。
// 数据来自 useAiConsoleModel（真实优先，失败 deterministic 演示）。

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

const riskChipTone: Record<Risk, string> = { high: 'danger', medium: 'warn', low: 'brand' };

export default function Inbox(_props: { onOpenMenu?: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const [filter, setFilter] = useState<Filter>('all');
  const [selKey, setSelKey] = useState<string | null>(null);
  const [mode, setMode] = useState<'ai' | 'suggested' | 'human'>('ai');

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
    <div>
      <div className="page-h">
        <div>
          <h1>对话 · 微信收件箱</h1>
          <p>同一会话里查看 AI 接管状态、行为边界与安全概览。控制台为只读视图，消息正文永不在此展示。</p>
        </div>
        <div className="act">
          <span className="chip brand">
            <span className="dot st-on" /> AI 自动接管
          </span>
        </div>
      </div>

      {m.probed && (
        m.real ? (
          <div className="src-note real">
            <span className="d" /> 已接入真实微信会话概览 · 来源 ai-wechat-employee（只读，已按你可见实例过滤，正文全程脱敏）
          </div>
        ) : (
          <div className="src-note demo">
            <span className="d" /> 演示会话：尚未配置数据源。会话为 deterministic 占位，消息正文永不在控制台展示（安全红线）。
          </div>
        )
      )}

      <div className="inbox">
        {/* 左：会话列表 */}
        <div className="inbox-col col-left">
          <div className="inbox-h">
            <span className="title">会话</span>
            <span className="count">{m.customers.length}</span>
          </div>
          <div className="tabs">
            {FILTERS.map((f) => (
              <span
                key={f.key}
                className={'tab' + (filter === f.key ? ' active' : '')}
                onClick={() => setFilter(f.key)}
                role="button"
                tabIndex={0}
              >
                {f.label}
                <span className="num">{counts[f.key]}</span>
              </span>
            ))}
          </div>
          <div className="conv-list">
            {list.length === 0 ? (
              <div className="safe-note" style={{ margin: 12 }}>该筛选下暂无会话。</div>
            ) : (
              list.map((c) => (
                <button
                  key={c.key}
                  className={'conv-item' + (selected?.key === c.key ? ' active' : '')}
                  onClick={() => setSelKey(c.key)}
                >
                  <span className="av">{c.code.slice(0, 2)}</span>
                  <div className="info">
                    <div className="n">
                      <span className="name cut">客户 {c.code}</span>
                      <span className={'chip ' + riskChipTone[c.risk]} style={{ fontSize: 10, padding: '1px 6px' }}>
                        {RISK_LABEL[c.risk]}
                      </span>
                      <span className="time">{c.ago}</span>
                    </div>
                    <div className="last cut">
                      {stageLabel(c.stage)} · {c.instName} · 正文已脱敏
                    </div>
                  </div>
                  <div className="right">
                    {c.incoming > 0 && <span className="unread">{c.incoming}</span>}
                    <span className="chip outline" style={{ fontSize: 10 }}>{c.employeeName}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 中：消息流（安全占位，无正文） */}
        <div className="inbox-col col-mid">
          <div className="chat">
            {!selected ? (
              <div className="chat-body">
                <div className="chat-empty">
                  <div className="blob">💬</div>
                  <div className="empty-title">选择一个会话</div>
                  <div className="empty-sub">左侧选择会话查看安全概览。控制台不展示聊天正文。</div>
                </div>
              </div>
            ) : (
              <>
                <div className="chat-h">
                  <div className="avatar brand">{selected.code.slice(0, 2)}</div>
                  <div>
                    <div className="name">
                      客户 {selected.code} <span className="muted" style={{ fontWeight: 400 }}>· {selected.instName}</span>
                    </div>
                    <div className="sub">由 <b>{selected.employeeName}</b>（{selected.employeeRole}）接管 · {selected.ago}</div>
                  </div>
                  <div className="right">
                    <span className="chip brand">
                      <span className="dot st-on" /> AI 自动
                    </span>
                    <span className="chip outline">行为边界 · 触发进待确认</span>
                    <button className="btn sm" disabled title="转人工走待确认 + 实例桌面，本页只读，后续接入">转人工</button>
                    {selected.instId && (
                      <button className="btn sm primary" onClick={() => nav(`/i/${selected.instId}`)}>进入实例接管</button>
                    )}
                  </div>
                </div>

                <div className="chat-body">
                  {/* 客户消息：安全占位气泡（永不展示正文） */}
                  <div className="msg">
                    <div className="av">{selected.code.slice(0, 2)}</div>
                    <div className="bub redacted">
                      正文已脱敏，仅展示安全概览。
                      <div className="meta">
                        <span>{selected.incoming} 条客户消息</span>
                        <span className="dim">· 阶段 {stageLabel(selected.stage)}</span>
                      </div>
                    </div>
                  </div>

                  {/* AI 起草：安全占位气泡（永不展示回复原文） */}
                  <div className="msg ai" style={{ flexDirection: 'row-reverse' }}>
                    <div className="av">AI</div>
                    <div className="bub redacted">
                      AI 回复草稿正文已脱敏，敏感内容转「待确认」，需人工确认后才落地。
                      <div className="meta">
                        <span>{selected.outgoing} 条已发</span>
                        <span className="dim">· 意向分 {selected.intent ?? '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* 会话安全概览（非正文） */}
                  <div className="rp-card" style={{ marginTop: 8 }}>
                    <div className="h">会话安全概览</div>
                    <div className="kv"><span>会话 hash</span><span className="v mono">···{selected.key.slice(0, 10)}</span></div>
                    <div className="kv"><span>消息总数</span><span className="v">{selected.messages}</span></div>
                    <div className="kv"><span>来 / 去</span><span className="v">{selected.incoming} 收 · {selected.outgoing} 发</span></div>
                    <div className="kv"><span>阶段</span><span className="v">{stageLabel(selected.stage)}</span></div>
                    <div className="kv"><span>意向分</span><span className="v">{selected.intent ?? '—'}</span></div>
                    <div className="kv">
                      <span>风险</span>
                      <span className="v"><span className={'dot ' + riskDotCls(selected.risk)} /> {RISK_LABEL[selected.risk]}</span>
                    </div>
                    <div className="kv"><span>活跃 / 候选记忆</span><span className="v">{selected.memActive} · {selected.memCandidate}</span></div>
                  </div>
                </div>

                <div className="chat-foot">
                  <div className="modes">
                    <span className={'m' + (mode === 'ai' ? ' active' : '')} onClick={() => setMode('ai')} role="button" tabIndex={0}>
                      <span className="dot st-on" /> AI 自动接管
                    </span>
                    <span className={'m' + (mode === 'suggested' ? ' active' : '')} onClick={() => setMode('suggested')} role="button" tabIndex={0}>
                      AI 建议 · 我来发
                    </span>
                    <span className={'m' + (mode === 'human' ? ' active' : '')} onClick={() => setMode('human')} role="button" tabIndex={0}>
                      完全人工
                    </span>
                  </div>
                  <div className="quick">
                    <span className="chip">建议：报价单</span>
                    <span className="chip">转售后</span>
                    <span className="chip">发送产品手册</span>
                  </div>
                  <div className="input-row">
                    <div className="box">
                      <input placeholder="控制台为只读视图，不在此发送消息 / 触发真实微信动作" disabled />
                    </div>
                    <button className="send gray" disabled title="发送 / 接管请进入实例桌面，本页不触发真实微信动作，后续接入">→</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 右：客户画像 + 工具 */}
        <div className="inbox-col col-right">
          {selected && <RightPane c={selected} m={m} onOpenInstance={(id) => nav(`/i/${id}`)} />}
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
    <div className="right-pane">
      <div className="rp-card">
        <div className="h">客户画像 <span className="sub">已脱敏</span></div>
        <div className="kv"><span>客户</span><span className="v">客户 {c.code}</span></div>
        <div className="kv"><span>负责员工</span><span className="v">{c.employeeName}</span></div>
        <div className="kv"><span>所属微信</span><span className="v cut" style={{ maxWidth: 160 }}>{c.instName}</span></div>
        <div className="kv"><span>阶段</span><span className="v">{stageLabel(c.stage)}</span></div>
        <div className="kv"><span>意向分</span><span className="v">{c.intent ?? '—'}</span></div>
        <div className="kv">
          <span>风险等级</span>
          <span className="v"><span className={'chip ' + riskChipTone[c.risk]}>{RISK_LABEL[c.risk]}</span></span>
        </div>
        <div className="kv"><span>累计消息</span><span className="v">{c.messages}</span></div>
      </div>

      <div className="rp-card">
        <div className="h">接管员工 <span className="sub">{c.employeeRole}</span></div>
        <div className="kv"><span>{c.employeeName}</span><span className="v"><span className="chip brand">在线</span></span></div>
        <div className="kv"><span>活跃记忆</span><span className="v">{c.memActive}</span></div>
        <div className="kv"><span>候选记忆</span><span className="v">{c.memCandidate}</span></div>
        <div className="kv"><span>AI 跟进建议</span></div>
        <p className="apr-reason-body">{c.suggestion}</p>
      </div>

      <div className="rp-card">
        <div className="h">行为边界（allowlist） <span className="sub">触发进待确认</span></div>
        {permKeys.length === 0 ? (
          <div className="safe-note" style={{ margin: 0 }}>该实例未绑定员工或未授予能力键。</div>
        ) : (
          <div className="pills">
            {permKeys.map((k) => (
              <span key={k} className="chip outline">{permKeyLabel(k)}</span>
            ))}
          </div>
        )}
      </div>

      <div className="rp-card">
        <div className="h">快捷操作</div>
        <div className="pills">
          {c.instId ? (
            <button className="btn sm primary" onClick={() => onOpenInstance(c.instId!)}>进入实例接管</button>
          ) : (
            <button className="btn sm" disabled title="该会话未命中你可见的实例">未关联可见实例</button>
          )}
          <button className="btn sm" disabled title="发送 / 改备注 / 拉群等动作走待确认 + 实例桌面，本页只读，后续接入">发报价单</button>
          <button className="btn sm" disabled title="转人工走待确认 + 实例桌面，本页只读，后续接入">转人工</button>
        </div>
        <div className="safe-note" style={{ margin: '10px 0 0' }}>
          敏感动作恒进「待确认」并在实例桌面执行，本页不触发真实微信动作。
        </div>
      </div>
    </div>
  );
}
