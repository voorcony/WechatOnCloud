import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { statusOf, useInstances } from '../AppShell';
import { appProfile, type InstanceWithStatus } from '../api';
import { InstanceIcon } from '../AppIcon';
import { vncPreviewUrl } from './vncPreview';
import {
  useAiConsoleModel,
  getInstanceAiContext,
  getInstanceRiskSummary,
  instanceOnline,
  stageLabel,
  RISK_LABEL,
  permKeyLabel,
  type AiConsoleModel,
  type CrmCustomer,
  type Risk,
} from './aiConsoleModel';

// 对话 / Inbox（/inbox）—— 按用户要求的语义重排（非传统聊天三栏）：
//   左：微信实例列表（真实 useInstances，状态 / 绑定员工 / 今日消息 / 待办计数）→ 选中实例。
//   中：该实例的 VNC 工作区（在线用只读缩放 iframe 预览，门禁/离线显示模板风格空态）+「进入实例接管」。
//   右：该实例的 AI 员工 + 正在聊天的客户画像 + AI 判断 + 待确认 / 行为边界（allowlist）。
// 安全红线：VNC 为 view_only 只读预览（真正接管走 /i/<id>）；右栏只用 useAiConsoleModel 的安全派生字段
//   （阶段 / 意向 / 风险 / 计数 / 脱敏摘要），绝不渲染聊天正文 / 回复原文 / token / 绑定串明文。
// 措辞统一用「微信」（WechatOnCloud）。

export const InboxIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.6L3 21l1.9-5.8A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
);

type Filter = 'all' | 'online' | 'abnormal' | 'pending';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'online', label: '在线' },
  { key: 'abnormal', label: '异常' },
  { key: 'pending', label: '待办' },
];

const riskChipTone: Record<Risk, string> = { high: 'danger', medium: 'warn', low: 'brand' };

function gateReason(inst: InstanceWithStatus): { title: string; sub: string; action: string } {
  if (inst.proxyEnabled === false)
    return { title: '实例未启用代理', sub: '该实例未配置出网代理，桌面与 AI 自动动作已暂停。请在「实例·账号管理」配置代理并重启后再接管。', action: '进入实例处理' };
  if (inst.runtime !== 'running')
    return { title: inst.runtime === 'missing' ? '实例尚未创建' : '实例已停止', sub: '实例未在运行，无法拉起桌面画面。启动实例后可查看 VNC 并接管。', action: '进入实例启动' };
  if (!inst.wechat.installed)
    return { title: inst.wechat.phase === 'error' ? '微信安装异常' : '微信待安装', sub: '桌面可用，但微信尚未就绪。进入实例完成安装 / 登录后即可接待客户。', action: '进入实例安装' };
  return { title: '桌面暂不可用', sub: '实例状态异常，暂时无法预览画面。进入实例查看详情。', action: '进入实例查看' };
}

export default function Inbox(_props: { onOpenMenu?: () => void }) {
  const nav = useNavigate();
  const m = useAiConsoleModel();
  const { reload } = useInstances();
  const { instances, loaded } = m;
  const [filter, setFilter] = useState<Filter>('all');
  const [selId, setSelId] = useState<string | null>(null);

  const match = (inst: InstanceWithStatus, f: Filter): boolean => {
    const r = getInstanceRiskSummary(m, inst);
    if (f === 'online') return statusOf(inst).cls === 'st-on';
    if (f === 'abnormal') return r.abnormal;
    if (f === 'pending') return r.pending > 0 || r.unread > 0;
    return true;
  };

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of FILTERS) c[f.key] = instances.filter((i) => match(i, f.key)).length;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, m.customers, m.actions, m.instanceEmployees]);

  const list = useMemo(
    () => instances.filter((i) => match(i, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instances, filter, m.customers, m.actions, m.instanceEmployees],
  );

  const selected = useMemo<InstanceWithStatus | null>(
    () => instances.find((i) => i.id === selId) ?? list[0] ?? instances[0] ?? null,
    [instances, list, selId],
  );

  return (
    <div className="console-page wide">
      <div className="page-h">
        <div>
          <h1>对话 · 微信工作台</h1>
          <p>左侧选实例，中间看该微信实例的桌面画面，右侧看接管的 AI 员工与正在跟进的客户画像。控制台为只读，聊天正文永不在此展示。</p>
        </div>
        <div className="act">
          <span className="chip brand"><span className="dot st-on" /> AI 自动接管</span>
          <button className="btn sm" onClick={() => reload()}>刷新</button>
        </div>
      </div>

      {m.probed && (
        m.real ? (
          <div className="src-note real">
            <span className="d" /> 已接入真实 AI 员工数据 · 客户 / 待确认 / 绑定员工来源 ai-wechat-employee（只读，已按可见实例过滤）；实例与桌面画面恒为真实。
          </div>
        ) : (
          <div className="src-note demo">
            <span className="d" /> 演示数据：实例在线 / 桌面画面为真实，AI 员工 / 客户 / 待确认为 deterministic 占位演示。
          </div>
        )
      )}

      <div className="inbox">
        {/* 左：实例列表 */}
        <div className="inbox-col col-left">
          <div className="inbox-h">
            <span className="title">微信实例</span>
            <span className="count">{instances.length}</span>
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
                {f.label}<span className="num">{counts[f.key]}</span>
              </span>
            ))}
          </div>
          <div className="conv-list">
            {!loaded ? (
              <div className="safe-note" style={{ margin: 12 }}>加载可见实例…</div>
            ) : list.length === 0 ? (
              <div className="safe-note" style={{ margin: 12 }}>该筛选下暂无实例。</div>
            ) : (
              list.map((inst) => (
                <InstanceRow
                  key={inst.id}
                  m={m}
                  inst={inst}
                  active={selected?.id === inst.id}
                  onClick={() => setSelId(inst.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* 中：VNC 工作区 */}
        <div className="inbox-col col-mid">
          {!selected ? (
            <div className="inbox-vnc">
              <div className="vnc-stage">
                <div className="vnc-gate">
                  <div className="blob">🖥️</div>
                  <div className="gt">选择一个微信实例</div>
                  <div className="gs">从左侧选择实例，查看它的桌面画面与接管入口。</div>
                </div>
              </div>
            </div>
          ) : (
            <VncWorkspace inst={selected} onEnter={() => nav(`/i/${selected.id}`)} />
          )}
        </div>

        {/* 右：AI 员工 + 当前客户画像 */}
        <div className="inbox-col col-right">
          {selected && <RightPane m={m} inst={selected} onOpenInstance={() => nav(`/i/${selected.id}`)} />}
        </div>
      </div>
    </div>
  );
}

function InstanceRow({ m, inst, active, onClick }: { m: AiConsoleModel; inst: InstanceWithStatus; active: boolean; onClick: () => void }) {
  const st = statusOf(inst);
  const r = getInstanceRiskSummary(m, inst);
  const emp = m.instanceEmployees[inst.id];
  const badge = r.pending + r.unread;
  return (
    <button className={'conv-item' + (active ? ' active' : '')} onClick={onClick}>
      <span className="av plain">
        <InstanceIcon icon={inst.icon} appType={inst.appType} size={38} radius={11} />
        <span className={'stat ' + st.cls} />
      </span>
      <div className="info">
        <div className="n">
          <span className="name cut">{inst.name}</span>
          <span className={'chip ' + (st.cls === 'st-on' ? 'brand' : st.cls === 'st-warn' ? 'warn' : st.cls === 'st-busy' ? 'accent' : 'outline')} style={{ fontSize: 10, padding: '1px 6px' }}>
            {st.text}
          </span>
        </div>
        <div className="last cut">
          {emp?.bound ? emp.name : '未绑定 AI 员工'} · 客户 {r.customers}
        </div>
      </div>
      <div className="right">
        {badge > 0 && <span className="unread">{badge}</span>}
        {r.highRisk > 0 && <span className="chip danger" style={{ fontSize: 10, padding: '1px 6px' }}>高风险 {r.highRisk}</span>}
      </div>
    </button>
  );
}

function VncWorkspace({ inst, onEnter }: { inst: InstanceWithStatus; onEnter: () => void }) {
  const st = statusOf(inst);
  const online = instanceOnline(inst);
  const gate = gateReason(inst);
  return (
    <div className="inbox-vnc">
      <div className="vnc-h">
        <InstanceIcon icon={inst.icon} appType={inst.appType} size={34} radius={9} />
        <div style={{ minWidth: 0 }}>
          <div className="name cut">{inst.name}</div>
          <div className="sub">{appProfile(inst.appType).label} · 桌面{online ? '只读预览' : '不可用'} · ···{inst.id.slice(-4)}</div>
        </div>
        <div className="right">
          <span className={'chip ' + (st.cls === 'st-on' ? 'brand' : st.cls === 'st-warn' ? 'warn' : st.cls === 'st-busy' ? 'accent' : 'outline')}>
            <span className={'dot ' + st.cls} /> {st.text}
          </span>
          <button className="btn sm primary" onClick={onEnter}>进入实例接管</button>
        </div>
      </div>
      <div className="vnc-stage">
        {online ? (
          <>
            <span className="vnc-live-badge"><span className="dot live" /> 实时画面 · 只读</span>
            {/* view_only 缩放预览：不发输入、不改远端分辨率；接管走「进入实例接管」/ 点击画面 */}
            <iframe title={`VNC 预览 ${inst.name}`} src={vncPreviewUrl(inst.id)} allow="autoplay" />
            <div className="vnc-cover" onClick={onEnter} role="button" tabIndex={0} title="进入实例接管">
              <span className="hint">点击进入实例接管（可打字 / 发消息 / 处理待办）</span>
            </div>
          </>
        ) : (
          <div className="vnc-gate">
            <div className="blob">🖥️</div>
            <div className="gt">{gate.title}</div>
            <div className="gs">{gate.sub}</div>
            <button className="btn sm primary" onClick={onEnter}>{gate.action}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function RightPane({ m, inst, onOpenInstance }: { m: AiConsoleModel; inst: InstanceWithStatus; onOpenInstance: () => void }) {
  const ctx = getInstanceAiContext(m, inst);
  const emp = ctx.employee;
  const top: CrmCustomer | null = ctx.topCustomer;
  const permKeys = emp?.permissionKeys ?? [];
  return (
    <div className="right-pane">
      {/* 接管 AI 员工 */}
      <div className="rp-card">
        <div className="h">接管 AI 员工 {emp?.bound && <span className="sub">{emp.role}岗</span>}</div>
        {emp?.bound ? (
          <>
            <div className="kv"><span>{emp.name}</span><span className="v"><span className={'chip ' + (emp.statusCls === 'st-on' ? 'brand' : emp.statusCls === 'st-warn' ? 'warn' : 'outline')}><span className={'dot ' + emp.statusCls} /> {emp.statusText}</span></span></div>
            <div className="kv"><span>负责客户</span><span className="v">{ctx.customerCount}</span></div>
            <div className="kv"><span>待确认</span><span className="v">{ctx.risk.pending}</span></div>
          </>
        ) : (
          <div className="safe-note" style={{ margin: 0 }}>该实例尚未绑定 AI 员工。可在「AI 员工 · 绑定秘书」生成绑定码接入。</div>
        )}
      </div>

      {/* 正在跟进的客户画像 */}
      <div className="rp-card">
        <div className="h">当前客户画像 <span className="sub">最高意向 · 已脱敏</span></div>
        {top ? (
          <>
            <div className="kv"><span>客户</span><span className="v">客户 {top.code}</span></div>
            <div className="kv"><span>阶段</span><span className="v">{stageLabel(top.stage)}</span></div>
            <div className="kv"><span>意向分</span><span className="v">{top.intent ?? '—'}</span></div>
            <div className="kv"><span>风险等级</span><span className="v"><span className={'chip ' + riskChipTone[top.risk]}>{RISK_LABEL[top.risk]}</span></span></div>
            <div className="kv"><span>累计消息</span><span className="v">{top.messages}（收 {top.incoming} · 发 {top.outgoing}）</span></div>
            <div className="kv"><span>活跃 / 候选记忆</span><span className="v">{top.memActive} · {top.memCandidate}</span></div>
            <div className="kv"><span>最近活跃</span><span className="v">{top.ago}</span></div>
          </>
        ) : (
          <div className="safe-note" style={{ margin: 0 }}>
            {instanceOnline(inst) ? '暂无沉淀的客户画像，AI 正在接待中。' : '实例离线，暂无客户数据。'}
          </div>
        )}
      </div>

      {/* AI 判断 */}
      <div className="rp-card">
        <div className="h">AI 判断 <span className="sub">安全派生</span></div>
        <p className="apr-reason-body">{ctx.decision}</p>
      </div>

      {/* 待确认 / 行为边界 */}
      <div className="rp-card">
        <div className="h">
          风险 / 待确认
          <span className="v" style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {ctx.risk.highRisk > 0 && <span className="chip danger">高风险 {ctx.risk.highRisk}</span>}
            <span className={'chip ' + (ctx.risk.pending ? 'warn' : 'outline')}>待确认 {ctx.risk.pending}</span>
          </span>
        </div>
        <div className="kv"><span>行为边界（allowlist）</span></div>
        {permKeys.length === 0 ? (
          <div className="safe-note" style={{ margin: '4px 0 0' }}>该实例未绑定员工或未授予能力键。</div>
        ) : (
          <div className="pills">
            {permKeys.map((k) => (
              <span key={k} className="chip outline">{permKeyLabel(k)}</span>
            ))}
          </div>
        )}
        <div className="safe-note" style={{ margin: '10px 0 0' }}>
          敏感动作恒进「待确认」并在实例桌面执行，本页只读，不触发真实微信动作。
        </div>
      </div>

      <div className="pills">
        <button className="btn sm primary" onClick={onOpenInstance}>进入实例接管</button>
        <button className="btn sm" disabled title="转人工 / 发送走待确认 + 实例桌面，本页只读，后续接入">转人工</button>
      </div>
    </div>
  );
}
